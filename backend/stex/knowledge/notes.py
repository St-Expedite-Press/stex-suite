"""Read-only Obsidian note import (``stex.knowledge.notes.v1``), the first vault step.

One explicitly selected vault root (``STEX_KNOWLEDGE_VAULT_DIR``) is read, never
written. Importing a note records only metadata in the person's journal
directory (``notes.v1.json``): vault-relative path, SHA-256 of its bytes, size,
title, frontmatter key names and its wikilinks with their resolved targets.
Retrieval reads the note again, refuses it if its bytes changed since import,
and returns bounded snippets. There is no sync, no write-back, no watcher and
no index; the vault is never used as operational storage.

Path hardening (services/knowledge/AGENTS.md): relative paths only; no ``..``,
drive letters, alternate data streams, reserved Windows device names, or
segments ending in a dot or space; every segment must be a real directory or
file (no symlinks or junctions) and the resolved path must stay inside the root.

Scope: local mode only. In hosted mode a single vault root would cross
personal boundaries, so the routes refuse until an identity-aware vault
decision exists (Obsidian gate, docs/PLATFORM-TRANSITION.md).
"""

from __future__ import annotations

import hashlib
import json
import os
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
    token,
    valid_id,
)
from stex.knowledge.jsjson import digest, iso_now

SCHEMA = "stex.knowledge.notes.v1"
FILE = "notes.v1.json"
MAX_NOTE_BYTES = 262_144
MAX_NOTES = 200
MAX_SCAN_FILES = 5_000
MAX_LINKS = 100
MAX_RESULTS = 10
SNIPPET_CHARS = 240
MAX_RESULT_BYTES = 16_384
_RESERVED = re.compile(r"(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?", re.IGNORECASE)
_SEGMENT_BAD = re.compile(r'[\x00-\x1f<>:"|?*\\]')
_WIKILINK = re.compile(r"\[\[([^\]\|#\^]+)(?:#[^\]\|]*)?(?:\^[^\]\|]*)?(?:\|[^\]]*)?\]\]")
_HEADING = re.compile(r"^#\s+(.+?)\s*#*\s*$", re.MULTILINE)


def safe_relative(value: Any) -> str:
    """Validate a vault-relative Markdown path (forward slashes)."""
    if not isinstance(value, str) or not value or len(value) > 512 or value.startswith(("/", "\\")):
        raise KnowledgeError(400, "INVALID_REQUEST", "Name a Markdown note by its path inside the vault.")
    segments = value.split("/")
    for segment in segments:
        if (
            not segment
            or segment in (".", "..")
            or _SEGMENT_BAD.search(segment)
            or segment[-1] in ". "
            or _RESERVED.fullmatch(segment)
        ):
            raise KnowledgeError(400, "INVALID_REQUEST", "Name a Markdown note by its path inside the vault.")
    if not segments[-1].lower().endswith(".md"):
        raise KnowledgeError(400, "INVALID_REQUEST", "Only Markdown notes can be imported.")
    return value


def _resolve(root: Path, relative: str) -> Path:
    """The note path, refusing links, junctions and escapes at every segment."""
    current = root
    for segment in relative.split("/"):
        current = current / segment
        try:
            info = current.lstat()
        except FileNotFoundError as error:
            raise KnowledgeError(404, "NOT_FOUND", "That note does not exist in the vault.") from error
        if (
            current.is_symlink() or getattr(info, "st_file_attributes", 0) & 0x400
        ):  # FILE_ATTRIBUTE_REPARSE_POINT
            raise KnowledgeError(403, "FORBIDDEN", "Linked vault paths cannot be imported.")
    resolved = current.resolve(strict=True)
    if not resolved.is_file() or os.path.commonpath([str(resolved), str(root)]) != str(root):
        raise KnowledgeError(403, "FORBIDDEN", "That path is outside the selected vault.")
    return resolved


def _read(root: Path, relative: str) -> bytes:
    """Read a note's bytes within the size bound."""
    path = _resolve(root, relative)
    if path.stat().st_size > MAX_NOTE_BYTES:
        raise KnowledgeError(413, "NOTE_LIMIT", "That note is larger than 256 KB.")
    return path.read_bytes()


def _frontmatter(text: str) -> tuple[list[str], str | None, str]:
    """Frontmatter key names, its title value, and the body after it.

    Line endings are normalised for parsing only (notes edited on Windows use CRLF);
    digests always cover the exact bytes.
    """
    text = text.replace("\r\n", "\n")
    if not text.startswith("---\n"):
        return [], None, text
    end = text.find("\n---", 4)
    if end < 0:
        return [], None, text
    keys: list[str] = []
    title: str | None = None
    for line in text[4:end].splitlines():
        match = re.match(r"([A-Za-z0-9_-]{1,64}):\s*(.*)$", line)
        if match:
            keys.append(match.group(1))
            if match.group(1) == "title" and match.group(2).strip():
                title = match.group(2).strip().strip("\"'")[:300]
    return keys, title, text[end + 4 :].lstrip("\n")


