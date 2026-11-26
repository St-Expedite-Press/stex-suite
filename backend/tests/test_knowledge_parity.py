"""Node/Python parity for stex.knowledge.projections.v1 journals.

The same operations run through the Node library (the native path) and the
Python port (the platform path). Results, views, fingerprints and the persisted
journal must match exactly except for the random generation id and the event
timestamps. Each runtime must then replay the other's journal file unchanged.
Synthetic data only.
"""

from __future__ import annotations

import asyncio
import json
import re
import shutil
import subprocess
from pathlib import Path
from typing import Any

import pytest

from stex.knowledge.journal import Journal, KnowledgeError
from stex.knowledge.jsjson import stringify

DRIVER = Path(__file__).parent / "fixtures" / "knowledge_parity.mjs"
NODE = shutil.which("node")
REVISION_A = "a" * 64
REVISION_B = "b" * 64
REVISION_C = "c" * 64
PROJECT = {
    "application": "frige",
    "id": "fixture-book",
    "reference": "stex://frige/project/fixture-book",
    "title": "Fixture Bóok — 雪 🌨",
}


def source(identifier: str, revision: str, title: str) -> dict[str, Any]:
    """A synthetic owner source descriptor."""
    return {
        "id": identifier,
        "reference": f"{PROJECT['reference']}#source={identifier}",
        "revision": revision,
        "title": title,
        "bytes": 120.0,  # an integral float must print as 120, as JSON.stringify does
        "mediaType": "text/markdown",
        "source": "raw text that must be discarded",
    }


def event(identifier: str, sequence: int, sources: list[dict[str, Any]]) -> dict[str, Any]:
    """A synthetic owner revision event."""
    return {
        "schemaVersion": "stex.knowledge.event.v1",
        "id": identifier,
        "sequence": sequence,
        "occurredAt": "2026-11-26T10:00:00.000Z",
        "project": PROJECT,
        "sources": sources,
    }


FIRST = event(
    "evt-fixture-0001",
    1,
    [source("zeta-piece", REVISION_B, "Zeta"), source("alpha-2", REVISION_A, "Alpha ½")],
)
SECOND = event("evt-fixture-0002", 2, [source("alpha-2", REVISION_C, "Alpha revised")])
EVIDENCE = [{"reference": f"{PROJECT['reference']}#source=alpha-2", "revision": REVISION_A}]

OPERATIONS: list[dict[str, Any]] = [
    {
        "op": "accept",
        "body": {"idempotencyKey": "key-accept-1", "expectedVersion": "@version", "event": FIRST},
    },
    {
        "op": "accept",
        "body": {"idempotencyKey": "key-accept-1", "expectedVersion": "stale:0", "event": FIRST},
    },
    {
        "op": "accept",
        "body": {"idempotencyKey": "key-accept-x", "expectedVersion": "@version", "event": FIRST},
    },
    {
        "op": "relation",
        "body": {
            "idempotencyKey": "key-relation-1",
            "expectedVersion": "@version",
            "relation": {
                "id": "rel-assert-1",
                "kind": "assertion",
                "subject": PROJECT["reference"],
                "predicate": "is set in",
                "object": "winter " + chr(0x2028) + " light",
                "evidence": EVIDENCE,
            },
        },
    },
    {
        "op": "relation",
        "body": {
            "idempotencyKey": "key-relation-2",
            "expectedVersion": "@version",
            "relation": {
                "id": "rel-infer-1",
                "kind": "inference",
                "subject": "stex://knowledge/concept/frost",
                "predicate": "recurs in",
                "object": "the cycle",
                "evidence": EVIDENCE,
                "confidence": 1.0,
            },
        },
    },
    {
        "op": "revise",
        "body": {
            "idempotencyKey": "key-revise-1",
            "expectedVersion": "@version",
            "id": "rel-infer-1",
            "status": "accepted",
        },
    },
    {
        "op": "revise",
        "body": {
            "idempotencyKey": "key-revise-2",
            "expectedVersion": "@version",
            "id": "rel-assert-1",
            "status": "accepted",
            "object": "winter light",
        },
    },
    {
        "op": "revise",
        "body": {
            "idempotencyKey": "key-revise-3",
            "expectedVersion": "@version",
            "id": "rel-assert-1",
            "status": "rejected",
            "object": None,
        },
    },
    {
        "op": "revise",
        "body": {
            "idempotencyKey": "key-revise-1",
            "expectedVersion": "@version",
            "id": "rel-infer-1",
            "status": "rejected",
        },
    },
    {
        "op": "revoke",
        "body": {
            "idempotencyKey": "key-revoke-1",
            "expectedVersion": "@version",
            "project": PROJECT["reference"],
        },
    },
    {
        "op": "accept",
        "body": {"idempotencyKey": "key-renew-1", "expectedVersion": "@version", "event": FIRST},
    },
    {
        "op": "accept",
        "body": {"idempotencyKey": "key-accept-2", "expectedVersion": "@version", "event": SECOND},
    },
    {
        "op": "accept",
        "body": {"idempotencyKey": "key-accept-3", "expectedVersion": "@version", "event": FIRST},
    },
    {
        "op": "revoke",
        "body": {
            "idempotencyKey": "key-revoke-9",
            "expectedVersion": "@version",
            "project": "stex://frige/project/other",
        },
    },
    {"op": "accept", "body": {"idempotencyKey": "bad", "expectedVersion": "@version", "event": SECOND}},
]

