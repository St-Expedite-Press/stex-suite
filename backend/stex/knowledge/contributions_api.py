"""Routes for passages and private contributions under ``/api/knowledge/v1``.

* ``GET  /passages/search?project=&q=`` — Frige's approved-excerpt search, with
  this person's own matching contribution id (never anyone else's).
* ``GET  /passages/read?project=&attachment=&excerpt=&start=&end=&passage=`` —
  the exact cited text, re-verified by Frige.
* ``GET  /contributions`` — this person's contributions, each with its live
  state (current, stale, unavailable or withdrawn); no text.
* ``POST /contributions`` — approve one verified passage revision for Igor.
* ``POST /contributions/withdraw`` — stop all future use.
* ``POST /contributions/resolve`` — for Igor, before each fresh use: recheck
  consent (active, this person's) and the source revision (Frige), then return
  the text for that one turn. Igor authenticates with its own secret and may
  call only this route.

Access to the Frige source is Frige's decision on every call (signed-in actor,
project password). A contribution is metadata in one person's journal
directory; it is never visible to, counted for, or resolvable by anyone else.
"""

from __future__ import annotations

import asyncio
from typing import Any
from urllib.parse import quote, urlencode

from stex.knowledge.api import EXTRA_ROUTES, KnowledgeContext
from stex.knowledge.contributions import ContributionLedger, citation, identifier_of
from stex.knowledge.engine import fail, project_reference
from stex.knowledge.journal import Json, KnowledgeError

PASSAGES_SCHEMA = "stex.frige.passages.v1"
RESOLVED_SCHEMA = "stex.knowledge.contribution.v1"
CHECK_LIMIT = 40
CHECK_CONCURRENCY = 4
CHECK_SECONDS = 6.0


def _frige_project(reference: Any) -> Json:
    """Passages exist only for Frige projects."""
    project = project_reference(reference)
    if project["application"] != "frige":
        raise fail(400, "Passages are available for Frige projects only.")
    return project


def _passage(value: Any) -> Json:
    """Keep only the citation fields of an owner passage (plus snippet/text when present)."""
    if not isinstance(value, dict):
        raise fail(502, "The engine returned an invalid passage.")
    try:
        cited = citation({**value, "project": str(value.get("reference", "")).split("#", 1)[0]})
    except KnowledgeError as error:
        raise fail(502, "The engine returned an invalid passage.") from error
    title = value.get("title")
    original = value.get("originalSha256")
    record: Json = {
        **cited,
        "title": title if isinstance(title, str) else "",
        "originalSha256": original if isinstance(original, str) else None,
    }
    for optional in ("snippet", "text"):
        if isinstance(value.get(optional), str):
            record[optional] = value[optional]
    return record


async def _read(context: KnowledgeContext, cited: Json) -> Json:
    """Frige's re-verified read of one cited passage."""
    project = _frige_project(cited["project"])
    query = urlencode(
        {
            "excerpt": cited["excerptHash"],
            "start": cited["start"],
            "end": cited["end"],
            "passage": cited["passageSha256"],
        }
    )
    result = await context.owners.call(
        project, f"/attachments/{cited['attachmentId']}?{query}", actor=context.actor, contract="passages/v1"
    )
    if result.get("schemaVersion") != PASSAGES_SCHEMA:
        raise fail(502, "The engine returned an invalid passage.")
    passage = _passage(result.get("passage"))
    if any(
        passage[field] != cited[field]
        for field in ("attachmentId", "excerptHash", "start", "end", "passageSha256")
    ):
        raise fail(502, "The engine returned a different passage.")
    if "text" not in passage:
        raise fail(502, "The engine returned an invalid passage.")
    return passage


async def search(context: KnowledgeContext, params: Json) -> Json:
    """Search approved excerpts; mark only this person's own active contributions."""
    project = _frige_project(params.get("project"))
    query = params.get("q")
    if not isinstance(query, str) or not query.strip() or len(query) > 200:
        raise fail(400, "Search for 1 to 200 characters.")
    result = await context.owners.call(
        project, f"/search?q={quote(query)}", actor=context.actor, contract="passages/v1"
    )
    passages = result.get("passages")
    if result.get("schemaVersion") != PASSAGES_SCHEMA or not isinstance(passages, list) or len(passages) > 20:
        raise fail(502, "The engine returned an invalid passage list.")
    ledger = ContributionLedger.of(context.journal)
    hits = []
    for value in passages:
        passage = _passage(value)
        mine = ledger.active_for(passage)
        hits.append({**passage, "contribution": mine["reference"] if mine else None})
    return {
        "schemaVersion": PASSAGES_SCHEMA,
        "project": {key: result["project"].get(key) for key in ("application", "id", "reference", "title")},
        "passages": hits,
        "truncated": bool(result.get("truncated")),
    }