def _vault_index(root: Path) -> dict[str, list[str]]:
    """Lower-cased note names to vault-relative paths (bounded; links never followed)."""
    index: dict[str, list[str]] = {}
    count = 0
    for directory, folders, files in os.walk(root, followlinks=False):
        folders[:] = sorted(
            f for f in folders if not f.startswith(".") and not (Path(directory) / f).is_symlink()
        )
        for name in sorted(files):
            count += 1
            if count > MAX_SCAN_FILES:
                return index
            if name.lower().endswith(".md") and not (Path(directory) / name).is_symlink():
                relative = (Path(directory) / name).relative_to(root).as_posix()
                index.setdefault(name[:-3].lower(), []).append(relative)
                index.setdefault(relative[:-3].lower(), []).append(relative)
    return index


def _links(body: str, index: dict[str, list[str]]) -> list[Json]:
    """Wikilinks with Obsidian-style resolution (exact path, else shortest matching name)."""
    links: list[Json] = []
    seen: set[str] = set()
    for match in _WIKILINK.finditer(body):
        target = match.group(1).strip()
        if not target or target in seen:
            continue
        seen.add(target)
        candidates = sorted(
            index.get(target.lower().removesuffix(".md"), []), key=lambda path: (path.count("/"), path)
        )
        links.append({"target": target[:300], "resolved": candidates[0] if candidates else None})
        if len(links) >= MAX_LINKS:
            break
    return links


def describe(root: Path, relative: str) -> Json:
    """The metadata recorded for one note (never its text)."""
    data = _read(root, relative)
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError as error:
        raise KnowledgeError(400, "INVALID_SOURCE", "That note is not valid UTF-8.") from error
    keys, title, body = _frontmatter(text)
    heading = _HEADING.search(body)
    name = relative.rsplit("/", 1)[-1][:-3]
    return {
        "path": relative,
        "sha256": hashlib.sha256(data).hexdigest(),
        "bytes": len(data),
        "title": (title or (heading.group(1) if heading else name))[:300],
        "properties": keys[:50],
        "links": _links(body, _vault_index(root)),
    }


def _initial() -> Json:
    """An empty notes ledger."""
    return {"schemaVersion": SCHEMA, "generation": str(uuid.uuid4()), "events": []}


def rebuild(document: Any) -> Json:
    """Replay the ledger: the latest import per path wins."""
    if (
        not isinstance(document, dict)
        or document.get("schemaVersion") != SCHEMA
        or not isinstance(document.get("events"), list)
    ):
        raise KnowledgeError(503, "INVALID_JOURNAL", "The notes ledger is unreadable; it has been preserved.")
    notes: dict[str, Json] = {}
    keys: dict[str, str] = {}
    for index, event in enumerate(document["events"]):
        if (
            not isinstance(event, dict)
            or event.get("number") != index + 1
            or not valid_id(event.get("key"))
            or event["key"] in keys
        ):
            raise KnowledgeError(
                503, "INVALID_JOURNAL", "The notes ledger has invalid ordering or identities."
            )
        keys[event["key"]] = str(event.get("fingerprint"))
        value = event.get("value")
        if event.get("kind") == "import" and isinstance(value, dict) and isinstance(value.get("path"), str):
            notes[value["path"]] = {**value, "importedAt": event.get("at")}
        elif event.get("kind") == "forget" and isinstance(value, str):
            notes.pop(value, None)
        else:
            raise KnowledgeError(503, "INVALID_JOURNAL", "The notes ledger contains an unknown event.")
    return {"version": token(document), "notes": list(notes.values()), "keys": keys}


