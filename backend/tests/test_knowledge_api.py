"""The platform knowledge API: identity, isolation, owner checks and container configuration.

Synthetic journals and a fake Frige only. Parity of journal behaviour with the
Node library is covered by test_knowledge_parity.py; this file covers the
platform-specific boundary: verified actors, per-person journals and settings.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

import httpx2
import pytest
from conftest import FRIGE, ORIGINS, Studios, local_client
from fastapi.testclient import TestClient

from stex.config import ConfigurationError, KnowledgeSettings, Settings
from stex.knowledge.library import person_directory_name
from stex.main import create_app

SECRET = "s" * 40
BOOK = "stex://frige/project/fixture-book"
REVISION = hashlib.sha256(b"Morning text").hexdigest()


def frige(observed: list[httpx2.Request]) -> Studios:
    """A fake Frige context export with one available source."""

    def handler(request: httpx2.Request) -> httpx2.Response:
        observed.append(request)
        project = {"application": "frige", "id": "fixture-book", "reference": BOOK, "title": "Fixture"}
        source = {
            "id": "morning",
            "title": "Morning",
            "reference": f"{BOOK}#source=morning",
            "revision": REVISION,
            "mediaType": "text/markdown",
            "bytes": 12,
            "available": True,
        }
        path = request.url.path
        if path.endswith("/observation"):
            body: Any = {
                "schemaVersion": "stex.knowledge.event.v1",
                "id": "evt-fixture-0001",
                "sequence": 1,
                "occurredAt": "2026-11-26T10:00:00.000Z",
                "project": project,
                "sources": [source],
            }
        elif "/sources/" in path:
            body = {"schemaVersion": "stex.project.context.v1", "project": project, "source": source}
        else:
            body = {
                "schemaVersion": "stex.project.context.v1",
                "project": project,
                "sources": [source],
                "nextOffset": None,
            }
        return httpx2.Response(
            200, content=json.dumps(body).encode(), headers={"content-type": "application/json"}
        )

    return Studios({FRIGE: handler})


def client(tmp_path: Path, studios: Studios, *, hosted: bool) -> TestClient:
    """A platform app whose knowledge journals live under tmp_path."""
    knowledge = KnowledgeSettings(
        directory=tmp_path / "knowledge", hosted=hosted, actor_secret=SECRET if hosted else None
    )
    return local_client(
        create_app(Settings(engine_origins=ORIGINS, knowledge=knowledge), transport=studios.transport())
    )


def actor(username: str, secret: str = SECRET) -> dict[str, str]:
    """Headers Pantheon sends for an admitted person."""
    return {
        "x-stex-actor": username,
        "x-stex-actor-role": "member",
        "x-stex-platform-token": secret,
        "x-stex-actor-journal": person_directory_name(username),
    }


def accept(api: TestClient, headers: dict[str, str], key: str) -> httpx2.Response:
    """Accept the fixture source into the caller's journal."""
    version = api.get("/api/knowledge/v1", headers=headers).json()["version"]
    return api.post(
        "/api/knowledge/v1/accept",
        headers=headers,
        json={
            "idempotencyKey": key,
            "expectedVersion": version,
            "project": BOOK,
            "sources": [{"id": "morning", "revision": REVISION}],
        },
    )


def test_disabled_knowledge_answers_enabled_false_and_contacts_no_engine(tmp_path: Path) -> None:
    """Without a directory the API is inert, exactly as Pantheon's was."""
    observed: list[httpx2.Request] = []
    with local_client(
        create_app(Settings(engine_origins=ORIGINS), transport=frige(observed).transport())
    ) as api:
        assert api.get("/api/knowledge/v1").json() == {"enabled": False}
        assert api.post("/api/knowledge/v1/accept", json={}).json() == {"enabled": False}
    assert observed == []


def test_local_mode_ignores_actor_headers_and_uses_one_journal(tmp_path: Path) -> None:
    """Local mode has no secret: actor headers are ignored and the single journal is used."""
    observed: list[httpx2.Request] = []
    with client(tmp_path, frige(observed), hosted=False) as api:
        response = accept(api, actor("alice", "forged" * 8), "key-local-1")
        assert response.status_code == 200, response.text
        assert response.json()["knowledge"]["sources"][0]["access"] == "current"
    assert (tmp_path / "knowledge" / "knowledge.v1.json").exists()
    assert not (tmp_path / "knowledge" / "people").exists()
    # No secret is configured, so no actor is forwarded to Frige.
    assert all("x-stex-platform-token" not in request.headers for request in observed)


def test_hosted_mode_refuses_requests_without_a_verified_actor(tmp_path: Path) -> None:
    """A missing, forged or inconsistent actor never reaches a journal."""
    with client(tmp_path, frige([]), hosted=True) as api:
        assert api.get("/api/knowledge/v1").status_code == 401
        assert api.get("/api/knowledge/v1", headers=actor("alice", "x" * 40)).status_code == 401
        mismatched = {**actor("alice"), "x-stex-actor-journal": person_directory_name("bob")}
        assert api.get("/api/knowledge/v1", headers=mismatched).status_code == 401
    assert not (tmp_path / "knowledge" / "people").exists()


