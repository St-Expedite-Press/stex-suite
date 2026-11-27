"""Host and browser-origin admission (stex.hosts): the DNS-rebinding defence of the platform API."""

from __future__ import annotations

from pathlib import Path

import pytest
from conftest import ORIGINS, local_client
from fastapi.testclient import TestClient

from stex.config import KnowledgeSettings, Settings
from stex.hosts import admitted, host_name
from stex.main import create_app

LOCAL = frozenset({"127.0.0.1", "localhost", "[::1]"})


@pytest.mark.parametrize(
    ("value", "name"),
    [
        ("127.0.0.1", "127.0.0.1"),
        ("127.0.0.1:4340", "127.0.0.1"),
        ("LOCALHOST:4340", "localhost"),
        ("[::1]:4340", "[::1]"),
        ("platform:4340", "platform"),
        ("", None),
        ("127.0.0.1:99999", None),
        ("127.0.0.1:43a0", None),
        ("evil.example/path", None),
        ("user@127.0.0.1", None),
        ("[::2]:4340", None),
    ],
)
def test_host_names_are_parsed_strictly(value: str, name: str | None) -> None:
    assert host_name(value) == name


def test_admission_rules() -> None:
    def h(*pairs: tuple[str, str]) -> list[tuple[bytes, bytes]]:
        return [(key.encode(), value.encode()) for key, value in pairs]

    assert admitted(h(("host", "127.0.0.1:4340")), LOCAL)
    assert not admitted([], LOCAL), "a request without Host is refused"
    assert not admitted(h(("host", "127.0.0.1"), ("host", "evil.example")), LOCAL), "two Host headers"
    assert not admitted(h(("host", "rebound.example:4340")), LOCAL)
    assert not admitted(h(("host", "platform:4340")), LOCAL), "service names only when configured"
    assert admitted(h(("host", "platform:4340")), LOCAL | {"platform"})
    assert not admitted(h(("host", "127.0.0.1"), ("sec-fetch-site", "cross-site")), LOCAL)
    assert admitted(h(("host", "127.0.0.1"), ("sec-fetch-site", "same-origin")), LOCAL)
    assert not admitted(h(("host", "127.0.0.1"), ("origin", "http://rebound.example")), LOCAL)
    assert not admitted(h(("host", "127.0.0.1"), ("origin", "null")), LOCAL)
    assert not admitted(h(("host", "127.0.0.1"), ("origin", "https://127.0.0.1")), LOCAL)
    assert admitted(h(("host", "127.0.0.1"), ("origin", "http://127.0.0.1:4300")), LOCAL)


def test_a_rebound_name_reaches_no_route(tmp_path: Path) -> None:
    """Local-mode knowledge needs no credential, so the Host check is what keeps a rebound page out."""
    knowledge = KnowledgeSettings(directory=tmp_path / "knowledge")
    app = create_app(Settings(engine_origins=ORIGINS, knowledge=knowledge))
    with local_client(app) as client:
        assert client.get("/health").status_code == 200
        assert client.get("/api/knowledge/v1/export").status_code != 403
        assert client.get("/health", headers={"origin": "http://rebound.example"}).status_code == 403
        assert client.get("/health", headers={"sec-fetch-site": "cross-site"}).status_code == 403
    with TestClient(app, base_url="http://rebound.example:4340") as client:
        for path in ("/health", "/openapi.json", "/api/knowledge/v1/export", "/api/platform/v1/projects"):
            response = client.get(path)
            assert response.status_code == 403, path
            assert response.json() == {"error": "The platform API answers only on its local address."}
        assert client.post("/api/knowledge/v1/erase", json={}).status_code == 403


def test_internal_service_names_are_admitted_only_when_configured(tmp_path: Path) -> None:
    knowledge = KnowledgeSettings(directory=tmp_path / "knowledge")
    plain = create_app(Settings(engine_origins=ORIGINS, knowledge=knowledge))
    with TestClient(plain, base_url="http://platform:4340") as client:
        assert client.get("/health").status_code == 403
    peer = create_app(
        Settings(engine_origins=ORIGINS, knowledge=knowledge, internal_hosts=frozenset({"platform"}))
    )
    with TestClient(peer, base_url="http://platform:4340") as client:
        assert client.get("/health").status_code == 200