class NoteLedger:
    """One person's imported-note metadata, sharing the journal directory's writer lock."""

    def __init__(self, file: Path, document: Json, journal: Journal) -> None:
        """Store validated state."""
        self._file = file
        self._document = document
        self._journal = journal

    @classmethod
    def of(cls, journal: Journal) -> NoteLedger:
        """The ledger beside a journal, cached on the journal's notes slot."""
        cached = getattr(journal, "notes_ledger", None)
        if isinstance(cached, NoteLedger):
            return cached
        file = journal.directory / FILE
        try:
            if file.stat().st_size > MAX_BYTES:
                raise KnowledgeError(503, "INVALID_JOURNAL", "The notes ledger exceeds its size limit.")
            document = json.loads(file.read_text(encoding="utf-8"))
        except FileNotFoundError:
            document = _initial()
        except ValueError as error:
            raise KnowledgeError(
                503, "INVALID_JOURNAL", "The notes ledger is unreadable; it has been preserved."
            ) from error
        rebuild(document)
        journal.ensure_persisted()
        document = bind_ledger(file, document, journal.document["generation"], _initial)
        ledger = cls(file, document, journal)
        journal.notes_ledger = ledger
        return ledger

    def view(self) -> Json:
        """Imported notes (metadata only)."""
        state = rebuild(self._document)
        return detached({"schemaVersion": SCHEMA, "version": state["version"], "notes": state["notes"]})

    async def import_note(self, body: Any, root: Path) -> Json:
        """Record one note's metadata after reading it from the vault (read-only)."""
        async with self._journal.queue:
            if not isinstance(body, dict) or not valid_id(body.get("idempotencyKey")):
                raise KnowledgeError(
                    400, "INVALID_REQUEST", "An idempotency key of 8 to 80 safe characters is required."
                )
            value = describe(root, safe_relative(body.get("path")))
            identity = digest({"kind": "import", "value": value})
            state = rebuild(self._document)
            if body["idempotencyKey"] in state["keys"]:
                if state["keys"][body["idempotencyKey"]] != identity:
                    raise KnowledgeError(
                        409, "KEY_CONFLICT", "That key was used for a different knowledge operation."
                    )
                return {**self.view(), "replayed": True}
            if body.get("expectedVersion") != state["version"]:
                raise KnowledgeError(
                    409, "STALE_KNOWLEDGE", "Knowledge changed. Refresh before applying this operation."
                )
            if len(state["notes"]) >= MAX_NOTES and not any(
                n["path"] == value["path"] for n in state["notes"]
            ):
                raise KnowledgeError(413, "KNOWLEDGE_LIMIT", "Forget a note before importing another.")
            event = {
                "number": len(self._document["events"]) + 1,
                "key": body["idempotencyKey"],
                "fingerprint": identity,
                "kind": "import",
                "value": value,
                "at": iso_now(),
            }
            following = {**self._document, "events": [*self._document["events"], detached(event)]}
            rebuild(following)
            _atomic_write(self._file, following)
            self._document = following
            return {**self.view(), "replayed": False}

    async def erase(self) -> None:
        """Delete every imported note's metadata (the vault itself is never touched)."""
        async with self._journal.queue:
            following = {**_initial(), "journalGeneration": self._document.get("journalGeneration")}
            _atomic_write(self._file, following)
            self._document = following

    def rebind(self, journal_generation: str) -> None:
        """Follow the journal to its new generation after an erase."""
        self._document = {**self._document, "journalGeneration": journal_generation}

    def search(self, root: Path, query: Any) -> Json:
        """Bounded snippets from imported notes whose bytes still match their import."""
        if not isinstance(query, str) or not query.strip() or len(query) > 200:
            raise KnowledgeError(400, "INVALID_REQUEST", "Search for 1 to 200 characters.")
        terms = list(dict.fromkeys(re.findall(r"\w{2,}", query.lower())))[:8]
        if not terms:
            raise KnowledgeError(400, "INVALID_REQUEST", "Search for at least one word.")
        results: list[Json] = []
        unavailable: list[str] = []
        budget = MAX_RESULT_BYTES
        for note in self.view()["notes"]:
            try:
                data = _read(root, note["path"])
            except KnowledgeError:
                unavailable.append(note["path"])
                continue
            if hashlib.sha256(data).hexdigest() != note["sha256"]:
                unavailable.append(note["path"])  # changed since import: re-import to use it
                continue
            _keys, _title, body = _frontmatter(data.decode("utf-8", "replace"))
            for paragraph in re.split(r"\n\s*\n", body):
                lower = paragraph.lower()
                if all(term in lower for term in terms):
                    flat = " ".join(paragraph.split())
                    at = max(0, flat.lower().find(terms[0]) - 60)
                    snippet = flat[at : at + SNIPPET_CHARS]
                    size = len(snippet.encode("utf-8"))
                    if size > budget or len(results) >= MAX_RESULTS:
                        return {
                            "schemaVersion": SCHEMA,
                            "results": results,
                            "unavailable": unavailable,
                            "truncated": True,
                        }
                    budget -= size
                    results.append(
                        {
                            "path": note["path"],
                            "title": note["title"],
                            "sha256": note["sha256"],
                            "snippet": snippet,
                        }
                    )
        return {"schemaVersion": SCHEMA, "results": results, "unavailable": unavailable, "truncated": False}
