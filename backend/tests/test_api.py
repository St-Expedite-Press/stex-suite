from __future__ import annotations

import json

import httpx2
import jsonschema
from conftest import FRIGE, ORIGINS, PROTOCOL, SEAXNEAT, Studios, entry, json_reply, summary
from fastapi.testclient import TestClient

from stex.config import Settings
from stex.main import create_app
from stex.openapi import generate, render

SCHEMA = json.loads((PROTOCOL / "platform" / "projects.v1.schema.json").read_text(encoding="utf-8"))
OPENAPI = PROTOCOL / "platform" / "openapi.v1.json"


def client(studios: Studios) -> TestClient:
    return TestClient(create_app(Settings(engine_origins=ORIGINS), transport=studios.transport()))


def test_health_needs_no_engine() -> None:
    with client(Studios({})) as api:
        response = api.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "stex-platform", "version": "0.1.0"}


def test_projects_reply_conforms_to_the_platform_contract() -> None:
    studios = Studios(
        {
            FRIGE: json_reply(summary("frige", entry("field-notes"), entry("undated", None, reference=None))),
            SEAXNEAT: json_reply({"error": "down"}, status=503),
        }
    )
    with client(studios) as api:
        response = api.get("/api/v1/projects")
    assert response.status_code == 200
    document = response.json()
    jsonschema.validate(document, SCHEMA)
    assert document["studios"] == [
        {"id": "frige", "state": "available"},
        {"id": "seaxneat", "state": "unavailable"},
    ]
    assert document["projects"][0] == {
        "studio": "frige",
        "reference": "stex://frige/project/field-notes",
        "id": "field-notes",
        "title": "Field Notes",
        "kind": "book",
        "updatedAt": "2026-11-05T17:02:11.000Z",
        "status": {"state": "ready", "label": "Manuscript"},
        "openPath": "/?book=field-notes",
        "href": "/frige/?book=field-notes",
    }


def test_every_studio_down_is_still_an_answer_not_an_error() -> None:
    with client(Studios({})) as api:
        document = api.get("/api/v1/projects").json()
    jsonschema.validate(document, SCHEMA)
    assert document["projects"] == []
    assert {studio["state"] for studio in document["studios"]} == {"unavailable"}


def test_the_application_client_does_not_follow_a_studio_redirect() -> None:
    def redirect(_request: httpx2.Request) -> httpx2.Response:
        return httpx2.Response(307, headers={"location": SEAXNEAT + "/seaxneat/api/stex/projects"})

    studios = Studios({FRIGE: redirect, SEAXNEAT: json_reply(summary("frige", entry("hijacked")))})
    with client(studios) as api:
        document = api.get("/api/v1/projects").json()
    assert document["studios"][0] == {"id": "frige", "state": "unavailable"}
    assert [project["id"] for project in document["projects"]] == []
    assert [str(request.url) for request in studios.requests].count(
        SEAXNEAT + "/seaxneat/api/stex/projects"
    ) == 1


def test_projects_is_read_only_and_interactive_docs_are_not_served() -> None:
    with client(Studios({})) as api:
        assert api.post("/api/v1/projects").status_code == 405
        assert api.get("/docs").status_code == 404
        assert api.get("/redoc").status_code == 404


def test_the_committed_openapi_document_matches_the_application() -> None:
    committed = OPENAPI.read_text(encoding="utf-8")
    assert render(generate()) == committed, (
        "Run `corepack pnpm openapi:platform` and review the contract change."
    )


def raw(body: bytes) -> Studios:
    reply = json_reply(summary("seaxneat"))
    return Studios({FRIGE: lambda _request: httpx2.Response(200, content=body), SEAXNEAT: reply})


def test_a_pathologically_nested_studio_body_marks_that_studio_unavailable_not_a_500() -> None:
    with client(raw(b"[" * 100_000 + b"]" * 100_000)) as api:
        response = api.get("/api/v1/projects")
    assert response.status_code == 200
    assert response.json()["studios"][0] == {"id": "frige", "state": "unavailable"}


def test_lone_surrogates_and_invalid_utf8_still_produce_a_valid_reply() -> None:
    document = json.dumps(
        summary("frige", entry("odd", title="\ud800 Ode", status={"state": "ready", "label": "\udfff"}))
    )
    body = "\ufeff".encode() + document.encode("ascii") + b" \xff"[:0]  # BOM-prefixed, escaped surrogates
    with client(raw(body)) as api:
        response = api.get("/api/v1/projects")
    assert response.status_code == 200
    reply = response.json()
    jsonschema.validate(reply, SCHEMA)
    assert reply["projects"][0]["title"] == "? Ode"
    assert reply["projects"][0]["status"]["label"] == "?"

    invalid = json.dumps(summary("frige", entry("bytes"))).encode().replace(b"Bytes", b"B\xffytes")
    with client(raw(invalid)) as api:
        project = api.get("/api/v1/projects").json()["projects"][0]
    assert project["title"] == "B\ufffdytes", "invalid UTF-8 is replaced as the browser would, not refused"


def test_studios_are_asked_for_uncompressed_bytes() -> None:
    studios = Studios({FRIGE: json_reply(summary("frige")), SEAXNEAT: json_reply(summary("seaxneat"))})
    with client(studios) as api:
        api.get("/api/v1/projects")
    assert {request.headers["accept-encoding"] for request in studios.requests} == {"identity"}


def test_a_compressed_studio_reply_is_refused() -> None:
    def gzipped(_request: httpx2.Request) -> httpx2.Response:
        return httpx2.Response(200, content=b"\x1f\x8b", headers={"content-encoding": "gzip"})

    with client(Studios({FRIGE: gzipped, SEAXNEAT: json_reply(summary("seaxneat"))})) as api:
        document = api.get("/api/v1/projects").json()
    assert document["studios"][0] == {"id": "frige", "state": "unavailable"}
