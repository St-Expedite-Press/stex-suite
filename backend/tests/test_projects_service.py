from __future__ import annotations

import asyncio
import time
from typing import Any

import httpx2
import pytest
from conftest import FRIGE, ORIGINS, SEAXNEAT, Studios, entry, json_reply, summary

from stex.config import DEFAULT_REGISTRY
from stex.platform.projects.models import PlatformProjects
from stex.platform.projects.service import ProjectSummaryService, sort_time, valid_entry
from stex.platform.registry import load_registry

REGISTRY = load_registry(DEFAULT_REGISTRY)


async def listing(studios: Studios, **options: Any) -> PlatformProjects:
    async with httpx2.AsyncClient(transport=studios.transport(), follow_redirects=False) as client:
        service = ProjectSummaryService(REGISTRY, ORIGINS, client, **options)
        return await service.list_projects()


def states(result: PlatformProjects) -> dict[str, str]:
    return {studio.id: studio.state for studio in result.studios}


def test_merges_active_studios_newest_first_and_links_through_the_registry_route() -> None:
    website = entry(
        "site",
        "2026-11-07T09:00:00Z",
        reference="stex://seaxneat/project/site",
        kind="website",
        status={"state": "failed", "label": "Build failed"},
        openPath="/?project=site",
    )
    studios = Studios(
        {
            FRIGE: json_reply(
                summary(
                    "frige",
                    entry("old", "2026-01-01T00:00:00.000Z"),
                    entry("undated", None),
                    entry("new", "2026-11-06T00:00:00.000Z"),
                )
            ),
            SEAXNEAT: json_reply(summary("seaxneat", website)),
        }
    )
    result = asyncio.run(listing(studios))
    assert [project.id for project in result.projects] == ["site", "new", "old", "undated"]
    assert states(result) == {"frige": "available", "seaxneat": "available"}
    site = result.projects[0]
    assert (site.studio, site.href, site.status.state) == ("seaxneat", "/seaxneat/?project=site", "failed")
    assert result.projects[1].href == "/frige/?book=new"
    assert result.projects[3].updated_at is None


def test_only_active_studios_are_polled_with_a_json_accept_header() -> None:
    studios = Studios({FRIGE: json_reply(summary("frige")), SEAXNEAT: json_reply(summary("seaxneat"))})
    result = asyncio.run(listing(studios))
    assert [studio.id for studio in result.studios] == ["frige", "seaxneat"]
    assert sorted(str(request.url) for request in studios.requests) == [
        FRIGE + "/frige/api/stex/projects",
        SEAXNEAT + "/seaxneat/api/stex/projects",
    ]
    assert all(request.headers["accept"] == "application/json" for request in studios.requests)
    assert all(request.method == "GET" for request in studios.requests)


@pytest.mark.parametrize(
    "reply",
    [
        json_reply({"error": "boom"}, status=500),
        json_reply(summary("frige"), status=404),
        json_reply({**summary("frige"), "schemaVersion": "stex.projects.summary.v2"}),
        json_reply(summary("seaxneat")),
        json_reply({"schemaVersion": "stex.projects.summary.v1", "application": "frige", "projects": {}}),
        json_reply([summary("frige")]),
        lambda _request: httpx2.Response(200, content=b"<html>not json</html>"),
        lambda _request: httpx2.Response(200, content=b'{"schemaVersion": NaN}'),
        lambda _request: httpx2.Response(302, headers={"location": "http://example.com/api/stex/projects"}),
    ],
    ids=[
        "500",
        "404",
        "wrong-version",
        "wrong-application",
        "projects-not-list",
        "not-object",
        "html",
        "nan",
        "redirect",
    ],
)
def test_a_studio_with_an_unusable_answer_is_unavailable_and_the_others_are_kept(reply: Any) -> None:
    studios = Studios(
        {FRIGE: reply, SEAXNEAT: json_reply(summary("seaxneat", entry("site", openPath="/?p=1")))}
    )
    result = asyncio.run(listing(studios))
    assert states(result) == {"frige": "unavailable", "seaxneat": "available"}
    assert [project.id for project in result.projects] == ["site"]
    assert len(studios.requests) == 2, "redirects must not be followed"


def test_an_unreachable_studio_is_unavailable() -> None:
    result = asyncio.run(listing(Studios({SEAXNEAT: json_reply(summary("seaxneat"))})))
    assert states(result) == {"frige": "unavailable", "seaxneat": "available"}


