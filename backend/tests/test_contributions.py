"""Private knowledge contributions on the platform API (stex.knowledge.contributions.v1).

Two accounts, a fake Frige passage export and synthetic text. Covers privacy
(search marks, counts, listings, resolve), Igor's narrow credential, stale
sources, withdrawal, restart replay, erasure, and that neither the ledger nor
the Node-compatible journal stores passage text.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

import httpx2
from conftest import FRIGE, ORIGINS, Studios
from fastapi.testclient import TestClient

from stex.config import KnowledgeSettings, Settings
from stex.knowledge.library import person_directory_name
from stex.main import create_app

SECRET = "p" * 40
IGOR = "i" * 40
BOOK = "stex://frige/project/fixture-book"
TEXT = "The frost-bound orchard keeps its counted rows."
PASSAGE_HASH = hashlib.sha256(TEXT.encode()).hexdigest()
EXCERPT = "e" * 64
ATTACHMENT = "0123456789abcdef"


class FakeFrige:
    """One approved passage; ``stale`` makes Frige answer 409 for reads and drop it from search."""

    def __init__(self) -> None:
        """Start with a current passage."""
        self.stale = False
        self.requests: list[httpx2.Request] = []

    def __call__(self, request: httpx2.Request) -> httpx2.Response:
        """Serve stex.frige.passages.v1 search and read."""
        self.requests.append(request)
        project = {"application": "frige", "id": "fixture-book", "reference": BOOK, "title": "Fixture"}
        passage = {
            "reference": f"{BOOK}#attachment={ATTACHMENT}",
            "attachmentId": ATTACHMENT,
            "title": "orchard.txt",
            "originalSha256": "a" * 64,
            "excerptHash": EXCERPT,
            "start": 10,
            "end": 10 + len(TEXT.encode()),
            "passageSha256": PASSAGE_HASH,
        }
        if request.url.path.endswith("/search"):
            body: Any = {
                "schemaVersion": "stex.frige.passages.v1",
                "project": project,
                "passages": [] if self.stale else [{**passage, "snippet": TEXT}],
                "truncated": False,
            }
            return httpx2.Response(
                200, content=json.dumps(body).encode(), headers={"content-type": "application/json"}
            )
        if self.stale:
            body = {"code": "STALE_PASSAGE", "error": "changed"}
            return httpx2.Response(
                409, content=json.dumps(body).encode(), headers={"content-type": "application/json"}
            )
        body = {
            "schemaVersion": "stex.frige.passages.v1",
            "project": project,
            "passage": {**passage, "text": TEXT},
        }
        return httpx2.Response(
            200, content=json.dumps(body).encode(), headers={"content-type": "application/json"}
        )


def app(tmp_path: Path, frige: FakeFrige) -> TestClient:
    """A hosted platform with both secrets."""
    knowledge = KnowledgeSettings(
        directory=tmp_path / "k", hosted=True, actor_secret=SECRET, igor_secret=IGOR
    )
    return TestClient(
        create_app(
            Settings(engine_origins=ORIGINS, knowledge=knowledge),
            transport=Studios({FRIGE: frige}).transport(),
        )
    )


def person(name: str, token_header: str = "x-stex-platform-token", secret: str = SECRET) -> dict[str, str]:  # noqa: S107 - header name default
    """Actor headers as Pantheon (or, with Igor's header and secret, Igor) sends them."""
    return {
        "x-stex-actor": name,
        "x-stex-actor-role": "member",
        token_header: secret,
        "x-stex-actor-journal": person_directory_name(name),
    }


CITATION = {
    "project": BOOK,
    "attachmentId": ATTACHMENT,
    "excerptHash": EXCERPT,
    "start": 10,
    "end": 10 + len(TEXT.encode()),
    "passageSha256": PASSAGE_HASH,
}
IGOR_ALICE = person("alice", "x-stex-knowledge-token", IGOR)


def contribute(api: TestClient, who: str, key: str) -> httpx2.Response:
    """Approve the fixture passage for one person."""
    version = api.get("/api/knowledge/v1/contributions", headers=person(who)).json()["version"]
    return api.post(
        "/api/knowledge/v1/contributions",
        headers=person(who),
        json={"idempotencyKey": key, "expectedVersion": version, "citation": CITATION},
    )


def test_contributions_are_private_and_resolved_only_for_their_owner(tmp_path: Path) -> None:
    """Bob sees the shared passage but nothing of Alice's approval; Igor resolves for Alice only."""
    frige = FakeFrige()
    with app(tmp_path, frige) as api:
        created = contribute(api, "alice", "key-alice-0001")
        assert created.status_code == 200, created.text
        reference = created.json()["contributions"][0]["reference"]
        alice_hit = api.get(
            "/api/knowledge/v1/passages/search",
            params={"project": BOOK, "q": "orchard"},
            headers=person("alice"),
        ).json()
        assert alice_hit["passages"][0]["contribution"] == reference
        bob_hit = api.get(
            "/api/knowledge/v1/passages/search",
            params={"project": BOOK, "q": "orchard"},
            headers=person("bob"),
        )
        assert bob_hit.json()["passages"][0]["contribution"] is None
        bob_list = api.get("/api/knowledge/v1/contributions", headers=person("bob"))
        assert bob_list.json()["contributions"] == []
        for response in (bob_hit, bob_list, api.get("/api/knowledge/v1", headers=person("bob"))):
            assert reference.rsplit("/", 1)[1] not in response.text
        resolved = api.post(
            "/api/knowledge/v1/contributions/resolve", headers=IGOR_ALICE, json={"reference": reference}
        )
        assert (
            resolved.status_code == 200
            and resolved.json()["text"] == TEXT
            and resolved.json()["trust"] == "untrusted-source"
        )
        bob_igor = person("bob", "x-stex-knowledge-token", IGOR)
        assert (
            api.post(
                "/api/knowledge/v1/contributions/resolve", headers=bob_igor, json={"reference": reference}
            ).status_code
            == 404
        )
        # Igor's credential opens the resolve route only.
        assert api.get("/api/knowledge/v1/contributions", headers=IGOR_ALICE).status_code == 401
        assert api.get("/api/knowledge/v1", headers=IGOR_ALICE).status_code == 401
        # Frige received the verified actor for attribution, never Igor's token.
        assert all("x-stex-knowledge-token" not in request.headers for request in frige.requests)


def test_stale_withdrawn_restart_and_erase(tmp_path: Path) -> None:
    """A stale source is unusable; withdrawal persists across restart; replay never revives; erase clears."""
    frige = FakeFrige()
    with app(tmp_path, frige) as api:
        body = contribute(api, "alice", "key-alice-0002")
        reference = body.json()["contributions"][0]["reference"]
        identifier = body.json()["contributions"][0]["id"]
        frige.stale = True
        assert (
            api.get("/api/knowledge/v1/contributions", headers=person("alice")).json()["contributions"][0][
                "state"
            ]
            == "stale"
        )
        stale = api.post(
            "/api/knowledge/v1/contributions/resolve", headers=IGOR_ALICE, json={"reference": reference}
        )
        assert stale.status_code == 409 and stale.json()["code"] == "STALE_PASSAGE"
        frige.stale = False
        version = api.get("/api/knowledge/v1/contributions", headers=person("alice")).json()["version"]
        withdraw = {"idempotencyKey": "key-withdraw-01", "expectedVersion": version, "id": identifier}
        assert (
            api.post(
                "/api/knowledge/v1/contributions/withdraw", headers=person("alice"), json=withdraw
            ).status_code
            == 200
        )
    with app(tmp_path, frige) as api:
        listing = api.get("/api/knowledge/v1/contributions", headers=person("alice")).json()
        assert listing["contributions"][0]["state"] == "withdrawn"
        gone = api.post(
            "/api/knowledge/v1/contributions/resolve", headers=IGOR_ALICE, json={"reference": reference}
        )
        assert gone.status_code == 410 and gone.json()["code"] == "CONTRIBUTION_WITHDRAWN"
        replay = api.post(
            "/api/knowledge/v1/contributions",
            headers=person("alice"),
            json={"idempotencyKey": "key-alice-0002", "expectedVersion": "x", "citation": CITATION},
        )
        assert (
            replay.json()["replayed"] is True and replay.json()["contributions"][0]["status"] == "withdrawn"
        )
        directory = tmp_path / "k" / "people" / person_directory_name("alice")
        ledger = (directory / "contributions.v1.json").read_text(encoding="utf-8")
        assert TEXT not in ledger and "frost" not in ledger
        journal = directory / "knowledge.v1.json"
        # Contributions never touch the Node-compatible journal (none was written here).
        assert not journal.exists() or "contribution" not in journal.read_text(encoding="utf-8")
        version = api.get("/api/knowledge/v1", headers=person("alice")).json()["version"]
        erased = api.post(
            "/api/knowledge/v1/erase",
            headers=person("alice"),
            json={"confirmation": "delete-knowledge", "expectedVersion": version},
        )
        assert erased.status_code == 200
        assert (
            api.get("/api/knowledge/v1/contributions", headers=person("alice")).json()["contributions"] == []
        )
