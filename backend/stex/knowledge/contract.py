"""The documented ``/api/knowledge/v1`` routes and their published JSON Schemas.

``ROUTES`` is the single list of documented routes: each names its request
and response definitions in the versioned schema files under ``protocol/``
(the owning boundaries: ``protocol/knowledge`` for the knowledge API,
``protocol/frige`` for the Frige passage payloads it relays). The platform
registers one OpenAPI operation per entry and loads every ``$defs`` entry of
those files into ``components.schemas``, so the generated document is built
from the published files rather than restating them. Tests fail if the README
route tables, this list, the schema files or the committed OpenAPI drift apart.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from functools import cache
from typing import Any

from stex.config import REPOSITORY_ROOT

PROTOCOL = REPOSITORY_ROOT / "protocol"
# Component prefix -> schema file (relative to protocol/).
SCHEMA_FILES = {
    "knowledge.api.v1": "knowledge/api.v1.schema.json",
    "knowledge.contributions.v1": "knowledge/contributions.v1.schema.json",
    "knowledge.notes.v1": "knowledge/notes.v1.schema.json",
    "frige.passages.v1": "frige/passages.v1.schema.json",
}
ERROR = ("knowledge.api.v1", "error")


@dataclass(frozen=True)
class Route:
    """One documented route: method, path below the prefix, and its payload definitions."""

    method: str
    path: str
    summary: str
    response: tuple[str, str]
    request: tuple[str, str] | None = None
    query: tuple[str, ...] = ()
    errors: tuple[int, ...] = (400, 503)


ROUTES: tuple[Route, ...] = (
    Route(
        "GET",
        "",
        "Both knowledge views with current owner access labels",
        ("knowledge.api.v1", "view"),
        errors=(401, 503),
    ),
    Route(
        "GET",
        "/sources",
        "Owner source catalog page",
        ("knowledge.api.v1", "sources"),
        query=("project", "offset"),
        errors=(400, 401, 409, 502, 503),
    ),
    Route(
        "GET",
        "/export",
        "Detached journal and views (no source text)",
        ("knowledge.api.v1", "export"),
        errors=(401, 503),
    ),
    Route(
        "POST",
        "/accept",
        "Accept owner-verified source revisions",
        ("knowledge.api.v1", "view"),
        ("knowledge.api.v1", "acceptRequest"),
        errors=(400, 401, 409, 413, 415, 502, 503),
    ),
    Route(
        "POST",
        "/revoke",
        "Withdraw consent for a project",
        ("knowledge.api.v1", "view"),
        ("knowledge.api.v1", "revokeRequest"),
        errors=(400, 401, 404, 409, 415),
    ),
    Route(
        "POST",
        "/relation",
        "Record an assertion or a reviewable inference",
        ("knowledge.api.v1", "view"),
        ("knowledge.api.v1", "relationRequest"),
        errors=(400, 401, 409, 415),
    ),
    Route(
        "POST",
        "/revise",
        "Accept, reject or correct a relationship",
        ("knowledge.api.v1", "view"),
        ("knowledge.api.v1", "reviseRequest"),
        errors=(400, 401, 404, 409, 415),
    ),
    Route(
        "POST",
        "/erase",
        "Erase this person's journal, contributions included",
        ("knowledge.api.v1", "view"),
        ("knowledge.api.v1", "eraseRequest"),
        errors=(401, 409, 415),
    ),
    Route(
        "GET",
        "/passages/search",
        "Search approved Frige excerpts; marks only the caller's own approvals",
        ("knowledge.contributions.v1", "passageSearchResponse"),
        query=("project", "q"),
        errors=(400, 401, 404, 502, 503),
    ),
    Route(
        "GET",
        "/passages/read",
        "Read one cited passage, re-verified by Frige",
        ("knowledge.contributions.v1", "passageReadResponse"),
        query=("project", "attachment", "excerpt", "start", "end", "passage"),
        errors=(400, 401, 404, 409, 502, 503),
    ),
    Route(
        "GET",
        "/contributions",
        "The caller's contributions with live state (no text)",
        ("knowledge.contributions.v1", "contributionsView"),
        errors=(401, 503),
    ),
    Route(
        "POST",
        "/contributions",
        "Approve one passage revision for Igor (private)",
        ("knowledge.contributions.v1", "contributionsView"),
        ("knowledge.contributions.v1", "contributeRequest"),
        errors=(400, 401, 404, 409, 413, 415, 503),
    ),
    Route(
        "POST",
        "/contributions/withdraw",
        "Withdraw a contribution from all future use",
        ("knowledge.contributions.v1", "contributionsView"),
        ("knowledge.contributions.v1", "withdrawRequest"),
        errors=(400, 401, 404, 409, 415),
    ),
    Route(
        "POST",
        "/contributions/resolve",
        "Igor's pre-use check: consent and source revision",
        ("knowledge.contributions.v1", "resolved"),
        ("knowledge.contributions.v1", "resolveRequest"),
        errors=(400, 401, 404, 409, 410, 415, 503),
    ),
    Route(
        "GET",
        "/notes",
        "Imported notes with current/changed/missing state",
        ("knowledge.notes.v1", "notesView"),
        errors=(401, 403, 503),
    ),
    Route(
        "POST",
        "/notes/import",
        "Import one vault note's metadata (read-only)",
        ("knowledge.notes.v1", "notesView"),
        ("knowledge.notes.v1", "importRequest"),
        errors=(400, 401, 403, 404, 409, 413, 415, 503),
    ),
    Route(
        "GET",
        "/notes/search",
        "Bounded snippets from unchanged imported notes",
        ("knowledge.notes.v1", "searchResponse"),
        query=("q",),
        errors=(400, 401, 403, 503),
    ),
)


@cache
def schema_document(prefix: str) -> dict[str, Any]:
    """One published schema file."""
    document: dict[str, Any] = json.loads((PROTOCOL / SCHEMA_FILES[prefix]).read_text(encoding="utf-8"))
    return document


def ref(prefix: str, name: str) -> dict[str, str]:
    """An OpenAPI reference to a published definition."""
    if name not in schema_document(prefix)["$defs"]:
        raise KeyError(f"{SCHEMA_FILES[prefix]} has no $defs/{name}")
    return {"$ref": f"#/components/schemas/{prefix}.{name}"}


def _rewrite(value: Any, prefix: str) -> Any:
    """Point a file's internal ``#/$defs/x`` references at its OpenAPI components."""
    if isinstance(value, dict):
        return {
            key: (
                re.sub(r"^#/\$defs/", f"#/components/schemas/{prefix}.", item)
                if key == "$ref" and isinstance(item, str)
                else _rewrite(item, prefix)
            )
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [_rewrite(item, prefix) for item in value]
    return value


def components() -> dict[str, Any]:
    """Every published definition, named ``<prefix>.<definition>``."""
    return {
        f"{prefix}.{name}": _rewrite(definition, prefix)
        for prefix in SCHEMA_FILES
        for name, definition in schema_document(prefix)["$defs"].items()
    }


def _json_of(schema: dict[str, Any]) -> dict[str, Any]:
    """A JSON response or request content block."""
    return {"content": {"application/json": {"schema": schema}}}


def operation(route: Route) -> dict[str, Any]:
    """The ``openapi_extra`` and ``responses`` for one route."""
    extra: dict[str, Any] = {}
    if route.request is not None:
        extra["requestBody"] = {
            "required": True,
            "content": {"application/json": {"schema": ref(*route.request)}},
        }
    if route.query:
        extra["parameters"] = [
            {"name": name, "in": "query", "required": False, "schema": {"type": "string"}}
            for name in route.query
        ]
    responses: dict[int | str, Any] = {
        200: {
            "description": "Success, or `{enabled:false}` when knowledge is disabled.",
            **_json_of({"oneOf": [ref(*route.response), ref("knowledge.api.v1", "disabled")]}),
        }
    }
    for status in route.errors:
        responses[status] = {"description": "Refusal with a stable code.", **_json_of(ref(*ERROR))}
    return {"openapi_extra": extra, "responses": responses}