async def read(context: KnowledgeContext, params: Json) -> Json:
    """The exact cited passage, for the citation view."""
    cited = citation(
        {
            "project": params.get("project"),
            "attachmentId": params.get("attachment"),
            "excerptHash": params.get("excerpt"),
            "start": _integer(params.get("start")),
            "end": _integer(params.get("end")),
            "passageSha256": params.get("passage"),
        }
    )
    passage = await _read(context, cited)
    mine = ContributionLedger.of(context.journal).active_for(passage)
    return {
        "schemaVersion": PASSAGES_SCHEMA,
        "passage": {**passage, "contribution": mine["reference"] if mine else None},
    }


def _integer(value: Any) -> int | None:
    """A decimal query parameter as an int."""
    return (
        int(value)
        if isinstance(value, str) and value.isascii() and value.isdecimal() and len(value) < 10
        else None
    )


async def listing(context: KnowledgeContext, _params: Json) -> Json:
    """This person's contributions with their live state (bounded owner checks; no text)."""
    view = ContributionLedger.of(context.journal).view()
    states: dict[str, str] = {}
    gate = asyncio.Semaphore(CHECK_CONCURRENCY)

    async def check(record: Json) -> None:
        async with gate:
            try:
                await _read(context, record)
                states[record["id"]] = "current"
            except KnowledgeError as error:
                states[record["id"]] = "stale" if error.status in (404, 409) else "unavailable"

    active = [record for record in view["contributions"] if record["status"] == "active"][:CHECK_LIMIT]
    tasks = [asyncio.ensure_future(check(record)) for record in active]
    if tasks:
        _done, pending = await asyncio.wait(tasks, timeout=CHECK_SECONDS)
        for task in pending:
            task.cancel()
    contributions = [
        {
            **record,
            "state": "withdrawn"
            if record["status"] == "withdrawn"
            else states.get(record["id"], "unavailable"),
        }
        for record in view["contributions"]
    ]
    return {**view, "contributions": contributions}


async def contribute(context: KnowledgeContext, data: Json) -> Json:
    """Approve one passage revision for Igor after Frige re-verifies it for this person."""
    cited = citation(data.get("citation"))
    passage = await _read(context, cited)
    return await ContributionLedger.of(context.journal).contribute(data, passage)


async def withdraw(context: KnowledgeContext, data: Json) -> Json:
    """Withdraw a contribution; future search marks, reads by Igor and resolves stop."""
    return await ContributionLedger.of(context.journal).withdraw(data)


async def resolve(context: KnowledgeContext, data: Json) -> Json:
    """Igor's pre-use check: active, this person's, and the same source revision now."""
    identifier = identifier_of(data.get("reference"))

    def active() -> Json:
        """The contribution as the ledger holds it now; refuses one that is gone or withdrawn."""
        record = ContributionLedger.of(context.journal).find(identifier)
        if record is None:
            raise KnowledgeError(404, "NOT_FOUND", "That contribution does not exist.")
        if record["status"] != "active":
            raise KnowledgeError(410, "CONTRIBUTION_WITHDRAWN", "That contribution was withdrawn.")
        return record

    record = active()
    try:
        passage = await _read(context, record)
    except KnowledgeError as error:
        if error.status in (404, 409):
            raise KnowledgeError(
                409, "STALE_PASSAGE", "The cited passage changed or is no longer approved."
            ) from error
        raise
    # The Frige read can take seconds; a withdrawal or erasure committed meanwhile must win, so the
    # text is released only if the same contribution is still active once the read has returned.
    if active() != record:
        raise KnowledgeError(410, "CONTRIBUTION_WITHDRAWN", "That contribution was withdrawn.")
    return {
        "schemaVersion": RESOLVED_SCHEMA,
        "reference": record["reference"],
        "citation": {
            key: passage[key]
            for key in (
                "project",
                "attachmentId",
                "title",
                "originalSha256",
                "excerptHash",
                "start",
                "end",
                "passageSha256",
            )
        },
        "text": passage["text"],
        "trust": "untrusted-source",
    }


EXTRA_ROUTES.update(
    {
        ("GET", "/passages/search"): search,
        ("GET", "/passages/read"): read,
        ("GET", "/contributions"): listing,
        ("POST", "/contributions"): contribute,
        ("POST", "/contributions/withdraw"): withdraw,
        ("POST", "/contributions/resolve"): resolve,
    }
)
