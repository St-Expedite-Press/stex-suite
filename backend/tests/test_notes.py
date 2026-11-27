"""Read-only Obsidian note import (stex.knowledge.notes.v1) with a disposable fixture vault."""

from __future__ import annotations

import hashlib
import os
from pathlib import Path

import pytest
from conftest import ORIGINS, local_client
from fastapi.testclient import TestClient

from stex.config import KnowledgeSettings, Settings
from stex.main import create_app

NOTE_A = """---
title: Orchard Ledger
tags: [orchard]
---
# Ignored heading

The counted rows sit under frost, as [[Note B|the second note]] explains.

A separate paragraph about [[Missing Note]] and [[folder/Deep#Section]].
"""
NOTE_B = "# Note B\n\nWinter pruning keeps the rows open.\n"


def vault(tmp_path: Path) -> Path:
    """A disposable vault: one linked note, its link target, a nested note and an Obsidian folder."""
    root = tmp_path / "vault"
    (root / "folder").mkdir(parents=True)
    (root / ".obsidian").mkdir()
    (root / "Note A.md").write_text(NOTE_A, encoding="utf-8")
    (root / "Note B.md").write_text(NOTE_B, encoding="utf-8")
    (root / "folder" / "Deep.md").write_text("# Deep\n\nNested.\n", encoding="utf-8")
    return root


def snapshot(root: Path) -> dict[str, str]:
    """Every file's digest, to prove the vault is never written."""
    return {
        str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest()
        for p in sorted(root.rglob("*"))
        if p.is_file()
    }


def client(tmp_path: Path, root: Path, *, hosted: bool = False) -> TestClient:
    """A platform app with knowledge and the fixture vault."""
    knowledge = KnowledgeSettings(
        directory=tmp_path / "k", hosted=hosted, actor_secret="s" * 40 if hosted else None, vault=root
    )
    return local_client(create_app(Settings(engine_origins=ORIGINS, knowledge=knowledge)))


def test_one_linked_note_imports_read_only_and_retrieval_is_bounded(tmp_path: Path) -> None:
    """Import records metadata and resolved links; search reads live and excludes a changed note."""
    root = vault(tmp_path)
    before = snapshot(root)
    with client(tmp_path, root) as api:
        version = api.get("/api/knowledge/v1/notes").json()["version"]
        imported = api.post(
            "/api/knowledge/v1/notes/import",
            json={"idempotencyKey": "note-import-1", "expectedVersion": version, "path": "Note A.md"},
        )
        assert imported.status_code == 200, imported.text
        note = imported.json()["notes"][0]
        assert note["title"] == "Orchard Ledger" and note["properties"] == ["title", "tags"]
        assert note["links"] == [
            {"target": "Note B", "resolved": "Note B.md"},
            {"target": "Missing Note", "resolved": None},
            {"target": "folder/Deep", "resolved": "folder/Deep.md"},
        ]
        found = api.get("/api/knowledge/v1/notes/search", params={"q": "counted rows"}).json()
        assert [r["path"] for r in found["results"]] == ["Note A.md"]
        assert len(found["results"][0]["snippet"]) <= 240
        assert api.get("/api/knowledge/v1/notes/search", params={"q": "pruning"}).json()["results"] == [], (
            "only imported notes are searched"
        )
        (root / "Note A.md").write_text(NOTE_A.replace("frost", "snow"), encoding="utf-8")
        changed = api.get("/api/knowledge/v1/notes/search", params={"q": "counted rows"}).json()
        assert changed["results"] == [] and changed["unavailable"] == ["Note A.md"]
        assert api.get("/api/knowledge/v1/notes").json()["notes"][0]["state"] == "changed"
        (root / "Note A.md").write_text(NOTE_A, encoding="utf-8")
    assert snapshot(root) == before, "the vault was never written"
    ledger = (tmp_path / "k" / "notes.v1.json").read_text(encoding="utf-8")
    assert "counted rows" not in ledger and "Winter pruning" not in ledger, "no note text is stored"


@pytest.mark.parametrize(
    "path",
    [
        "../outside.md",
        "/etc/passwd.md",
        "C:/Windows/x.md",
        "Note A.md:stream.md",
        "CON.md",
        "folder./Deep.md",
        "Note A.txt",
        "folder\\Deep.md",
        "",
    ],
)
def test_unsafe_paths_are_refused(tmp_path: Path, path: str) -> None:
    """Traversal, absolute, drive, stream, device, trailing-dot and non-Markdown paths are refused."""
    root = vault(tmp_path)
    (tmp_path / "outside.md").write_text("secret", encoding="utf-8")
    with client(tmp_path, root) as api:
        version = api.get("/api/knowledge/v1/notes").json()["version"]
        refused = api.post(
            "/api/knowledge/v1/notes/import",
            json={"idempotencyKey": "note-bad-path", "expectedVersion": version, "path": path},
        )
        assert refused.status_code in (400, 404), refused.text
        assert "secret" not in refused.text


def test_symlinked_notes_are_refused(tmp_path: Path) -> None:
    """A link inside the vault pointing outside it is refused."""
    root = vault(tmp_path)
    (tmp_path / "outside.md").write_text("secret", encoding="utf-8")
    try:
        os.symlink(tmp_path / "outside.md", root / "Linked.md")
    except OSError:
        pytest.skip("symlinks need extra privileges on this host")
    with client(tmp_path, root) as api:
        version = api.get("/api/knowledge/v1/notes").json()["version"]
        refused = api.post(
            "/api/knowledge/v1/notes/import",
            json={"idempotencyKey": "note-symlink", "expectedVersion": version, "path": "Linked.md"},
        )
        assert refused.status_code == 403 and "secret" not in refused.text


def test_hosted_mode_refuses_vault_import(tmp_path: Path) -> None:
    """One shared vault root must not cross personal boundaries."""
    root = vault(tmp_path)
    headers = {
        "x-stex-actor": "alice",
        "x-stex-actor-role": "member",
        "x-stex-platform-token": "s" * 40,
        "x-stex-actor-journal": "2bd806c97f0e00af1a1fc3328fa763a9",
    }
    with client(tmp_path, root, hosted=True) as api:
        response = api.get("/api/knowledge/v1/notes", headers=headers)
        assert response.status_code == 403 and response.json()["code"] == "VAULT_LOCAL_ONLY"
