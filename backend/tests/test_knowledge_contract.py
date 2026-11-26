"""The knowledge API contract: documented routes, published schemas and generated OpenAPI agree.

Fails when the README route tables, ``stex.knowledge.contract.ROUTES``, the
schema files under ``protocol/`` or the generated OpenAPI drift apart, and
validates representative success, invalid-input, stale-revision and
unauthorized responses against the published definitions.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import httpx2
import jsonschema
import pytest
from conftest import FRIGE, ORIGINS, PROTOCOL, Studios
from fastapi.testclient import TestClient
from referencing import Registry, Resource
from test_contributions import CITATION, SECRET, FakeFrige, person

from stex.config import KnowledgeSettings, Settings
from stex.knowledge.contract import ROUTES, SCHEMA_FILES, schema_document
from stex.main import create_app
from stex.openapi import generate

PREFIX = "/api/knowledge/v1"
REGISTRY: Registry = Registry().with_resources(
    (schema_document(prefix)["$id"], Resource.from_contents(schema_document(prefix)))
    for prefix in SCHEMA_FILES
)


def conforms(prefix: str, name: str, value: Any) -> None:
    """Validate a value against one published definition."""
    schema = {"$ref": f"{schema_document(prefix)['$id']}#/$defs/{name}"}
    jsonschema.Draft202012Validator(schema, registry=REGISTRY).validate(value)


def violates(prefix: str, name: str, value: Any) -> bool:
    """Whether a value fails one published definition."""
    try:
        conforms(prefix, name, value)
    except jsonschema.ValidationError:
        return True
    return False


def documented_routes() -> set[tuple[str, str]]:
    """``(method, path)`` rows of every route table in protocol/knowledge/README.md."""
    text = (PROTOCOL / "knowledge" / "README.md").read_text(encoding="utf-8")
    rows = re.findall(r"^\| `(GET|POST) (/[^`?]*)", text, re.MULTILINE)
    return {(method, "" if path == "/" else path) for method, path in rows}


def test_readme_tables_route_list_and_generated_openapi_agree() -> None:
    """Every documented route is an OpenAPI operation, and nothing else is."""
    listed = {(route.method, route.path) for route in ROUTES}
    assert documented_routes() == listed
    paths = generate()["paths"]
    generated = {
        (method.upper(), path[len(PREFIX) :])
        for path, operations in paths.items()
        if path.startswith(PREFIX)
        for method in operations
    }
    assert generated == listed


def test_every_published_schema_is_valid_and_fully_exposed() -> None:
    """The schema files are valid 2020-12 schemas, and each definition is an OpenAPI component."""
    components = generate()["components"]["schemas"]
    for prefix, file in SCHEMA_FILES.items():
        document = json.loads((PROTOCOL / file).read_text(encoding="utf-8"))
        jsonschema.Draft202012Validator.check_schema(document)
        for name in document["$defs"]:
            assert f"{prefix}.{name}" in components, f"{file} $defs/{name} is not in OpenAPI"
    for route in ROUTES:
        operation = generate()["paths"][PREFIX + route.path][route.method.lower()]
        assert "200" in operation["responses"]
        if route.request:
            assert operation["requestBody"]["content"]["application/json"]["schema"]["$ref"].endswith(
                ".".join(route.request)
            )


def platform(
    tmp_path: Path, frige: FakeFrige, *, hosted: bool = False, vault: Path | None = None
) -> TestClient:
    """A platform app on disposable state with a fake Frige."""
    knowledge = KnowledgeSettings(
        directory=tmp_path / "k", hosted=hosted, actor_secret=SECRET if hosted else None, vault=vault
    )
    return TestClient(
        create_app(
            Settings(engine_origins=ORIGINS, knowledge=knowledge),
            transport=Studios({FRIGE: frige}).transport(),
        )
    )


def test_representative_payloads_conform(tmp_path: Path) -> None:
    """Success, invalid input, stale revision and unauthorized responses match their schemas."""
    vault = tmp_path / "vault"
    vault.mkdir()
    (vault / "Note.md").write_text("# Note\n\nThe counted rows.\n", encoding="utf-8")
    frige = FakeFrige()
    with platform(tmp_path, frige, vault=vault) as api:
        view = api.get(PREFIX).json()
        conforms("knowledge.api.v1", "view", view)
        conforms("knowledge.api.v1", "export", api.get(PREFIX + "/export").json())
        search = api.get(PREFIX + "/passages/search", params={"project": CITATION["project"], "q": "orchard"})
        conforms("knowledge.contributions.v1", "passageSearchResponse", search.json())
        read = api.get(
            PREFIX + "/passages/read",
            params={
                "project": CITATION["project"],
                "attachment": CITATION["attachmentId"],
                "excerpt": CITATION["excerptHash"],
                "start": str(CITATION["start"]),
                "end": str(CITATION["end"]),
                "passage": CITATION["passageSha256"],
            },
        )
        conforms("knowledge.contributions.v1", "passageReadResponse", read.json())
        listing = api.get(PREFIX + "/contributions").json()
        body = {
            "idempotencyKey": "contract-contribute-1",
            "expectedVersion": listing["version"],
            "citation": CITATION,
        }
        conforms("knowledge.contributions.v1", "contributeRequest", body)
        created = api.post(PREFIX + "/contributions", json=body)
        assert created.status_code == 200, created.text
        conforms("knowledge.contributions.v1", "contributionsView", created.json())
        conforms("knowledge.contributions.v1", "contributionsView", api.get(PREFIX + "/contributions").json())
        reference = created.json()["contributions"][0]["reference"]
        resolve = {"reference": reference}
        conforms("knowledge.contributions.v1", "resolveRequest", resolve)
        conforms(
            "knowledge.contributions.v1",
            "resolved",
            api.post(PREFIX + "/contributions/resolve", json=resolve).json(),
        )
        notes = api.get(PREFIX + "/notes").json()
        conforms("knowledge.notes.v1", "notesView", notes)
        imported = api.post(
            PREFIX + "/notes/import",
            json={
                "idempotencyKey": "contract-note-1",
                "expectedVersion": notes["version"],
                "path": "Note.md",
            },
        )
        conforms("knowledge.notes.v1", "notesView", imported.json())
        conforms(
            "knowledge.notes.v1",
            "searchResponse",
            api.get(PREFIX + "/notes/search", params={"q": "counted"}).json(),
        )

        # Invalid input: a malformed citation is refused by the schema and by the API, with the error shape.
        bad = {
            "idempotencyKey": "contract-bad-1",
            "expectedVersion": listing["version"],
            "citation": {**CITATION, "start": -1},
        }
        assert violates("knowledge.contributions.v1", "contributeRequest", bad)
        refused = api.post(PREFIX + "/contributions", json=bad)
        assert refused.status_code == 400
        conforms("knowledge.api.v1", "error", refused.json())
        wrong_type = api.post(PREFIX + "/accept", content=b"{}", headers={"content-type": "text/plain"})
        assert wrong_type.status_code == 415
        conforms("knowledge.api.v1", "error", wrong_type.json())

        # Stale: an old version token, and a source that changed under its citation.
        stale = api.post(PREFIX + "/contributions", json={**body, "idempotencyKey": "contract-stale-1"})
        assert stale.status_code == 409 and stale.json()["code"] == "STALE_KNOWLEDGE"
        conforms("knowledge.api.v1", "error", stale.json())
        frige.stale = True
        changed = api.post(PREFIX + "/contributions/resolve", json=resolve)
        assert changed.status_code == 409 and changed.json()["code"] == "STALE_PASSAGE"
        conforms("knowledge.api.v1", "error", changed.json())

        # Existing semantics for undocumented paths and methods are unchanged.
        unknown = api.get(PREFIX + "/accept")
        assert unknown.status_code == 404 and unknown.json() == {
            "error": "Unknown knowledge route.",
            "code": "INVALID_REQUEST",
        }
        assert api.put(PREFIX).status_code == 405


def test_unauthorized_and_disabled_shapes(tmp_path: Path) -> None:
    """Hosted requests without a verified actor get 401 with the error shape; disabled is {enabled:false}."""
    with platform(tmp_path, FakeFrige(), hosted=True) as api:
        for method, path in ((route.method, route.path) for route in ROUTES):
            response = api.request(method, PREFIX + path, json={} if method == "POST" else None)
            assert response.status_code == 401, (method, path)
            conforms("knowledge.api.v1", "error", response.json())
        assert api.get(PREFIX + "/contributions", headers=person("alice")).status_code == 200
    with TestClient(
        create_app(
            Settings(engine_origins=ORIGINS), transport=httpx2.MockTransport(lambda r: httpx2.Response(503))
        )
    ) as api:
        conforms("knowledge.api.v1", "disabled", api.get(PREFIX).json())


@pytest.mark.parametrize("prefix", sorted(SCHEMA_FILES))
def test_schema_ids_match_their_files(prefix: str) -> None:
    """Each file's $id names its own path, so references resolve to the published file."""
    assert schema_document(prefix)["$id"].endswith("/protocol/" + SCHEMA_FILES[prefix])
