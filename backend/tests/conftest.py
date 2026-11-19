from __future__ import annotations

import json
from collections.abc import Awaitable, Callable
from typing import Any

import httpx2

from stex.config import REPOSITORY_ROOT

Handler = Callable[[httpx2.Request], httpx2.Response | Awaitable[httpx2.Response]]

FRIGE = "http://127.0.0.1:4310"
SEAXNEAT = "http://127.0.0.1:4320"
ORIGINS = {"frige": FRIGE, "seaxneat": SEAXNEAT}
PROTOCOL = REPOSITORY_ROOT / "protocol"


def summary(application: str, *projects: dict[str, Any]) -> dict[str, Any]:
    return {
        "schemaVersion": "stex.projects.summary.v1",
        "application": application,
        "projects": list(projects),
    }


def entry(
    identifier: str, updated_at: str | None = "2026-11-05T17:02:11.000Z", **overrides: Any
) -> dict[str, Any]:
    value: dict[str, Any] = {
        "reference": f"stex://frige/project/{identifier}",
        "id": identifier,
        "title": identifier.replace("-", " ").title(),
        "kind": "book",
        "updatedAt": updated_at,
        "status": {"state": "ready", "label": "Manuscript"},
        "openPath": f"/?book={identifier}",
    }
    value.update(overrides)
    return value


class Studios:
    """A fake network keyed by origin; records every request it receives."""

    def __init__(self, routes: dict[str, Handler]) -> None:
        self.routes = routes
        self.requests: list[httpx2.Request] = []

    async def __call__(self, request: httpx2.Request) -> httpx2.Response:
        self.requests.append(request)
        origin = f"{request.url.scheme}://{request.url.host}:{request.url.port}"
        handler = self.routes.get(origin)
        if handler is None:
            raise httpx2.ConnectError("connection refused", request=request)
        result = handler(request)
        return result if isinstance(result, httpx2.Response) else await result

    def transport(self) -> httpx2.MockTransport:
        return httpx2.MockTransport(self)


def json_reply(document: Any, status: int = 200) -> Handler:
    body = json.dumps(document).encode()
    return lambda _request: httpx2.Response(
        status, content=body, headers={"content-type": "application/json"}
    )
