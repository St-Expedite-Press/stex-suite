"""One knowledge journal: validation, replay, the writer lock and atomic writes.

Port of ``services/knowledge/src/projections.mjs`` (stex.knowledge.projections.v1).
The persisted ``knowledge.v1.json``, its version token, event fingerprints and
the lock file format are identical, so a journal written by either runtime
replays in the other. Behaviour and error codes follow
``protocol/knowledge/README.md``.

Failure behaviour: a malformed journal is preserved and refuses to open
(``INVALID_JOURNAL``); a live or unreadable writer lock refuses to open
(``KNOWLEDGE_LOCKED``); a failed write leaves the in-memory journal unchanged.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import os
import re
import sys
import time
import uuid
from collections.abc import Callable
from datetime import datetime
from pathlib import Path
from typing import Any

from stex.knowledge.jsjson import digest, finite_number, iso_now, safe_integer, stringify, utf16_length

SCHEMA = "stex.knowledge.projections.v1"
MAX_EVENTS = 10_000
MAX_BYTES = 8_000_000
JOURNAL_FILE = "knowledge.v1.json"
LOCK_FILE = "knowledge.lock"
RECOVERY_FILE = "knowledge.recovery"

Json = dict[str, Any]

_CONTROL = re.compile(r"[\u0000-\u001f\u007f]")
_HASH = re.compile(r"[a-f0-9]{64}")
_PROJECT_REF = re.compile(r"stex://(frige|seaxneat)/project/([a-z0-9][a-z0-9-]{0,62})")
_ENTITY_REF = re.compile(r"stex://knowledge/(concept|preference|commitment)/[a-z0-9][a-z0-9-]{0,79}")
_VALID_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{7,79}")
_SOURCE_ID = re.compile(r"[a-z][a-z0-9-]{0,80}")
_ORIGIN_REVISION = re.compile(r"[a-f0-9]{40,64}")
_EVIDENCE_REF = re.compile(
    r"stex://(frige|seaxneat)/project/[a-z0-9][a-z0-9-]{0,62}#source=[a-z][a-z0-9-]{0,80}"
)
_GENERATION = re.compile(r"[a-f0-9-]{36}")
_MEDIA_TYPES = ("text/plain", "text/markdown", "text/css")


class KnowledgeError(Exception):
    """A refusal with the HTTP status and stable code the contract names."""

    def __init__(self, status: int, code: str, message: str) -> None:
        """Record the status, code and user-facing message."""
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


def safe_text(value: Any, maximum: int = 300) -> bool:
    """Non-empty bounded text without control characters (JS UTF-16 length)."""
    return isinstance(value, str) and 0 < utf16_length(value) <= maximum and _CONTROL.search(value) is None


def is_hash(value: Any) -> bool:
    """A lowercase SHA-256 hex digest."""
    return isinstance(value, str) and _HASH.fullmatch(value) is not None


def project_ref(value: Any) -> bool:
    """A Frige or Seaxneat project reference."""
    return isinstance(value, str) and _PROJECT_REF.fullmatch(value) is not None


def entity_ref(value: Any) -> bool:
    """A project reference or an explicit knowledge entity reference."""
    return project_ref(value) or (isinstance(value, str) and _ENTITY_REF.fullmatch(value) is not None)


def valid_id(value: Any) -> bool:
    """The identifier syntax used for keys, events and relations."""
    return isinstance(value, str) and _VALID_ID.fullmatch(value) is not None


def _parse_date(value: str) -> bool:
    """Approximates ``Number.isFinite(Date.parse(value))`` for owner ISO timestamps."""
    try:
        datetime.fromisoformat(value)
    except ValueError:
        return False
    return True


def source_metadata(value: Any, project: Json) -> Json:
    """Validate the engine-owned source metadata retained in the journal."""
    if not isinstance(value, dict):
        raise KnowledgeError(
            400, "INVALID_SOURCE", "A source requires canonical identity, revision and provenance."
        )
    identifier = value.get("id")
    size = safe_integer(value.get("bytes"))
    if (
        not isinstance(identifier, str)
        or _SOURCE_ID.fullmatch(identifier) is None
        or value.get("reference") != f"{project['reference']}#source={identifier}"
        or not is_hash(value.get("revision"))
        or not safe_text(value.get("title"))
        or size is None
        or size < 0
        or value.get("mediaType") not in _MEDIA_TYPES
    ):
        raise KnowledgeError(
            400, "INVALID_SOURCE", "A source requires canonical identity, revision and provenance."
        )
    origin = value.get("originRevision")
    if "originRevision" in value and (
        not isinstance(origin, str) or _ORIGIN_REVISION.fullmatch(origin) is None
    ):
        raise KnowledgeError(400, "INVALID_SOURCE", "The owner revision must be a Git object identity.")
    record: Json = {
        "id": identifier,
        "reference": value["reference"],
        "revision": value["revision"],
        "title": value["title"],
        "bytes": size,
        "mediaType": value["mediaType"],
    }
    if origin:
        record["originRevision"] = origin
    return record


def revision_event(value: Any) -> Json:
    """Validate one owner revision event before recording it."""
    invalid = KnowledgeError(
        400, "INVALID_EVENT", "A revision event requires an owner identity, sequence, project and sources."
    )
    if not isinstance(value, dict):
        raise invalid
    sequence = safe_integer(value.get("sequence"))
    project = value.get("project")
    sources = value.get("sources")
    occurred = value.get("occurredAt")
    if (
        not valid_id(value.get("id"))
        or sequence is None
        or sequence < 1
        or not safe_text(occurred, 40)
        or not _parse_date(str(occurred))
        or not isinstance(project, dict)
        or not project_ref(project.get("reference"))
        or not safe_text(project.get("title"))
        or not isinstance(sources, list)
        or len(sources) > 50
    ):
        raise invalid
    match = _PROJECT_REF.fullmatch(project["reference"])
    assert match is not None  # noqa: S101 - established by project_ref above
    if project.get("application") != match.group(1) or project.get("id") != match.group(2):
        raise KnowledgeError(
            400, "INVALID_EVENT", "The engine project identity does not match its reference."
        )
    owner: Json = {
        "application": match.group(1),
        "id": match.group(2),
        "reference": project["reference"],
        "title": project["title"],
    }
    # localeCompare and code-point order agree for the [a-z0-9-] source id alphabet.
    records = sorted(
        (source_metadata(source, owner) for source in sources), key=lambda source: str(source["id"])
    )
    if len({source["id"] for source in records}) != len(records):
        raise KnowledgeError(400, "INVALID_EVENT", "Duplicate source identities are not permitted.")
    return {
        "id": value["id"],
        "sequence": sequence,
        "occurredAt": occurred,
        "project": owner,
        "sources": records,
    }


def relation_record(value: Any) -> Json:
    """Validate a relationship and its source evidence metadata."""
    invalid = KnowledgeError(
        400,
        "INVALID_RELATION",
        "A relationship requires an identity, kind, subject, predicate, object and evidence list.",
    )
    if (
        not isinstance(value, dict)
        or not valid_id(value.get("id"))
        or value.get("kind") not in ("assertion", "inference")
        or not entity_ref(value.get("subject"))
        or not safe_text(value.get("predicate"), 120)
        or not safe_text(value.get("object"), 1000)
        or not isinstance(value.get("evidence"), list)
        or len(value["evidence"]) > 10
    ):
        raise invalid
    evidence: list[Json] = []
    for entry in value["evidence"]:
        if (
            not isinstance(entry, dict)
            or not isinstance(entry.get("reference"), str)
            or _EVIDENCE_REF.fullmatch(entry["reference"]) is None
            or not is_hash(entry.get("revision"))
        ):
            raise KnowledgeError(
                400, "INVALID_RELATION", "Evidence must reference an exact engine source revision."
            )
        evidence.append({"reference": entry["reference"], "revision": entry["revision"]})
    confidence = finite_number(value.get("confidence"))
    if value["kind"] == "inference" and (
        not evidence or confidence is None or confidence < 0 or confidence > 1
    ):
        raise KnowledgeError(
            400,
            "INVALID_RELATION",
            "An inferred relationship requires evidence and confidence between zero and one.",
        )
    record: Json = {
        "id": value["id"],
        "kind": value["kind"],
        "subject": value["subject"],
        "predicate": value["predicate"],
        "object": value["object"],
        "evidence": evidence,
    }
    if value["kind"] == "inference":
        record["confidence"] = confidence
    record["status"] = "accepted" if value["kind"] == "assertion" else "proposed"
    return record


def detached(value: Json) -> Json:
    """A deep copy through JS-compatible JSON (the Node library's structuredClone of JSON data)."""
    copy: Json = json.loads(stringify(value))
    return copy


def initial(generation: str | None = None) -> Json:
    """The empty journal for a generation."""
    return {"schemaVersion": SCHEMA, "generation": generation or str(uuid.uuid4()), "events": []}


def token(document: Json) -> str:
    """The journal's opaque concurrency version."""
    return f"{document['generation']}:{len(document['events'])}"


def renews_consent(previous: Json | None, identity: str | None, value: Json) -> bool:
    """Whether an event restores consent for exactly the withdrawn checkpoint."""
    return (
        previous is not None
        and previous.get("consent") is False
        and previous.get("eventId") == value["id"]
        and previous.get("sequence") == value["sequence"]
        and identity == digest(value)
    )


# Extension point for record kinds added by later contract versions (contributions.py).
# Each handler replays one event into the shared state dict; unknown kinds stay invalid.
ReplayHandler = Callable[[Json, Json], None]
EXTRA_KINDS: dict[str, ReplayHandler] = {}


def rebuild(document: Any) -> Json:
    """Replay the journal into its coordinated views; refuse anything malformed."""
    if (
        not isinstance(document, dict)
        or document.get("schemaVersion") != SCHEMA
        or not isinstance(document.get("generation"), str)
        or _GENERATION.fullmatch(document["generation"]) is None
        or not isinstance(document.get("events"), list)
        or len(document["events"]) > MAX_EVENTS
    ):
        raise KnowledgeError(
            503, "INVALID_JOURNAL", "The knowledge journal is unreadable; it has been preserved."
        )
    projects: dict[str, Json] = {}
    relations: dict[str, Json] = {}
    identities: dict[str, str] = {}
    keys: dict[str, str] = {}
    extra: Json = {}
    for index, event in enumerate(document["events"]):
        if (
            not isinstance(event, dict)
            or event.get("number") != index + 1
            or not valid_id(event.get("key"))
            or not is_hash(event.get("fingerprint"))
            or event["key"] in keys
        ):
            raise KnowledgeError(
                503, "INVALID_JOURNAL", "The knowledge journal has invalid ordering or identities."
            )
        keys[event["key"]] = event["fingerprint"]
        kind = event.get("kind")
        # Validation errors inside a stored event keep their own status, exactly as the Node replay does.
        if kind == "revision":
            value = revision_event(event.get("value"))
            previous = projects.get(value["project"]["reference"])
            prior_identity = identities.get(value["id"])
            renewal = renews_consent(previous, prior_identity, value)
            if previous is not None and value["sequence"] <= previous["sequence"] and not renewal:
                raise KnowledgeError(
                    503, "INVALID_JOURNAL", "The knowledge journal contains a stale revision."
                )
            if prior_identity is not None and not renewal:
                raise KnowledgeError(
                    503, "INVALID_JOURNAL", "The knowledge journal repeats an engine event identity."
                )
            identities[value["id"]] = digest(value)
            projects[value["project"]["reference"]] = {
                **value["project"],
                "sequence": value["sequence"],
                "eventId": value["id"],
                "occurredAt": value["occurredAt"],
                "consent": True,
                "sources": value["sources"],
            }
        elif kind == "revoke":
            reference = event.get("value")
            if not isinstance(reference, str) or not project_ref(reference):
                raise KnowledgeError(503, "INVALID_JOURNAL", "Invalid revocation.")
            prior = projects.get(reference)
            if prior is None:
                raise KnowledgeError(503, "INVALID_JOURNAL", "Revocation has no project.")
            projects[reference] = {**prior, "consent": False, "sources": []}
        elif kind == "relation":
            record = relation_record(event.get("value"))
            if record["id"] in relations:
                raise KnowledgeError(503, "INVALID_JOURNAL", "Repeated relationship identity.")
            relations[record["id"]] = {**record, "createdAt": event.get("at"), "updatedAt": event.get("at")}
        elif kind == "revise":
            change = event.get("value")
            earlier = relations.get(str(change.get("id"))) if isinstance(change, dict) else None
            if (
                earlier is None
                or not isinstance(change, dict)
                or change.get("status") not in ("accepted", "rejected")
                or ("object" in change and not safe_text(change["object"], 1000))
            ):
                raise KnowledgeError(503, "INVALID_JOURNAL", "Invalid relationship correction.")
            obj = change.get("object", earlier["object"])
            relations[earlier["id"]] = {
                **earlier,
                "object": obj,
                "status": change["status"],
                "updatedAt": event.get("at"),
                "corrected": obj != earlier["object"] or bool(earlier.get("corrected", False)),
            }
        elif isinstance(kind, str) and kind in EXTRA_KINDS:
            EXTRA_KINDS[kind](event, extra)
        else:
            raise KnowledgeError(503, "INVALID_JOURNAL", "The knowledge journal contains an unknown event.")
    sources = [
        {
            **source,
            "project": project["reference"],
            "eventId": project["eventId"],
            "occurredAt": project["occurredAt"],
        }
        for project in projects.values()
        for source in project["sources"]
    ]
    available = {source["reference"]: source["revision"] for source in sources}
    links = [
        {
            **relation,
            "evidenceState": "current"
            if all(available.get(entry["reference"]) == entry["revision"] for entry in relation["evidence"])
            else "unavailable",
        }
        for relation in relations.values()
    ]
    graph_projects = [
        {
            **{key: item for key, item in project.items() if key != "sources"},
            "sourceCount": len(project["sources"]),
        }
        for project in projects.values()
    ]
    return {
        "version": token(document),
        "knowledge": {"sources": sources},
        "graph": {"projects": graph_projects, "relations": links},
        "keys": keys,
        "identities": identities,
        "extra": extra,
    }


def _process_alive(pid: int) -> bool:
    """Whether a process id is live. Never signals it (``os.kill(pid, 0)`` terminates on Windows)."""
    if sys.platform == "win32":
        import ctypes

        kernel32 = ctypes.windll.kernel32
        handle = kernel32.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
        if not handle:
            # ERROR_INVALID_PARAMETER: no such process. Anything else (access denied) counts as alive.
            return bool(kernel32.GetLastError() != 87)
        try:
            code = ctypes.c_ulong()
            if not kernel32.GetExitCodeProcess(handle, ctypes.byref(code)):
                return True
            return code.value == 259  # STILL_ACTIVE
        finally:
            kernel32.CloseHandle(handle)
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def _atomic_write(file: Path, document: Json) -> None:
    """Persist the next journal revision by flushed temporary file and rename."""
    raw = stringify(document) + "\n"
    data = raw.encode("utf-8", "replace")
    if len(data) > MAX_BYTES:
        raise KnowledgeError(
            413, "KNOWLEDGE_LIMIT", "Export or delete knowledge before adding more journal data."
        )
    temporary = file.with_name(f"{file.name}.{uuid.uuid4()}.tmp")
    try:
        with temporary.open("xb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        for attempt in range(6):
            try:
                os.replace(temporary, file)
                break
            except PermissionError:
                # Windows may briefly hold the target open for scanning or indexing.
                if attempt >= 5:
                    raise
                time.sleep(0.02 * 2**attempt)
    finally:
        with contextlib.suppress(OSError):
            temporary.unlink()


def bind_ledger(file: Path, document: Json, journal_generation: str, initial: Callable[[], Json]) -> Json:
    """Tie a ledger beside the journal (contributions, notes) to one journal generation.

    Erasing knowledge gives the journal a new generation, on either runtime. A
    ledger still bound to an older generation therefore belongs to erased
    knowledge: its records are dropped rather than honoured (the Node library
    does not know these ledgers, so a native erase could otherwise leave them
    to be revived when the platform path returns). A ledger written before
    binding existed adopts the current generation.
    """
    bound = document.get("journalGeneration")
    if bound == journal_generation:
        return document
    if bound is None:
        return {**document, "journalGeneration": journal_generation}
    fresh = {**initial(), "journalGeneration": journal_generation}
    if file.exists():
        _atomic_write(file, fresh)
    return fresh


class DisabledJournal:
    """The inert journal served when no directory is configured."""

    enabled = False

    def view(self) -> Json:
        """The disabled view."""
        return {
            "enabled": False,
            "version": None,
            "knowledge": {"sources": []},
            "graph": {"projects": [], "relations": []},
        }

    def export(self) -> Json:
        """Disabled export is the disabled view."""
        return self.view()

    async def close(self) -> None:
        """Nothing to release."""


class Journal:
    """A single writer for one journal directory, with an advisory process lock."""

    enabled = True

    def __init__(self, root: Path, file: Path, lock: Path, nonce: str, document: Json) -> None:
        """Use :meth:`open`; this stores already-validated state."""
        self._root = root
        self._file = file
        self._lock = lock
        self._nonce = nonce
        self._document = document
        self._closed = False
        self._closing = False
        self._queue = asyncio.Lock()
        # Per-directory state that shares this writer's lock (the contribution ledger).
        self.attachment: object | None = None
        # The read-only note import ledger (notes.py), same directory and lock.
        self.notes_ledger: object | None = None

    @property
    def directory(self) -> Path:
        """The journal directory this writer holds the lock for."""
        return self._root

    def ensure_persisted(self) -> None:
        """Write the (possibly empty) journal if it is not on disk yet, so its generation is stable.

        Ledgers beside the journal bind to its generation; an unsaved journal would get a new
        generation on every open and make them look erased.
        """
        if not self._file.exists():
            _atomic_write(self._file, self._document)

    @property
    def queue(self) -> asyncio.Lock:
        """The writer queue; files sharing the directory lock serialize on it too."""
        return self._queue

    @classmethod
    def open(cls, directory: Path) -> Journal:
        """Take the writer lock and load the journal, failing closed on any doubt."""
        root = directory.resolve()
        root.mkdir(parents=True, exist_ok=True)
        file = root / JOURNAL_FILE
        lock = root / LOCK_FILE
        nonce = str(uuid.uuid4())
        claim = stringify({"pid": os.getpid(), "nonce": nonce})
        try:
            lock_handle = lock.open("x", encoding="utf-8")
        except FileExistsError:
            # A separate exclusive recovery claim prevents two starters from both
            # removing a dead writer's lock and admitting themselves as writers.
            recovery = root / RECOVERY_FILE
            try:
                recovery_handle = recovery.open("x", encoding="utf-8")
            except FileExistsError as error:
                raise KnowledgeError(
                    503, "KNOWLEDGE_LOCKED", "Knowledge writer recovery is already in progress."
                ) from error
            try:
                with recovery_handle:
                    recovery_handle.write(claim)
                try:
                    previous = json.loads(lock.read_text(encoding="utf-8"))
                except (OSError, ValueError) as error:
                    raise KnowledgeError(
                        503, "KNOWLEDGE_LOCKED", "The knowledge writer lock is unreadable."
                    ) from error
                pid = safe_integer(previous.get("pid")) if isinstance(previous, dict) else None
                if pid is None or pid < 1:
                    raise KnowledgeError(503, "KNOWLEDGE_LOCKED", "The knowledge writer lock is invalid.")
                if _process_alive(pid):
                    raise KnowledgeError(503, "KNOWLEDGE_LOCKED", "Another knowledge writer is active.")
                lock.unlink()
                lock_handle = lock.open("x", encoding="utf-8")
            finally:
                with contextlib.suppress(OSError):
                    recovery.unlink()
        with lock_handle:
            lock_handle.write(claim)
        try:
            raw: str | None = None
            try:
                if file.stat().st_size > MAX_BYTES:
                    raise KnowledgeError(
                        503, "INVALID_JOURNAL", "The knowledge journal exceeds its size limit."
                    )
                raw = file.read_text(encoding="utf-8")
            except FileNotFoundError:
                raw = None
            try:
                document = initial() if raw is None else json.loads(raw)
            except ValueError as error:
                raise KnowledgeError(
                    503, "INVALID_JOURNAL", "The knowledge journal is unreadable; it has been preserved."
                ) from error
            rebuild(document)
        except BaseException:
            cls._release_lock(lock, nonce)
            raise
        return cls(root, file, lock, nonce, document)

    @staticmethod
    def _release_lock(lock: Path, nonce: str) -> None:
        """Remove the lock only if it is still ours."""
        try:
            value = json.loads(lock.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return
        if isinstance(value, dict) and value.get("nonce") == nonce:
            with contextlib.suppress(OSError):
                lock.unlink()

    @property
    def document(self) -> Json:
        """The current persisted journal (read-only use)."""
        return self._document

    def current(self) -> Json:
        """Replay the current journal."""
        return rebuild(self._document)

    def view(self) -> Json:
        """A detached view of both projections."""
        state = self.current()
        return detached(
            {
                "enabled": True,
                "version": state["version"],
                "knowledge": state["knowledge"],
                "graph": state["graph"],
            }
        )

    def export(self) -> Json:
        """The detached view plus the portable journal."""
        return detached({**self.view(), "journal": self._document})

    def _check_open(self) -> None:
        """Refuse work after close has begun."""
        if self._closed or self._closing:
            raise KnowledgeError(503, "KNOWLEDGE_CLOSED", "The knowledge writer is closed.")

    async def write(
        self,
        body: Any,
        kind: str,
        normalize: Callable[[Json], Any],
        check: Callable[[Any, Json], None] = lambda _value, _state: None,
    ) -> Json:
        """Validate, check idempotency and version, then append one event atomically."""
        self._check_open()
        async with self._queue:
            if self._closed:
                raise KnowledgeError(503, "KNOWLEDGE_CLOSED", "The knowledge writer is closed.")
            if not isinstance(body, dict) or not valid_id(body.get("idempotencyKey")):
                raise KnowledgeError(
                    400, "INVALID_REQUEST", "An idempotency key of 8 to 80 safe characters is required."
                )
            value = normalize(body)
            identity = digest({"kind": kind, "value": value})
            state = self.current()
            key = body["idempotencyKey"]
            if key in state["keys"]:
                if state["keys"][key] != identity:
                    raise KnowledgeError(
                        409, "KEY_CONFLICT", "That key was used for a different knowledge operation."
                    )
                return {**self.view(), "replayed": True}
            if body.get("expectedVersion") != state["version"]:
                raise KnowledgeError(
                    409, "STALE_KNOWLEDGE", "Knowledge changed. Refresh before applying this operation."
                )
            if len(self._document["events"]) >= MAX_EVENTS:
                raise KnowledgeError(413, "KNOWLEDGE_LIMIT", "The knowledge journal is full.")
            check(value, state)
            event = {
                "number": len(self._document["events"]) + 1,
                "key": key,
                "fingerprint": identity,
                "kind": kind,
                "value": value,
                "at": iso_now(),
            }
            following = {
                **self._document,
                "events": [*self._document["events"], json.loads(stringify(event))],
            }
            rebuild(following)
            _atomic_write(self._file, following)
            self._document = following
            return {**self.view(), "replayed": False}

    async def accept(self, body: Json) -> Json:
        """Record an explicitly approved owner revision event."""

        def check(value: Json, state: Json) -> None:
            previous = next(
                (p for p in state["graph"]["projects"] if p["reference"] == value["project"]["reference"]),
                None,
            )
            renewal = renews_consent(previous, state["identities"].get(value["id"]), value)
            if value["id"] in state["identities"] and not renewal:
                raise KnowledgeError(
                    409,
                    "EVENT_CONFLICT",
                    "That engine event has already been accepted. Replay its original idempotency key.",
                )
            if previous is not None and value["sequence"] <= previous["sequence"] and not renewal:
                raise KnowledgeError(
                    409, "STALE_EVENT", "An older engine event cannot replace newer context."
                )

        return await self.write(body, "revision", lambda data: revision_event(data.get("event")), check)

    async def revoke(self, body: Json) -> Json:
        """Withdraw consent for one project."""

        def normalize(data: Json) -> str:
            if not project_ref(data.get("project")):
                raise KnowledgeError(400, "INVALID_REQUEST", "Choose a known project reference.")
            return str(data["project"])

        def check(value: str, state: Json) -> None:
            if not any(project["reference"] == value for project in state["graph"]["projects"]):
                raise KnowledgeError(404, "NOT_FOUND", "That knowledge project does not exist.")

        return await self.write(body, "revoke", normalize, check)

    async def relation(self, body: Json) -> Json:
        """Create an explicit assertion or a reviewable inference."""

        def check(value: Json, state: Json) -> None:
            if any(relation["id"] == value["id"] for relation in state["graph"]["relations"]):
                raise KnowledgeError(409, "RELATION_CONFLICT", "That relationship already exists.")
            sources = {source["reference"]: source["revision"] for source in state["knowledge"]["sources"]}
            if any(sources.get(entry["reference"]) != entry["revision"] for entry in value["evidence"]):
                raise KnowledgeError(
                    409, "STALE_EVIDENCE", "Relationship evidence is no longer in the accepted projection."
                )
            if project_ref(value["subject"]) and not any(
                project["reference"] == value["subject"] and project["consent"]
                for project in state["graph"]["projects"]
            ):
                raise KnowledgeError(409, "STALE_EVIDENCE", "The relationship project is not accepted.")

        return await self.write(body, "relation", lambda data: relation_record(data.get("relation")), check)

    async def revise(self, body: Json) -> Json:
        """Accept, reject or correct an existing relationship."""

        def normalize(data: Json) -> Json:
            # As in Node, a present-but-null object is refused; only an absent one keeps the old object.
            if (
                not valid_id(data.get("id"))
                or data.get("status") not in ("accepted", "rejected")
                or ("object" in data and not safe_text(data["object"], 1000))
            ):
                raise KnowledgeError(
                    400,
                    "INVALID_REQUEST",
                    "Provide the relationship id, status and optional corrected object.",
                )
            record: Json = {"id": data["id"], "status": data["status"]}
            if "object" in data:
                record["object"] = data["object"]
            return record

        def check(value: Json, state: Json) -> None:
            if not any(relation["id"] == value["id"] for relation in state["graph"]["relations"]):
                raise KnowledgeError(404, "NOT_FOUND", "That relationship does not exist.")

        return await self.write(body, "revise", normalize, check)

    async def erase(self, body: Any) -> Json:
        """Replace the journal with a new empty generation after confirmation."""
        self._check_open()
        async with self._queue:
            if self._closed:
                raise KnowledgeError(503, "KNOWLEDGE_CLOSED", "The knowledge writer is closed.")
            if (
                not isinstance(body, dict)
                or body.get("confirmation") != "delete-knowledge"
                or body.get("expectedVersion") != token(self._document)
            ):
                raise KnowledgeError(
                    409, "STALE_KNOWLEDGE", "Confirm deletion against the current knowledge version."
                )
            following = initial()
            _atomic_write(self._file, following)
            self._document = following
            return self.view()

    async def close(self) -> None:
        """Finish queued writes, then release the writer lock."""
        if self._closed or self._closing:
            return
        self._closing = True
        async with self._queue:
            self._closed = True
        self._release_lock(self._lock, self._nonce)
