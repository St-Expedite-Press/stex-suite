"""Owner calls for knowledge: Frige/Seaxneat ``stex.project.context.v1`` exports.

Port of the ``engine``/``catalog``/``accessible`` helpers in
``apps/pantheon/src/knowledge-api.mjs``. Every call is bounded (5 s, 64 KiB,
strict UTF-8 JSON), never follows redirects, and forwards the verified actor
only to engines that verify it. Access checks examine at most 40 sources, four
at a time, within one six-second deadline; unchecked sources are unavailable.
"""

from __future__ import annotations

import asyncio
import json
import re
from collections.abc import Mapping
from typing import Any

import httpx2

from stex.knowledge.actor import ACTOR_RECEIVERS, Actor
from stex.knowledge.journal import Json, KnowledgeError
from stex.knowledge.jsjson import stringify

CONTEXT_SCHEMA = "stex.project.context.v1"
MAX_RESPONSE_BYTES = 65_536
CALL_SECONDS = 5.0
ACCESS_SECONDS = 6.0
ACCESS_LIMIT = 40
ACCESS_CONCURRENCY = 4
_PROJECT = re.compile(r"stex://(frige|seaxneat)/project/([a-z0-9][a-z0-9-]{0,62})")
_OFFSET = re.compile(r"\d{1,5}")


def fail(status: int, message: str) -> KnowledgeError:
    """The host API's failure shape (no specific code)."""
    return KnowledgeError(status, "INVALID_REQUEST", message)


def project_reference(value: Any) -> Json:
    """Validate and split an engine-owned project reference."""
    match = _PROJECT.fullmatch(value) if isinstance(value, str) else None
    if match is None:
        raise fail(400, "Choose a known project reference.")
    return {"application": match.group(1), "id": match.group(2), "reference": value}


class OwnerClient:
    """Bounded calls to the engines' context exports."""

    def __init__(
        self,
        client: httpx2.AsyncClient,
        origins: Mapping[str, str],
        *,
        actor_secret: str | None = None,
    ) -> None:
        """Keep the shared HTTP client, the permitted engine origins and the actor secret."""
        self._client = client
        self._origins = dict(origins)
        self._secret = actor_secret

    async def call(
        self, project: Json, suffix: str = "", payload: Any = None, actor: Actor | None = None
    ) -> Json:
        """One owner request; any failure becomes 503, 409 or 502 as the Node host does."""
        origin = self._origins.get(project["application"])
        if origin is None:
            raise fail(503, "The source engine is unavailable.")
        url = f"{origin}/{project['application']}/api/stex/context/v1/projects/{project['id']}{suffix}"
        headers = {"content-type": "application/json", "accept-encoding": "identity"}
        if actor is not None and self._secret is not None and project["application"] in ACTOR_RECEIVERS:
            headers.update(actor.headers(self._secret))
        body = stringify(payload).encode("utf-8") if payload is not None else None
        try:
            async with (
                asyncio.timeout(CALL_SECONDS),
                self._client.stream(
                    "POST" if payload is not None else "GET", url, headers=headers, content=body
                ) as response,
            ):
                if 300 <= response.status_code < 400:
                    # fetch(redirect: 'error') throws on a redirect.
                    raise fail(503, "The source engine is unavailable.")
                if response.headers.get("content-encoding", "identity").lower() != "identity":
                    raise fail(502, "The engine returned an unreadable response.")
                chunks: list[bytes] = []
                size = 0
                async for chunk in response.aiter_bytes():
                    size += len(chunk)
                    if size > MAX_RESPONSE_BYTES:
                        raise fail(502, "The source response is too large.")
                    chunks.append(chunk)
        except KnowledgeError:
            raise
        except (TimeoutError, httpx2.HTTPError) as error:
            raise fail(503, "The source engine is unavailable.") from error
        try:
            result = json.loads(b"".join(chunks).decode("utf-8"))
        except (UnicodeDecodeError, ValueError, RecursionError) as error:
            raise fail(502, "The engine returned an unreadable response.") from error
        if not 200 <= response.status_code < 300:
            raise fail(
                409 if response.status_code == 409 else 503,
                "The source is unavailable or changed. Refresh before accepting.",
            )
        owner = result.get("project") if isinstance(result, dict) else None
        if (
            not isinstance(owner, dict)
            or owner.get("reference") != project["reference"]
            or owner.get("application") != project["application"]
            or owner.get("id") != project["id"]
        ):
            raise fail(502, "The engine returned a different project.")
        document: Json = result
        return document

    async def catalog(self, reference: Any, offset: str, actor: Actor | None) -> Json:
        """The owner's source catalog page."""
        if _OFFSET.fullmatch(offset) is None:
            raise fail(400, "Invalid source page.")
        project = project_reference(reference)
        result = await self.call(project, f"?offset={offset}", actor=actor)
        sources = result.get("sources")
        if (
            result.get("schemaVersion") != CONTEXT_SCHEMA
            or not isinstance(sources, list)
            or len(sources) > 50
        ):
            raise fail(502, "The engine returned an invalid source catalog.")
        return result

    async def accessible(self, view: Json, actor: Actor | None) -> Json:
        """Label each accepted source current or unavailable, and relations' evidence with it."""
        verified: set[str] = set()
        candidates = view["knowledge"]["sources"][:ACCESS_LIMIT]
        gate = asyncio.Semaphore(ACCESS_CONCURRENCY)

        async def check(source: Json) -> None:
            async with gate:
                try:
                    value = await self.call(
                        project_reference(source["project"]),
                        f"/sources/{source['id']}?revision={source['revision']}",
                        actor=actor,
                    )
                except KnowledgeError:
                    return
                entry = value.get("source")
                if (
                    value.get("schemaVersion") == CONTEXT_SCHEMA
                    and isinstance(entry, dict)
                    and entry.get("available")
                    and entry.get("reference") == source["reference"]
                    and entry.get("revision") == source["revision"]
                    and entry.get("originRevision") == source.get("originRevision")
                ):
                    verified.add(f"{source['reference']}:{source['revision']}")

        tasks = [asyncio.ensure_future(check(source)) for source in candidates]
        if tasks:
            _done, pending = await asyncio.wait(tasks, timeout=ACCESS_SECONDS)
            for task in pending:
                task.cancel()
        sources = [
            {
                **source,
                "access": "current"
                if f"{source['reference']}:{source['revision']}" in verified
                else "unavailable",
            }
            for source in view["knowledge"]["sources"]
        ]
        available = {f"{s['reference']}:{s['revision']}" for s in sources if s["access"] == "current"}
        relations = [
            {
                **relation,
                "evidenceState": "current"
                if all(f"{e['reference']}:{e['revision']}" in available for e in relation["evidence"])
                else "unavailable",
            }
            for relation in view["graph"]["relations"]
        ]
        return {**view, "knowledge": {"sources": sources}, "graph": {**view["graph"], "relations": relations}}