def test_hosted_journals_are_personal_and_match_the_node_directory_layout(tmp_path: Path) -> None:
    """Alice's acceptance is invisible to Bob; each lands in people/<digest> as the Node library does."""
    observed: list[httpx2.Request] = []
    with client(tmp_path, frige(observed), hosted=True) as api:
        assert accept(api, actor("alice"), "key-alice-1").status_code == 200
        bob = api.get("/api/knowledge/v1", headers=actor("bob")).json()
        assert bob["knowledge"]["sources"] == []
        assert bob["graph"]["projects"] == []
        assert api.get("/api/knowledge/v1/export", headers=actor("bob")).json()["journal"]["events"] == []
    alice_dir = tmp_path / "knowledge" / "people" / person_directory_name("alice")
    assert (alice_dir / "knowledge.v1.json").exists()
    # The verified actor is forwarded to Frige for attribution; the journal header is not.
    forwarded = [request for request in observed if request.url.path.endswith("/observation")]
    assert forwarded and forwarded[0].headers["x-stex-actor"] == "alice"
    assert "x-stex-actor-journal" not in forwarded[0].headers


def test_digest_actor_ids_use_the_journal_header(tmp_path: Path) -> None:
    """A username that travels as a sha256- actor id keeps its Node journal directory."""
    username = "josé garcía"
    headers = {
        "x-stex-actor": "sha256-"
        + hashlib.sha256(json.dumps(username, ensure_ascii=False).encode()).hexdigest(),
        "x-stex-actor-role": "member",
        "x-stex-platform-token": SECRET,
        "x-stex-actor-journal": person_directory_name(username),
    }
    with client(tmp_path, frige([]), hosted=True) as api:
        assert accept(api, headers, "key-digest-1").status_code == 200
    assert (
        tmp_path / "knowledge" / "people" / person_directory_name(username) / "knowledge.v1.json"
    ).exists()


def test_container_settings_are_explicit_and_bounded() -> None:
    """STEX_BIND_ALL and STEX_INTERNAL_HOSTS are opt-in; native defaults are unchanged."""
    native = Settings.from_environment({})
    assert native.host == "127.0.0.1" and native.knowledge.directory is None
    container = Settings.from_environment(
        {"STEX_BIND_ALL": "1", "STEX_INTERNAL_HOSTS": "frige", "STEX_FRIGE_URL": "http://frige:4310"}
    )
    assert container.host == "0.0.0.0"
    assert container.engine_origins["frige"] == "http://frige:4310"
    with pytest.raises(ConfigurationError):
        Settings.from_environment({"STEX_FRIGE_URL": "http://frige:4310"})
    with pytest.raises(ConfigurationError):
        Settings.from_environment({"STEX_INTERNAL_HOSTS": "frige.example.com"})
    with pytest.raises(ConfigurationError):
        Settings.from_environment({"STEX_PLATFORM_HOST": "0.0.0.0"})
    with pytest.raises(ConfigurationError):
        Settings.from_environment({"STEX_KNOWLEDGE_HOSTED": "1"})
    with pytest.raises(ConfigurationError):
        Settings.from_environment({"STEX_PLATFORM_ACTOR_SECRET": "short"})
    assert Settings.from_environment({"STEX_KNOWLEDGE_ENGINES": "frige"}).knowledge.engines == frozenset(
        {"frige"}
    )


def test_a_lock_left_by_an_earlier_run_with_the_same_pid_is_recovered(tmp_path: Path) -> None:
    """In a container the writer is PID 1 after every restart; its own stale lock must not block it."""
    import asyncio
    import os

    import pytest

    from stex.knowledge.journal import Journal, KnowledgeError

    directory = tmp_path / "k"
    directory.mkdir()
    (directory / "knowledge.lock").write_text(
        json.dumps({"pid": os.getpid(), "nonce": "earlier-run"}), encoding="utf-8"
    )
    journal = Journal.open(directory)
    try:
        with pytest.raises(KnowledgeError) as held:
            Journal.open(directory)
        assert held.value.code == "KNOWLEDGE_LOCKED", "a directory this process holds is never opened twice"
    finally:
        asyncio.run(journal.close())
    assert not (directory / "knowledge.lock").exists()
    asyncio.run(Journal.open(directory).close())


def test_a_hosted_pantheon_in_front_of_a_local_platform_is_refused(tmp_path: Path) -> None:
    """Misconfiguration fails closed instead of serving one journal to every signed-in account."""
    with client(tmp_path, frige([]), hosted=False) as api:
        refused = api.get("/api/knowledge/v1", headers={**actor("alice"), "x-stex-knowledge-hosted": "1"})
        assert refused.status_code == 503 and refused.json()["code"] == "KNOWLEDGE_MISCONFIGURED"
        assert api.get("/api/knowledge/v1").status_code == 200, "local Pantheon (no marker) is unaffected"
    with client(tmp_path / "hosted", frige([]), hosted=True) as api:
        assert (
            api.get(
                "/api/knowledge/v1", headers={**actor("alice"), "x-stex-knowledge-hosted": "1"}
            ).status_code
            == 200
        )
