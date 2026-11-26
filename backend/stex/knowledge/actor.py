"""stex.platform.actor.v1 receiver and forwarder for the knowledge API (D-028).

Pantheon is the only sender. The platform API trusts the actor only when the
shared secret matches (constant-time comparison), and forwards the same three
headers to engines that verify them (Frige). Without a secret, actor headers
are ignored and requests act as the local single user. The token is never logged.
"""

from __future__ import annotations

import hmac
import re
from collections.abc import Mapping
from dataclasses import dataclass

ACTOR_HEADER = "x-stex-actor"
ACTOR_ROLE_HEADER = "x-stex-actor-role"
ACTOR_TOKEN_HEADER = "x-stex-platform-token"  # noqa: S105 - a header name, not a secret
ACTOR_RECEIVERS = frozenset({"frige"})
_HEADER_SAFE = re.compile(r"[\x21-\x7e]{1,128}")


@dataclass(frozen=True)
class Actor:
    """A verified person: the actor id Pantheon sent and their role."""

    id: str
    role: str

    def headers(self, secret: str) -> dict[str, str]:
        """The headers to forward to an engine that verifies the actor."""
        return {ACTOR_HEADER: self.id, ACTOR_ROLE_HEADER: self.role, ACTOR_TOKEN_HEADER: secret}


def verified_actor(headers: Mapping[str, str], secret: str | None) -> Actor | None:
    """Return the actor when the token matches the secret; otherwise ``None``."""
    if secret is None:
        return None
    supplied = headers.get(ACTOR_TOKEN_HEADER, "")
    actor = headers.get(ACTOR_HEADER, "")
    role = headers.get(ACTOR_ROLE_HEADER, "")
    if not supplied or not hmac.compare_digest(supplied.encode("utf-8"), secret.encode("utf-8")):
        return None
    if _HEADER_SAFE.fullmatch(actor) is None or role not in ("owner", "member"):
        return None
    return Actor(id=actor, role=role)
