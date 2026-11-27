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
import pytest
from conftest import FRIGE, ORIGINS, Studios, local_client
from fastapi.testclient import TestClient

from stex.config import KnowledgeSettings, Settings
from stex.knowledge import contributions, contributions_api
from stex.knowledge.contributions import ContributionLedger
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
    return local_client(
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


def test_erase_covers_every_ledger_and_refuses_before_deleting_anything(tmp_path: Path) -> None:
    """Erase removes contributions and note metadata; a damaged ledger stops it with the journal intact."""
    vault = tmp_path / "vault"
    vault.mkdir()
    (vault / "Note.md").write_text("# Note\n\nRows.\n", encoding="utf-8")
    frige = FakeFrige()
    knowledge = KnowledgeSettings(directory=tmp_path / "k", vault=vault)
    with local_client(
        create_app(
            Settings(engine_origins=ORIGINS, knowledge=knowledge),
            transport=Studios({FRIGE: frige}).transport(),
        )
    ) as api:
        version = api.get("/api/knowledge/v1/contributions").json()["version"]
        body = {"idempotencyKey": "erase-contribute-1", "expectedVersion": version, "citation": CITATION}
        assert api.post("/api/knowledge/v1/contributions", json=body).status_code == 200
        notes = api.get("/api/knowledge/v1/notes").json()
        imported = {"idempotencyKey": "erase-note-1", "expectedVersion": notes["version"], "path": "Note.md"}
        assert api.post("/api/knowledge/v1/notes/import", json=imported).status_code == 200
        stale = api.post(
            "/api/knowledge/v1/erase", json={"confirmation": "delete-knowledge", "expectedVersion": "x:0"}
        )
        assert stale.status_code == 409
        assert api.get("/api/knowledge/v1/contributions").json()["contributions"], (
            "a refused erase deletes nothing"
        )
        current = api.get("/api/knowledge/v1").json()["version"]
        erased = api.post(
            "/api/knowledge/v1/erase", json={"confirmation": "delete-knowledge", "expectedVersion": current}
        )
        assert erased.status_code == 200
        assert api.get("/api/knowledge/v1/contributions").json()["contributions"] == []
        assert api.get("/api/knowledge/v1/notes").json()["notes"] == []
    # After restart the ledgers stay empty and stay bound to the new journal generation.
    with local_client(
        create_app(
            Settings(engine_origins=ORIGINS, knowledge=knowledge),
            transport=Studios({FRIGE: frige}).transport(),
        )
    ) as api:
        assert api.get("/api/knowledge/v1/contributions").json()["contributions"] == []
        version = api.get("/api/knowledge/v1/contributions").json()["version"]
        again = {"idempotencyKey": "erase-contribute-2", "expectedVersion": version, "citation": CITATION}
        assert api.post("/api/knowledge/v1/contributions", json=again).status_code == 200
    # A damaged ledger refuses erase before the journal is touched.
    (tmp_path / "k" / "notes.v1.json").write_text("{damaged", encoding="utf-8")
    journal_before = (tmp_path / "k" / "knowledge.v1.json").read_bytes()
    with local_client(
        create_app(
            Settings(engine_origins=ORIGINS, knowledge=knowledge),
            transport=Studios({FRIGE: frige}).transport(),
        )
    ) as api:
        current = api.get("/api/knowledge/v1").json()["version"]
        refused = api.post(
            "/api/knowledge/v1/erase", json={"confirmation": "delete-knowledge", "expectedVersion": current}
        )
        assert refused.status_code == 503 and refused.json()["code"] == "INVALID_JOURNAL"
        assert api.get("/api/knowledge/v1/contributions").json()["contributions"], "contributions kept"
    assert (tmp_path / "k" / "knowledge.v1.json").read_bytes() == journal_before


def test_a_native_erase_is_honoured_when_the_platform_path_returns(tmp_path: Path) -> None:
    """Rollback: the Node library erases the journal; contributions made before are not revived."""
    import shutil
    import subprocess

    node = shutil.which("node")
    if node is None:
        import pytest

        pytest.skip("node is required")
    frige = FakeFrige()
    knowledge = KnowledgeSettings(directory=tmp_path / "k")
    with local_client(
        create_app(
            Settings(engine_origins=ORIGINS, knowledge=knowledge),
            transport=Studios({FRIGE: frige}).transport(),
        )
    ) as api:
        version = api.get("/api/knowledge/v1/contributions").json()["version"]
        created = api.post(
            "/api/knowledge/v1/contributions",
            json={"idempotencyKey": "native-erase-1", "expectedVersion": version, "citation": CITATION},
        )
        reference = created.json()["contributions"][0]["reference"]
    driver = Path(__file__).parent / "fixtures" / "knowledge_parity.mjs"
    subprocess.run(  # noqa: S603 - fixed local interpreter and repository script
        [node, str(driver), str(tmp_path / "k")],
        input=json.dumps(
            [{"op": "erase", "body": {"confirmation": "delete-knowledge", "expectedVersion": "@version"}}]
        ),
        text=True,
        check=True,
        capture_output=True,
        timeout=60,
    )
    with local_client(
        create_app(
            Settings(engine_origins=ORIGINS, knowledge=knowledge),
            transport=Studios({FRIGE: frige}).transport(),
        )
    ) as api:
        assert api.get("/api/knowledge/v1/contributions").json()["contributions"] == []
        gone = api.post("/api/knowledge/v1/contributions/resolve", json={"reference": reference})
        assert gone.status_code == 404


def test_a_withdrawal_during_the_source_read_wins(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Resolve re-checks the ledger after Frige answers: no text for a contribution withdrawn meanwhile."""
    frige = FakeFrige()
    original = contributions_api._read

    async def withdraw_while_reading(context: Any, cited: Any) -> Any:
        passage = await original(context, cited)
        ledger = ContributionLedger.of(context.journal)
        version = ledger.view()["version"]
        await ledger.withdraw(
            {"idempotencyKey": "key-race-withdraw", "expectedVersion": version, "id": cited["id"]}
        )
        return passage

    with app(tmp_path, frige) as api:
        reference = contribute(api, "alice", "key-alice-race1").json()["contributions"][0]["reference"]
        monkeypatch.setattr(contributions_api, "_read", withdraw_while_reading)
        raced = api.post(
            "/api/knowledge/v1/contributions/resolve", headers=IGOR_ALICE, json={"reference": reference}
        )
        assert raced.status_code == 410 and raced.json()["code"] == "CONTRIBUTION_WITHDRAWN"
        assert TEXT not in raced.text


def test_a_failed_withdrawal_is_a_service_fault_and_changes_nothing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A storage failure answers 503 (not the client's 400), and the contribution keeps its earlier state."""
    frige = FakeFrige()
    with app(tmp_path, frige) as api:
        body = contribute(api, "alice", "key-alice-disk1").json()
        identifier = body["contributions"][0]["id"]
        version = api.get("/api/knowledge/v1/contributions", headers=person("alice")).json()["version"]

        def full_disk(*_args: Any) -> None:
            raise OSError(28, "No space left on device")

        monkeypatch.setattr(contributions, "_atomic_write", full_disk)
        failed = api.post(
            "/api/knowledge/v1/contributions/withdraw",
            headers=person("alice"),
            json={"idempotencyKey": "key-withdraw-disk", "expectedVersion": version, "id": identifier},
        )
        assert failed.status_code == 503 and failed.json()["code"] == "KNOWLEDGE_UNAVAILABLE"
        listing = api.get("/api/knowledge/v1/contributions", headers=person("alice")).json()
        assert listing["version"] == version and listing["contributions"][0]["status"] == "active"
