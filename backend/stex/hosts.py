"""Request admission by Host and browser origin for the platform API.

The platform binds loopback (or, in the explicit container opt-in, an internal
network). Binding alone does not stop a DNS-rebinding page in the user's
browser from reaching it under a foreign name, and in local mode the knowledge
routes need no credential. Pantheon, Frige and Igor therefore answer only
requests addressed to their own local names; this middleware gives the
platform the same rule:

- ``Host`` must be a loopback name or one of the fixed peer service names in
  ``STEX_INTERNAL_HOSTS``, with an optional numeric port;
- a browser's ``Sec-Fetch-Site: cross-site`` is refused;
- an ``Origin`` header, which no legitimate (server-side) caller sends, must
  name an admitted host over ``http``.

Anything else is answered ``403`` before routing.
"""

from __future__ import annotations

import json
import re
from collections.abc import Awaitable, Callable, MutableMapping
from typing import Any

Scope = MutableMapping[str, Any]
Message = MutableMapping[str, Any]
Receive = Callable[[], Awaitable[Message]]
Send = Callable[[Message], Awaitable[None]]
ASGIApp = Callable[[Scope, Receive, Send], Awaitable[None]]

LOOPBACK_NAMES = frozenset({"127.0.0.1", "localhost", "[::1]"})
_HOST = re.compile(r"(?P<name>\[::1\]|[A-Za-z0-9.-]{1,253})(?::(?P<port>[0-9]{1,5}))?")
_ORIGIN = re.compile(r"http://(?P<host>[^/?#]+)")


def host_name(value: str) -> str | None:
    """Return the lower-cased name of a ``Host`` value without its port, or ``None`` if malformed."""
    match = _HOST.fullmatch(value)
    if match is None:
        return None
    port = match.group("port")
    if port is not None and not 0 < int(port) < 65536:
        return None
    return match.group("name").lower()


def admitted(headers: list[tuple[bytes, bytes]], hosts: frozenset[str]) -> bool:
    """Whether a request's headers name an admitted host and no foreign browser origin."""
    values: dict[bytes, list[str]] = {}
    for key, value in headers:
        values.setdefault(key.lower(), []).append(value.decode("latin-1"))
    host = values.get(b"host", [])
    if len(host) != 1 or host_name(host[0]) not in hosts:
        return False
    if any(site.strip().lower() == "cross-site" for site in values.get(b"sec-fetch-site", [])):
        return False
    for origin in values.get(b"origin", []):
        match = _ORIGIN.fullmatch(origin.strip())
        if match is None or host_name(match.group("host")) not in hosts:
            return False
    return True


class HostAdmission:
    """ASGI middleware that refuses requests not addressed to the platform's own names."""

    def __init__(self, app: ASGIApp, internal_hosts: frozenset[str] = frozenset()) -> None:
        """Admit loopback names plus the configured internal service names."""
        self.app = app
        self.hosts = LOOPBACK_NAMES | frozenset(name.lower() for name in internal_hosts)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        """Pass admitted HTTP and WebSocket requests through; answer others 403."""
        if scope["type"] not in ("http", "websocket") or admitted(list(scope.get("headers", [])), self.hosts):
            await self.app(scope, receive, send)
            return
        if scope["type"] == "websocket":
            await send({"type": "websocket.close", "code": 1008})
            return
        body = json.dumps({"error": "The platform API answers only on its local address."}).encode()
        await send(
            {
                "type": "http.response.start",
                "status": 403,
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"content-length", str(len(body)).encode()),
                ],
            }
        )
        await send({"type": "http.response.body", "body": body})
