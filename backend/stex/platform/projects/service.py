"""Merge each active studio's ``stex.projects.summary.v1`` without reading its storage.

Behaviour follows the consumer rules in ``protocol/projects/README.md`` and
Pantheon's browser loader (``apps/pantheon/public/projects.js``):

* a studio that does not answer within its time budget, or answers with
  anything other than a v1 document for that studio, is unavailable while
  the other studios' projects are kept;
* entries that break the openPath, title, kind or status rules are dropped;
* projects sort newest first; a missing or unparsable time sorts as oldest.

Nothing is cached and no studio file is ever read as a fallback.
"""

from __future__ import annotations

import asyncio
import json
import re
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime
from typing import Any

import httpx2

from stex.platform.projects.models import PlatformProject, PlatformProjects, ProjectStatus, StudioAvailability
from stex.platform.registry import Application, Registry

SUMMARY_SCHEMA = "stex.projects.summary.v1"
# Requested at the studio's registry mount (e.g. /frige/), exactly as Pantheon's proxy forwards it.
SUMMARY_PATH = "api/stex/projects"
_STATES = frozenset({"ready", "working", "attention", "failed"})
_ROOTED_PATH = re.compile(r"^/(?!/)")
_PARENT_SEGMENT = re.compile(r"(^|/)\.\.(/|\?|$)")


class InvalidSummaryError(ValueError):
    """The studio answered, but not with a usable v1 summary."""


def _reject_constant(value: str) -> None:
    raise InvalidSummaryError(f"non-standard JSON constant {value}")


def valid_entry(entry: object) -> bool:
    if not isinstance(entry, dict):
        return False
    title, open_path, status = entry.get("title"), entry.get("openPath"), entry.get("status")
    return (
        isinstance(entry.get("id"), str)
        and isinstance(title, str)
        and bool(title)
        and isinstance(entry.get("kind"), str)
        and isinstance(open_path, str)
        and _ROOTED_PATH.match(open_path) is not None
        and _PARENT_SEGMENT.search(open_path) is None
        and isinstance(status, dict)
        and status.get("state") in _STATES
        and isinstance(status.get("label"), str)
    )


def sort_time(value: str | None) -> float:
    """Seconds since the epoch, or 0 when absent or unparsable (JS ``Date.parse(x) || 0``)."""
    if value is None:
        return 0.0
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return 0.0
    return (parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)).timestamp()


def _text(value: str) -> str:
    """Replace lone surrogates (valid JSON escapes, invalid UTF-8) so the reply always serializes."""
    return value.encode("utf-8", "replace").decode("utf-8")


def _project(application: Application, entry: dict[str, Any]) -> PlatformProject:
    reference, updated_at = entry.get("reference"), entry.get("updatedAt")
    open_path = _text(entry["openPath"])
    return PlatformProject(
        studio=application.id,
        reference=_text(reference) if isinstance(reference, str) else None,
        id=_text(entry["id"]),
        title=_text(entry["title"]),
        kind=_text(entry["kind"]),
        updated_at=_text(updated_at) if isinstance(updated_at, str) else None,
        status=ProjectStatus(state=entry["status"]["state"], label=_text(entry["status"]["label"])),
        open_path=open_path,
        href=application.route + open_path[1:],
    )


class ProjectSummaryService:
    def __init__(
        self,
        registry: Registry,
        engine_origins: Mapping[str, str],
        client: httpx2.AsyncClient,
        *,
        timeout_seconds: float = 2.0,
        max_bytes: int = 2_000_000,
    ) -> None:
        self._registry = registry
        self._origins = dict(engine_origins)
        self._client = client
        self._timeout = timeout_seconds
        self._max_bytes = max_bytes

    async def list_projects(self) -> PlatformProjects:
        studios = self._registry.active_studios()
        loaded = await asyncio.gather(*(self._load(studio) for studio in studios))
        projects = [project for result in loaded if result is not None for project in result]
        projects.sort(key=lambda project: sort_time(project.updated_at), reverse=True)
        return PlatformProjects(
            studios=tuple(
                StudioAvailability(id=studio.id, state="unavailable" if result is None else "available")
                for studio, result in zip(studios, loaded, strict=True)
            ),
            projects=tuple(projects),
        )

    async def _load(self, application: Application) -> Sequence[PlatformProject] | None:
        origin = self._origins.get(application.id)
        if origin is None:
            return None
        try:
            async with asyncio.timeout(self._timeout):
                entries = await self._fetch(origin + application.route + SUMMARY_PATH, application.id)
        except (TimeoutError, httpx2.HTTPError, InvalidSummaryError, ValueError, RecursionError):
            # ValueError covers malformed JSON; RecursionError a pathologically nested body.
            return None
        return [_project(application, entry) for entry in entries if valid_entry(entry)]

    async def _fetch(self, url: str, application_id: str) -> list[Any]:
        # identity encoding: the size bound applies to bytes as sent, not after decompression.
        headers = {"accept": "application/json", "accept-encoding": "identity"}
        async with self._client.stream("GET", url, headers=headers) as response:
            if not response.is_success:
                raise InvalidSummaryError(f"status {response.status_code}")
            if response.headers.get("content-encoding", "identity").lower() != "identity":
                raise InvalidSummaryError("compressed summaries are refused")
            body = bytearray()
            async for chunk in response.aiter_bytes():
                body.extend(chunk)
                if len(body) > self._max_bytes:
                    raise InvalidSummaryError("summary exceeds the size bound")
        # Decode as the browser's response.json() does: UTF-8, BOM stripped, invalid bytes replaced.
        text = bytes(body).decode("utf-8", "replace").removeprefix("﻿")
        document = json.loads(text, parse_constant=_reject_constant)
        if (
            not isinstance(document, dict)
            or document.get("schemaVersion") != SUMMARY_SCHEMA
            or document.get("application") != application_id
            or not isinstance(document.get("projects"), list)
        ):
            raise InvalidSummaryError("not a v1 summary for this studio")
        projects: list[Any] = document["projects"]
        return projects
