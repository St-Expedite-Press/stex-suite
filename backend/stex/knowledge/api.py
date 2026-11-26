"""HTTP transport for ``/api/knowledge/v1`` on the platform API.

Same routes, bodies, limits and error shapes as the Node host
(``apps/pantheon/src/knowledge-api.mjs``; ``protocol/knowledge/README.md``).
Pantheon relays browser requests here (``apps/pantheon/src/knowledge-relay.mjs``)
after its own origin check; this API is never browser-facing.

Identity: in hosted mode the journal is chosen only from a verified
stex.platform.actor.v1 assertion; without one the answer is 401. In local mode
actor headers are ignored and the single configured journal is used.
"""

from __future__ import annotations

import json
import re
from collections.abc import Awaitable, Callable
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import Response

from stex.knowledge.actor import Actor, verified_actor
from stex.knowledge.contract import ROUTES, operation
from stex.knowledge.contributions import ContributionLedger
from stex.knowledge.engine import OwnerClient, fail, project_reference
from stex.knowledge.journal import DisabledJournal, Journal, Json, KnowledgeError
from stex.knowledge.jsjson import stringify
from stex.knowledge.library import KnowledgeLibrary, person_directory_name
from stex.knowledge.notes import NoteLedger

PREFIX = "/api/knowledge/v1"
RESOLVE_ROUTE = "/contributions/resolve"
# Igor's own credential header for the resolve route (STEX_KNOWLEDGE_IGOR_SECRET).
IGOR_TOKEN_HEADER = "x-stex-knowledge-token"  # noqa: S105 - a header name, not a secret
MAX_REQUEST_BYTES = 16_384
# The journal directory Pantheon computed from the admitted username (32 hex digits).
PERSON_HEADER = "x-stex-actor-journal"
_PERSON = re.compile(r"[0-9a-f]{32}")
_DIGEST_ACTOR = re.compile(r"sha256-[0-9a-f]{64}")
_JSON_TYPE = re.compile(r"application/json\s*(;|$)", re.IGNORECASE)

router = APIRouter()

# Routes added by later contract versions register here: (method, route) -> handler.
Handler = Callable[["KnowledgeContext", Json], Awaitable[Json | None]]
EXTRA_ROUTES: dict[tuple[str, str], Handler] = {}


class KnowledgeContext:
    """Everything a route handler needs for one request."""

    def __init__(self, journal: Journal, owners: OwnerClient, actor: Actor | None, request: Request) -> None:
        """Bind the leased journal, owner client, verified actor and request."""
        self.journal = journal
        self.owners = owners
        self.actor = actor
        self.request = request


def reply(status: int, value: Any) -> Response:
    """A JSON answer serialized exactly as the Node host does."""
    return Response(
        content=stringify(value).encode("utf-8", "replace"),
        status_code=status,
        media_type="application/json; charset=utf-8",
        headers={"cache-control": "no-store", "x-content-type-options": "nosniff"},
    )


def person_for(request: Request, actor: Actor | None) -> str | None:
    """Journal directory for a verified actor; checked against the actor id when it is a username."""
    if actor is None:
        return None
    person = request.headers.get(PERSON_HEADER, "")
    if _PERSON.fullmatch(person) is None:
        return None
    if _DIGEST_ACTOR.fullmatch(actor.id) is None and person != person_directory_name(actor.id):
        return None
    return person


async def read_body(request: Request) -> Any:
    """A bounded, strictly decoded JSON request body."""
    size = 0
    parts: list[bytes] = []
    async for part in request.stream():
        size += len(part)
        if size > MAX_REQUEST_BYTES:
            raise fail(413, "Keep this request below 16,384 bytes.")
        parts.append(part)
    try:
        return json.loads(b"".join(parts).decode("utf-8"))
    except (UnicodeDecodeError, ValueError, RecursionError) as error:
        raise fail(400, "Send a valid UTF-8 JSON request.") from error


