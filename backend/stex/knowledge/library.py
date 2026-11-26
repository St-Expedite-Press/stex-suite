"""Per-person knowledge journals (D-028). Port of ``services/knowledge/src/library.mjs``.

Local mode keeps one journal in the configured directory and ignores the actor.
Hosted mode chooses ``<root>/people/<digest>/`` from the verified actor; the
pre-existing root journal is reachable only by ``legacy_owner``. Journals open
lazily, at most ``limit`` at once; only idle journals are evicted (closing
them releases their locks). A journal that cannot open fails closed for that
person only, and nothing is cached for it.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
from collections import OrderedDict
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from pathlib import Path

from stex.knowledge.journal import JOURNAL_FILE, DisabledJournal, Journal, KnowledgeError


def is_well_formed(text: str) -> bool:
    """``String.prototype.isWellFormed``: no lone surrogates."""
    return not any(0xD800 <= ord(char) <= 0xDFFF for char in text)


def person_directory_name(username: str) -> str:
    """First 32 hex digits of SHA-256 over the username, as the contract specifies."""
    digest = hashlib.sha256()
    if is_well_formed(username):
        digest.update(username.encode("utf-8"))
    else:
        # 0xff cannot occur in UTF-8; it separates escaped usernames from plain ones.
        digest.update(b"\xff")
        digest.update(json.dumps(username).encode("utf-8"))
    return digest.hexdigest()[:32]


@dataclass
class _Entry:
    task: asyncio.Task[Journal]
    leases: int = 0


@dataclass
class KnowledgeLibrary:
    """Chooses, opens and bounds the journals a request may use."""

    directory: Path | None
    hosted: bool = False
    legacy_owner: str = ""
    limit: int = 32
    _single: Journal | DisabledJournal | None = None
    _cache: OrderedDict[str, _Entry] = field(default_factory=OrderedDict)
    _closed: bool = False

    def __post_init__(self) -> None:
        """Validate the bound and open the local journal eagerly, as the Node library does."""
        if self.limit < 1:
            raise ValueError("The open-journal limit must be a positive integer.")
        if self.directory is None:
            self._single = DisabledJournal()
        elif not self.hosted:
            # Local mode: a held lock stops startup, existing data is used in place.
            self._single = Journal.open(self.directory)
        self._legacy = self.legacy_owner.strip().lower()

    def _directory_for(self, person: str) -> Path:
        """Legacy root for its named owner, otherwise the person's hashed people/ folder.

        ``person`` is the 32-hex directory name of the admitted username (see
        ``person_directory_name``); the legacy owner is matched by the same digest,
        which equals the Node library's ``username === legacyName`` comparison.
        """
        assert self.directory is not None  # noqa: S101 - hosted mode only
        if self._legacy and person == person_directory_name(self._legacy):
            return self.directory
        return self.directory / "people" / person

    async def _make_room(self) -> None:
        """Close idle least-recently-used journals until one slot is free."""
        while len(self._cache) >= self.limit:
            victim = next((name for name, entry in self._cache.items() if entry.leases == 0), None)
            if victim is None:
                raise KnowledgeError(
                    503, "KNOWLEDGE_BUSY", "Too many people are using knowledge at once. Try again shortly."
                )
            entry = self._cache.pop(victim)
            try:
                journal = await entry.task
                await journal.close()
            except Exception:  # noqa: S110 - a failed close must not poison the new request
                pass

    @asynccontextmanager
    async def lease(self, username: str | None) -> AsyncIterator[Journal | DisabledJournal]:
        """Lend the admitted person's journal for one request.

        ``username`` here is the person's journal directory name (32 hex digits),
        which the API derives from the verified actor.
        """
        if self._single is not None:
            yield self._single
            return
        if self._closed:
            raise KnowledgeError(503, "KNOWLEDGE_CLOSED", "Knowledge is shutting down.")
        if not username:
            raise KnowledgeError(401, "SIGN_IN_REQUIRED", "Sign in to use knowledge.")
        entry = self._cache.get(username)
        if entry is not None:
            self._cache.move_to_end(username)
        else:
            await self._make_room()
            entry = self._cache.get(username)
            if entry is None:
                if len(self._cache) >= self.limit:
                    raise KnowledgeError(
                        503,
                        "KNOWLEDGE_BUSY",
                        "Too many people are using knowledge at once. Try again shortly.",
                    )
                directory = self._directory_for(username)
                entry = _Entry(task=asyncio.ensure_future(asyncio.to_thread(Journal.open, directory)))
                self._cache[username] = entry
        entry.leases += 1
        try:
            try:
                journal = await asyncio.shield(entry.task)
            except Exception as error:
                if self._cache.get(username) is entry:
                    del self._cache[username]
                if isinstance(error, KnowledgeError):
                    raise
                raise KnowledgeError(
                    503,
                    "KNOWLEDGE_UNAVAILABLE",
                    "Your knowledge journal cannot be opened; it has been preserved.",
                ) from error
            yield journal
        finally:
            entry.leases -= 1

    def legacy_state(self) -> str:
        """Presence of a pre-existing root journal and whether it is assigned (never contents)."""
        if not self.hosted or self.directory is None:
            return "none"
        if not (self.directory / JOURNAL_FILE).exists():
            return "none"
        return "assigned" if self._legacy else "unassigned"

    def open_count(self) -> int:
        """Journals currently held open (including opening ones)."""
        return len(self._cache) if self._single is None else (1 if isinstance(self._single, Journal) else 0)

    async def close(self) -> None:
        """Close every journal, releasing all writer locks. Idempotent."""
        self._closed = True
        if self._single is not None:
            await self._single.close()
            return
        entries = list(self._cache.values())
        self._cache.clear()
        for entry in entries:
            try:
                journal = await entry.task
                await journal.close()
            except Exception:  # noqa: S112 - best effort shutdown
                continue
