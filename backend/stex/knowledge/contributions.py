"""Private knowledge contributions (``stex.knowledge.contributions.v1``).

A contribution records that one person approved one exact Frige passage
revision for use with Igor. It lives in that person's journal directory, in
its own file (``contributions.v1.json``), beside ``knowledge.v1.json``:

* the projections journal stays byte-compatible with the Node library, so the
  native path can still open it (rollback), and
* the same directory writer lock covers both files.

Stored per contribution: the Frige project and attachment, the original-byte
digest, the approved-excerpt hash, the UTF-8 byte range, the passage hash and
title. Never the passage text: text is re-read from Frige, after every check,
each time it is shown or used.

Audience is always ``self``. A contribution grants no access to the Frige
source (Frige decides that on every read) and no one else can see, count or
resolve it. Withdrawal stops every future read and resolve; it does not and
cannot erase turns that already used the passage.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import re
import uuid
from pathlib import Path
from typing import Any

from stex.knowledge.journal import (
    MAX_BYTES,
    Journal,
    Json,
    KnowledgeError,
    _atomic_write,
    bind_ledger,
    detached,
    safe_text,
    token,
    valid_id,
)
from stex.knowledge.jsjson import digest, iso_now, safe_integer

SCHEMA = "stex.knowledge.contributions.v1"
FILE = "contributions.v1.json"
MAX_EVENTS = 2_000
MAX_ACTIVE = 200
REFERENCE_PREFIX = "stex://knowledge/contribution/"
_ID = re.compile(r"ctb-[a-f0-9]{16}")
_HASH = re.compile(r"[a-f0-9]{64}")
_ATTACHMENT = re.compile(r"[a-f0-9]{16}")
_FRIGE_PROJECT = re.compile(r"stex://frige/project/[a-z0-9][a-z0-9-]{0,62}")
_GENERATION = re.compile(r"[a-f0-9-]{36}")


def reference_of(identifier: str) -> str:
    """The stable contribution reference."""
    return f"{REFERENCE_PREFIX}{identifier}"


def identifier_of(reference: Any) -> str:
    """The contribution id inside a reference, or a 400."""
    if not isinstance(reference, str) or not reference.startswith(REFERENCE_PREFIX):
        raise KnowledgeError(400, "INVALID_REQUEST", "Name a knowledge contribution reference.")
    identifier = reference[len(REFERENCE_PREFIX) :]
    if _ID.fullmatch(identifier) is None:
        raise KnowledgeError(400, "INVALID_REQUEST", "Name a knowledge contribution reference.")
    return identifier


def citation(value: Any) -> Json:
    """Validate the citation a caller names (before any owner check)."""
    if not isinstance(value, dict):
        raise KnowledgeError(400, "INVALID_REQUEST", "Name an exact passage citation.")
    start = safe_integer(value.get("start"))
    end = safe_integer(value.get("end"))
    if (
        not isinstance(value.get("project"), str)
        or _FRIGE_PROJECT.fullmatch(value["project"]) is None
        or not isinstance(value.get("attachmentId"), str)
        or _ATTACHMENT.fullmatch(value["attachmentId"]) is None
        or not isinstance(value.get("excerptHash"), str)
        or _HASH.fullmatch(value["excerptHash"]) is None
        or not isinstance(value.get("passageSha256"), str)
        or _HASH.fullmatch(value["passageSha256"]) is None
        or start is None
        or end is None
        or start < 0
        or end <= start
    ):
        raise KnowledgeError(400, "INVALID_REQUEST", "Name an exact passage citation.")
    return {
        "project": value["project"],
        "attachmentId": value["attachmentId"],
        "excerptHash": value["excerptHash"],
        "start": start,
        "end": end,
        "passageSha256": value["passageSha256"],
    }


def _record(value: Any) -> Json:
    """Validate a stored contribution value (replay and writes)."""
    if (
        not isinstance(value, dict)
        or not isinstance(value.get("id"), str)
        or _ID.fullmatch(value["id"]) is None
    ):
        raise KnowledgeError(
            503, "INVALID_JOURNAL", "The contribution ledger is unreadable; it has been preserved."
        )
    cited = citation(value)
    original = value.get("originalSha256")
    if (
        original is not None and (not isinstance(original, str) or _HASH.fullmatch(original) is None)
    ) or not safe_text(value.get("title")):
        raise KnowledgeError(
            503, "INVALID_JOURNAL", "The contribution ledger is unreadable; it has been preserved."
        )
    return {
        "id": value["id"],
        **cited,
        "originalSha256": original,
        "title": value["title"],
        "audience": "self",
    }


def rebuild(document: Any) -> Json:
    """Replay the ledger into its view; refuse anything malformed."""
    if (
        not isinstance(document, dict)
        or document.get("schemaVersion") != SCHEMA
        or not isinstance(document.get("generation"), str)
        or _GENERATION.fullmatch(document["generation"]) is None
        or not isinstance(document.get("events"), list)
        or len(document["events"]) > MAX_EVENTS
    ):
        raise KnowledgeError(
            503, "INVALID_JOURNAL", "The contribution ledger is unreadable; it has been preserved."
        )
    contributions: dict[str, Json] = {}
    keys: dict[str, str] = {}
    for index, event in enumerate(document["events"]):
        if (
            not isinstance(event, dict)
            or event.get("number") != index + 1
            or not valid_id(event.get("key"))
            or event["key"] in keys
            or not isinstance(event.get("fingerprint"), str)
        ):
            raise KnowledgeError(
                503, "INVALID_JOURNAL", "The contribution ledger has invalid ordering or identities."
            )
        keys[event["key"]] = event["fingerprint"]
        if event.get("kind") == "contribute":
            record = _record(event.get("value"))
            if record["id"] in contributions:
                raise KnowledgeError(503, "INVALID_JOURNAL", "The contribution ledger repeats an identity.")
            contributions[record["id"]] = {
                **record,
                "reference": reference_of(record["id"]),
                "status": "active",
                "createdAt": event.get("at"),
                "withdrawnAt": None,
            }
        elif event.get("kind") == "withdraw":
            earlier = contributions.get(str(event.get("value")))
            if earlier is None or earlier["status"] != "active":
                raise KnowledgeError(
                    503, "INVALID_JOURNAL", "The contribution ledger withdraws an unknown contribution."
                )
            contributions[earlier["id"]] = {**earlier, "status": "withdrawn", "withdrawnAt": event.get("at")}
        else:
            raise KnowledgeError(503, "INVALID_JOURNAL", "The contribution ledger contains an unknown event.")
    return {"version": token(document), "contributions": list(contributions.values()), "keys": keys}


def _initial() -> Json:
    """An empty ledger."""
    return {"schemaVersion": SCHEMA, "generation": str(uuid.uuid4()), "events": []}


def _same(record: Json, cited: Json) -> bool:
    """Whether a stored contribution names exactly this citation."""
    return all(
        record[field] == cited[field]
        for field in ("project", "attachmentId", "excerptHash", "start", "end", "passageSha256")
    )


class ContributionLedger:
    """One person's contributions. Use :meth:`of` so it shares the journal's lock and queue."""

    def __init__(self, file: Path, document: Json, queue: asyncio.Lock) -> None:
        """Store validated state; the journal holding the directory lock owns ``queue``."""
        self._file = file
        self._document = document
        self._queue = queue

    @classmethod
    def of(cls, journal: Journal) -> ContributionLedger:
        """The ledger beside a journal, loaded once and cached on it."""
        cached = journal.attachment
        if isinstance(cached, ContributionLedger):
            return cached
        file = journal.directory / FILE
        try:
            if file.stat().st_size > MAX_BYTES:
                raise KnowledgeError(
                    503, "INVALID_JOURNAL", "The contribution ledger exceeds its size limit."
                )
            document = json.loads(file.read_text(encoding="utf-8"))
        except FileNotFoundError:
            document = _initial()
        except ValueError as error:
            raise KnowledgeError(
                503, "INVALID_JOURNAL", "The contribution ledger is unreadable; it has been preserved."
            ) from error
        rebuild(document)
        journal.ensure_persisted()
        document = bind_ledger(file, document, journal.document["generation"], _initial)
        ledger = cls(file, document, journal.queue)
        journal.attachment = ledger
        return ledger

    def view(self) -> Json:
        """Every contribution this person made (metadata only)."""
        state = rebuild(self._document)
        return detached(
            {"schemaVersion": SCHEMA, "version": state["version"], "contributions": state["contributions"]}
        )

    def find(self, identifier: str) -> Json | None:
        """One contribution of this person, or ``None``."""
        return next((c for c in self.view()["contributions"] if c["id"] == identifier), None)

    def active_for(self, cited: Json) -> Json | None:
        """This person's active contribution for exactly this citation."""
        return next(
            (c for c in self.view()["contributions"] if c["status"] == "active" and _same(c, cited)), None
        )

    async def _write(self, body: Any, kind: str, value_of: Any, check: Any) -> Json:
        """Idempotent, version-checked append."""
        async with self._queue:
            if not isinstance(body, dict) or not valid_id(body.get("idempotencyKey")):
                raise KnowledgeError(
                    400, "INVALID_REQUEST", "An idempotency key of 8 to 80 safe characters is required."
                )
            value = value_of(body)
            identity = digest({"kind": kind, "value": value})
            state = rebuild(self._document)
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
                raise KnowledgeError(413, "KNOWLEDGE_LIMIT", "The contribution ledger is full.")
            check(value, state)
            event = {
                "number": len(self._document["events"]) + 1,
                "key": key,
                "fingerprint": identity,
                "kind": kind,
                "value": value,
                "at": iso_now(),
            }
            following = {**self._document, "events": [*self._document["events"], detached(event)]}
            rebuild(following)
            _atomic_write(self._file, following)
            self._document = following
            return {**self.view(), "replayed": False}

    async def contribute(self, body: Any, verified: Json) -> Json:
        """Record a contribution for a citation Frige has just verified (``verified``)."""

        def value_of(data: Json) -> Json:
            cited = citation(data.get("citation"))
            # A stable id per key and citation, so an identical retry has an identical fingerprint.
            seed = hashlib.sha256(
                f"{data['idempotencyKey']}\n{json.dumps(cited, sort_keys=True)}".encode()
            ).hexdigest()
            return _record(
                {
                    "id": f"ctb-{seed[:16]}",
                    **cited,
                    "originalSha256": verified.get("originalSha256"),
                    "title": verified.get("title"),
                }
            )

        def check(value: Json, state: Json) -> None:
            active = [c for c in state["contributions"] if c["status"] == "active"]
            if any(_same(c, value) for c in active):
                raise KnowledgeError(
                    409, "ALREADY_CONTRIBUTED", "You have already approved this passage for Igor."
                )
            if len(active) >= MAX_ACTIVE:
                raise KnowledgeError(413, "KNOWLEDGE_LIMIT", "Withdraw a contribution before adding another.")

        return await self._write(body, "contribute", value_of, check)

    async def withdraw(self, body: Any) -> Json:
        """Withdraw one of this person's active contributions."""

        def value_of(data: Json) -> str:
            identifier = data.get("id")
            if not isinstance(identifier, str) or _ID.fullmatch(identifier) is None:
                raise KnowledgeError(400, "INVALID_REQUEST", "Name one of your contributions.")
            return identifier

        def check(value: str, state: Json) -> None:
            record = next((c for c in state["contributions"] if c["id"] == value), None)
            if record is None:
                raise KnowledgeError(404, "NOT_FOUND", "That contribution does not exist.")
            if record["status"] != "active":
                raise KnowledgeError(409, "ALREADY_WITHDRAWN", "That contribution is already withdrawn.")

        return await self._write(body, "withdraw", value_of, check)

    async def erase(self) -> None:
        """Delete every contribution (a new empty ledger, still bound to the current journal)."""
        async with self._queue:
            following = {**_initial(), "journalGeneration": self._document.get("journalGeneration")}
            _atomic_write(self._file, following)
            self._document = following

    def rebind(self, journal_generation: str) -> None:
        """Follow the journal to its new generation after an erase (written with the next change)."""
        self._document = {**self._document, "journalGeneration": journal_generation}
