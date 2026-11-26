"""Routes for read-only Obsidian note import under ``/api/knowledge/v1/notes``.

* ``GET  /notes`` — imported notes (metadata) with current/changed/missing state.
* ``POST /notes/import`` — ``{idempotencyKey, expectedVersion, path}``: record one note.
* ``GET  /notes/search?q=`` — bounded snippets from unchanged imported notes.

Local mode only, and only with ``STEX_KNOWLEDGE_VAULT_DIR`` set (see notes.py).
"""

from __future__ import annotations

import hashlib
from pathlib import Path

from stex.knowledge.api import EXTRA_ROUTES, KnowledgeContext
from stex.knowledge.journal import Json, KnowledgeError
from stex.knowledge.notes import NoteLedger, _read


def _vault(context: KnowledgeContext) -> Path:
    """The selected vault root, refusing hosted mode and unconfigured hosts."""
    if context.request.app.state.knowledge.hosted:
        raise KnowledgeError(403, "VAULT_LOCAL_ONLY", "Vault import is available in local mode only.")
    root: Path | None = context.request.app.state.knowledge_vault
    if root is None:
        raise KnowledgeError(503, "VAULT_DISABLED", "No vault is selected for this workspace.")
    return root


async def listing(context: KnowledgeContext, _params: Json) -> Json:
    """Imported notes and whether their bytes still match the import."""
    root = _vault(context)
    view = NoteLedger.of(context.journal).view()
    notes = []
    for note in view["notes"]:
        try:
            state = (
                "current"
                if hashlib.sha256(_read(root, note["path"])).hexdigest() == note["sha256"]
                else "changed"
            )
        except KnowledgeError:
            state = "missing"
        notes.append({**note, "state": state})
    return {**view, "notes": notes}


async def import_note(context: KnowledgeContext, data: Json) -> Json:
    """Import one note's metadata (read-only)."""
    return await NoteLedger.of(context.journal).import_note(data, _vault(context))


async def search(context: KnowledgeContext, params: Json) -> Json:
    """Bounded retrieval over unchanged imported notes."""
    return NoteLedger.of(context.journal).search(_vault(context), params.get("q"))


EXTRA_ROUTES.update(
    {
        ("GET", "/notes"): listing,
        ("POST", "/notes/import"): import_note,
        ("GET", "/notes/search"): search,
    }
)