async def _post(context: KnowledgeContext, route: str, data: Any) -> None:
    """The v1 mutations."""
    journal = context.journal
    if not isinstance(data, dict):
        data = {}
    if route == "/accept":
        project = project_reference(data.get("project"))
        sources = data.get("sources")
        if not isinstance(sources, list) or not 0 < len(sources) <= 4:
            raise fail(400, "Select one to four explicit sources.")
        # The owner checks each revision and creates a durable monotonic event.
        event = await context.owners.call(project, "/observation", {"sources": sources}, context.actor)
        returned = event.get("sources")
        if (
            event.get("schemaVersion") != "stex.knowledge.event.v1"
            or not isinstance(returned, list)
            or len(returned) != len(sources)
            or any(
                not any(
                    isinstance(entry, dict)
                    and isinstance(source, dict)
                    and source.get("id") == entry.get("id")
                    and source.get("revision") == entry.get("revision")
                    for entry in sources
                )
                for source in returned
            )
        ):
            raise fail(502, "The engine returned a different observation.")
        await journal.accept(
            {
                "idempotencyKey": data.get("idempotencyKey"),
                "expectedVersion": data.get("expectedVersion"),
                "event": event,
            }
        )
    elif route == "/revoke":
        await journal.revoke(data)
    elif route == "/relation":
        current = await context.owners.accessible(journal.view(), context.actor)
        relation = data.get("relation")
        evidence = relation.get("evidence") if isinstance(relation, dict) else None
        if (
            not isinstance(evidence, list)
            or not evidence
            or any(
                not isinstance(entry, dict)
                or not any(
                    source["access"] == "current"
                    and source["reference"] == entry.get("reference")
                    and source["revision"] == entry.get("revision")
                    for source in current["knowledge"]["sources"]
                )
                for entry in evidence
            )
        ):
            raise fail(409, "Relationship evidence must be a current, accepted source revision.")
        await journal.relation(data)
    elif route == "/revise":
        await journal.revise(data)
    elif route == "/erase":
        # Erasure covers everything this service holds for the person: the journal, contributions and
        # imported-note metadata. Every ledger is loaded (a damaged one refuses) and the version checked
        # before anything is deleted; ledgers go first, so a failure never leaves the journal erased while
        # contributions remain resolvable, and a retry against the unchanged journal version succeeds.
        if (
            not isinstance(data, dict)
            or data.get("confirmation") != "delete-knowledge"
            or data.get("expectedVersion") != journal.view()["version"]
        ):
            raise KnowledgeError(
                409, "STALE_KNOWLEDGE", "Confirm deletion against the current knowledge version."
            )
        ledgers = (ContributionLedger.of(journal), NoteLedger.of(journal))
        for ledger in ledgers:
            await ledger.erase()
        await journal.erase(data)
        for ledger in ledgers:
            ledger.rebind(journal.document["generation"])
    else:
        raise fail(404, "Unknown knowledge route.")


async def knowledge(request: Request) -> Response:
    """Serve one knowledge request against the caller's own journal."""
    library: KnowledgeLibrary = request.app.state.knowledge
    owners: OwnerClient = request.app.state.knowledge_owners
    secret: str | None = request.app.state.knowledge_secret
    actor = verified_actor(request.headers, secret)
    if actor is None and request.url.path == PREFIX + RESOLVE_ROUTE:
        # Igor may assert its signed-in account with its own secret, on the resolve route only.
        actor = verified_actor(
            request.headers, request.app.state.knowledge_igor_secret, token_header=IGOR_TOKEN_HEADER
        )
    try:
        async with library.lease(person_for(request, actor) if library.hosted else None) as journal:
            if isinstance(journal, DisabledJournal):
                return reply(200, {"enabled": False})
            route = request.url.path[len(PREFIX) :]
            context = KnowledgeContext(journal, owners, actor, request)
            if request.method == "GET":
                if route in ("", "/"):
                    view = await owners.accessible(journal.view(), actor)
                    if library.legacy_state() == "unassigned":
                        view = {**view, "legacyJournal": "unassigned"}
                    return reply(200, view)
                if route == "/sources":
                    return reply(
                        200,
                        await owners.catalog(
                            request.query_params.get("project"),
                            request.query_params.get("offset") or "0",
                            actor,
                        ),
                    )
                if route == "/export":
                    return reply(200, journal.export())
                handler = EXTRA_ROUTES.get(("GET", route))
                if handler is None:
                    raise fail(404, "Unknown knowledge route.")
                return reply(200, await handler(context, dict(request.query_params)))
            if request.method != "POST":
                raise fail(405, "Method not allowed.")
            if _JSON_TYPE.match(request.headers.get("content-type", "")) is None:
                raise fail(415, "Knowledge requests must be JSON.")
            data = await read_body(request)
            handler = EXTRA_ROUTES.get(("POST", route))
            if handler is not None:
                result = await handler(context, data if isinstance(data, dict) else {})
                if result is not None:
                    return reply(200, result)
            else:
                await _post(context, route, data)
            return reply(200, await owners.accessible(journal.view(), actor))
    except KnowledgeError as error:
        return reply(error.status, {"error": error.message, "code": error.code})
    except Exception:
        return reply(400, {"error": "Knowledge could not apply this request.", "code": "INVALID_REQUEST"})


# Documented routes first (one OpenAPI operation each, payloads from protocol/ schema files),
# then the undocumented catch-alls, so unknown paths keep the Node host's 404/405 semantics.
for _route in ROUTES:
    _spec = operation(_route)
    router.add_api_route(
        PREFIX + _route.path,
        knowledge,
        methods=[_route.method],
        summary=_route.summary,
        operation_id=f"knowledge_{_route.method.lower()}{_route.path.replace('/', '_') or '_root'}",
        tags=["knowledge"],
        responses=_spec["responses"],
        openapi_extra=_spec["openapi_extra"],
        response_class=Response,
    )
router.add_api_route(
    PREFIX, knowledge, methods=["GET", "POST", "PUT", "PATCH", "DELETE"], include_in_schema=False
)
router.add_api_route(
    PREFIX + "/{rest:path}",
    knowledge,
    methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    include_in_schema=False,
)