def test_a_slow_studio_is_cut_off_at_its_budget_while_studios_are_polled_concurrently() -> None:
    async def slow(_request: httpx2.Request) -> httpx2.Response:
        await asyncio.sleep(5)
        return httpx2.Response(200, json=summary("frige", entry("late")))

    studios = Studios({FRIGE: slow, SEAXNEAT: json_reply(summary("seaxneat"))})
    started = time.monotonic()
    result = asyncio.run(listing(studios, timeout_seconds=0.2))
    assert time.monotonic() - started < 2
    assert states(result) == {"frige": "unavailable", "seaxneat": "available"}
    assert result.projects == ()


def test_an_oversized_summary_is_unavailable() -> None:
    padded = summary("frige", entry("big", title="x" * 5_000))
    result = asyncio.run(
        listing(
            Studios({FRIGE: json_reply(padded), SEAXNEAT: json_reply(summary("seaxneat"))}), max_bytes=1_000
        )
    )
    assert states(result)["frige"] == "unavailable"


@pytest.mark.parametrize(
    "override",
    [
        {"openPath": "//evil.example/"},
        {"openPath": "relative"},
        {"openPath": "/a/../b"},
        {"openPath": "/.."},
        {"openPath": "/x/..?y"},
        {"openPath": 7},
        {"title": ""},
        {"title": None},
        {"id": 3},
        {"kind": None},
        {"status": {"state": "done", "label": "Done"}},
        {"status": {"state": "ready"}},
        {"status": "ready"},
    ],
)
def test_entries_breaking_the_consumer_rules_are_dropped(override: dict[str, Any]) -> None:
    bad = entry("bad", **override)
    studios = Studios(
        {FRIGE: json_reply(summary("frige", bad, entry("good"))), SEAXNEAT: json_reply(summary("seaxneat"))}
    )
    result = asyncio.run(listing(studios))
    assert [project.id for project in result.projects] == ["good"]
    assert states(result)["frige"] == "available"


def test_entries_that_are_allowed_keep_their_meaning_and_unknown_fields_are_not_passed_through() -> None:
    allowed = entry("odd", "not a time", reference=None, openPath="/..hidden/?x=1", injected="<script>")
    studios = Studios(
        {FRIGE: json_reply(summary("frige", allowed)), SEAXNEAT: json_reply(summary("seaxneat"))}
    )
    project = asyncio.run(listing(studios)).projects[0]
    assert (project.reference, project.updated_at, project.open_path) == (
        None,
        "not a time",
        "/..hidden/?x=1",
    )
    assert "injected" not in project.model_dump(by_alias=True)


def test_nothing_is_cached_between_calls() -> None:
    documents = [summary("frige", entry("first")), summary("frige", entry("second"))]
    studios = Studios(
        {
            FRIGE: lambda _r: httpx2.Response(200, json=documents.pop(0)),
            SEAXNEAT: json_reply(summary("seaxneat")),
        }
    )

    async def twice() -> list[list[str]]:
        async with httpx2.AsyncClient(transport=studios.transport()) as client:
            service = ProjectSummaryService(REGISTRY, ORIGINS, client)
            return [[p.id for p in (await service.list_projects()).projects] for _ in range(2)]

    assert asyncio.run(twice()) == [["first"], ["second"]]


def test_a_studio_without_a_configured_origin_is_unavailable_without_a_request() -> None:
    studios = Studios({FRIGE: json_reply(summary("frige"))})

    async def run() -> PlatformProjects:
        async with httpx2.AsyncClient(transport=studios.transport()) as client:
            return await ProjectSummaryService(REGISTRY, {"frige": FRIGE}, client).list_projects()

    assert states(asyncio.run(run())) == {"frige": "available", "seaxneat": "unavailable"}
    assert len(studios.requests) == 1


def test_sort_time_matches_date_parse_or_zero() -> None:
    assert sort_time("2026-11-05T17:02:11.000Z") == sort_time("2026-11-05T17:02:11+00:00") > 0
    assert sort_time(None) == sort_time("garbage") == 0
    assert valid_entry(entry("x")) and not valid_entry(["x"])


def test_equal_and_missing_times_keep_studio_then_source_order() -> None:
    same = "2026-11-05T10:00:00Z"
    studios = Studios(
        {
            FRIGE: json_reply(summary("frige", entry("f1", same), entry("f-none", None), entry("f2", same))),
            SEAXNEAT: json_reply(summary("seaxneat", entry("s1", same), entry("s-bad", "Nov 5"))),
        }
    )
    result = asyncio.run(listing(studios))
    assert [project.id for project in result.projects] == ["f1", "f2", "s1", "f-none", "s-bad"]