_GENERATION = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
_TIME = re.compile(r'"(at|createdAt|updatedAt)":"[^"]*"')


def normalise(value: Any) -> str:
    """Remove only the random generation id and event times."""
    return _TIME.sub(r'"\1":"T"', _GENERATION.sub("G", stringify(value)))


async def run_python(directory: Path) -> dict[str, Any]:
    """Apply the operations to the Python port."""
    journal = Journal.open(directory)
    results: list[dict[str, Any]] = []
    try:
        for operation in OPERATIONS:
            body = json.loads(
                stringify(operation["body"]).replace('"@version"', json.dumps(journal.view()["version"]))
            )
            try:
                results.append({"ok": await getattr(journal, operation["op"])(body)})
            except KnowledgeError as error:
                results.append({"error": {"status": error.status, "code": error.code}})
        return {"results": results, "export": journal.export()}
    finally:
        await journal.close()


def run_node(directory: Path, *arguments: str, operations: Any = None) -> dict[str, Any]:
    """Run the Node driver."""
    assert NODE is not None
    completed = subprocess.run(  # noqa: S603 - fixed local interpreter and repository script
        [NODE, str(DRIVER), str(directory), *arguments],
        input=stringify(operations) if operations is not None else "",
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=True,
        timeout=60,
    )
    result: dict[str, Any] = json.loads(completed.stdout)
    return result


pytestmark = pytest.mark.skipif(NODE is None, reason="node is required for the parity test")


def test_operations_views_and_journal_match_the_node_library(tmp_path: Path) -> None:
    """Every result, error code, view and persisted event matches the Node library."""
    node = run_node(tmp_path / "node", operations=OPERATIONS)
    python = asyncio.run(run_python(tmp_path / "python"))
    assert len(node["results"]) == len(OPERATIONS)
    for index, (expected, actual) in enumerate(zip(node["results"], python["results"], strict=True)):
        assert normalise(actual) == normalise(expected), f"operation {index} ({OPERATIONS[index]['op']})"
    assert normalise(python["export"]) == normalise(node["export"])
    # Fingerprints are deterministic, so they match exactly, not only after normalisation.
    assert [e["fingerprint"] for e in python["export"]["journal"]["events"]] == [
        e["fingerprint"] for e in node["export"]["journal"]["events"]
    ]
    # The file on disk is the same JSON text apart from generation and times.
    node_file = (tmp_path / "node" / "knowledge.v1.json").read_text(encoding="utf-8")
    python_file = (tmp_path / "python" / "knowledge.v1.json").read_text(encoding="utf-8")
    assert normalise(json.loads(python_file)) == normalise(json.loads(node_file))
    assert python_file.endswith("\n") and node_file.endswith("\n")


def test_each_runtime_replays_the_other_journal(tmp_path: Path) -> None:
    """A Node-written journal opens in Python and a Python-written one in Node, with identical views."""
    node = run_node(tmp_path / "node", operations=OPERATIONS)
    reopened = Journal.open(tmp_path / "node")
    try:
        assert stringify(reopened.view()) == stringify(_view(node["export"]))
    finally:
        asyncio.run(reopened.close())
    python = asyncio.run(run_python(tmp_path / "python"))
    replay = run_node(tmp_path / "python", "--replay")
    assert stringify(replay["view"]) == stringify(_view(python["export"]))


def _view(export: dict[str, Any]) -> dict[str, Any]:
    """The view part of an export."""
    return {key: export[key] for key in ("enabled", "version", "knowledge", "graph")}
