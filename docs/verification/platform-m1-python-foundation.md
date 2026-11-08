# M1 — Python platform foundation

Date: 2026-11-08 · Base revision: `6f2ac09` (suite), `bad90a9` (stex-igor) ·
Authorization: the owner approved M1 and continuation into later milestones
in this session, with local commits only; deployment, pushing, destructive
data operations and paid calls remain separately gated.

## Objective

Introduce the Python/FastAPI platform API **beside** the existing Node
engines, without behavior regression: typed configuration, a health route, one
validated read-only operation, and the Python toolchain wired into the
deterministic suite and CI.

## Implemented

| Item | Detail |
| --- | --- |
| Package | `backend/stex` built from the root `pyproject.toml` (uv_build); `uv.lock`; `.python-version` 3.12 |
| Runtime dependencies | FastAPI 0.162.2 (Starlette 1.10.0, Pydantic 2.14.3), httpx2 2.16.0, uvicorn 0.54.0 |
| Dev tooling | Ruff (lint + format), mypy `strict`, pytest, jsonschema |
| Configuration | `stex.config.Settings`: loopback-only bind host, port 4340 (`STEX_PLATFORM_PORT`), engine origins from `STEX_FRIGE_URL` / `STEX_SEAXNEAT_URL` accepted only as bare loopback HTTP origins (Pantheon's rule) |
| Registry | Typed reader for `protocol/applications/registry.v2.json`; an invalid registry stops startup |
| Operation | `GET /api/v1/projects` → new additive contract [`stex.platform.projects.v1`](../../protocol/platform/README.md) merging active studios' `stex.projects.summary.v1`, with Pantheon's consumer rules (2 s budget per studio, invalid document → unavailable, invalid entry dropped, newest first) plus a 2 MB size bound, no redirects, no proxy environment and no cache |
| Contract artifacts | JSON Schema, README and generated `openapi.v1.json` in `protocol/platform/`; a test fails when the app and the committed OpenAPI document differ |
| Scripts | `test:platform` (in `corepack pnpm test`), `verify:platform-api`, `dev:platform`, `openapi:platform`; `check:prereqs` requires uv |
| CI | `astral-sh/setup-uv` pinned to v10.3.0 by SHA with uv 0.11.26, then `uv sync --frozen` before `corepack pnpm test` |
| Charter | `backend/AGENTS.md` + shim; root charter map, ports and instruction sources updated |

Not changed: every Node service, Pantheon routing and its browser project
loader, engine storage, protected manuscripts, artwork and presentation.

## Commands and results

| Command | Result |
| --- | --- |
| `uv lock`, `uv sync --frozen` | 35 packages resolved on CPython 3.12.10 |
| `corepack pnpm test:platform` | Ruff lint/format clean; mypy strict: no issues in 15 files; pytest **63 passed** |
| `corepack pnpm verify:platform-api` | **PASS** — real Frige (synthetic book, `/frige` mount) and Seaxneat (empty disposable data) with the platform on free ports. Both studios `available`; platform ids equal each studio's own summary; the synthetic book's reference, title, kind, time, status and openPath unchanged, `href` `/frige/?book=fixture-book`. After stopping Seaxneat: Seaxneat `unavailable`, Frige's projects kept, none invented, answered in 2015 ms (check allows 4 s) |
| `corepack pnpm test` | Exit 0: instructions (8 suite + 7 stex-igor charter/shim pairs), assets 4, design system 8, Pantheon 17, Igor 20, Frige 53, inference 8, Seaxneat 21, Hermes 7, knowledge 13, platform 63, stex-igor sync match |
| `git diff --check` | Clean |

The pytest suite covers: merge order and ties; only active studios polled;
500/404/wrong version/wrong application/non-list/non-object/HTML/`NaN`/
redirect each → unavailable while the other studio is kept; unreachable and
slow studios (concurrent polling, time budget); oversize body; thirteen
invalid-entry shapes dropped; unknown fields not passed through; no caching;
unconfigured origin; registry/schema agreement and invalid-registry refusal;
loopback-origin and bind-host refusal; HTTP schema conformance, all-down
answer, app-level redirect refusal, read-only method, no docs UI, OpenAPI drift;
nested-body, lone-surrogate, invalid-UTF-8, BOM, compressed-reply and
`identity` request regressions; stable order for equal and missing times.

## Findings during verification

- Frige mounted at `/frige` answers only under its mount. The first live run
  failed because the platform requested `/api/stex/projects` at the origin
  root. The platform now requests `<registry route>api/stex/projects`, the
  same path Pantheon's proxy forwards; unit tests and the contract README were
  updated. Unit tests with a mock network could not have caught this.
- On Windows a refused loopback connection takes about 2 s to fail, so a
  stopped studio consumes the full budget rather than failing instantly.
- `starlette.testclient` deprecates `httpx` in favour of `httpx2`; the platform
  uses httpx2 throughout rather than a deprecated client.

## Limits

- Seaxneat's live parity is empty-list parity: creating a Seaxneat project
  provisions a Next.js workspace, which this check does not do. Seaxneat
  entry mapping is covered by unit tests only.
- A date-time without an offset sorts as UTC; the browser's `Date.parse`
  would read it as local time. Studios emit UTC with `Z`.
- CI includes the new step but has not run: suite CI remains blocked on
  owner-run access (see [release report](platform-release.md)).
- No browser workflow changed, so no browser verification was run for M1.

## Independent review

One review round by a separate reviewer agent on the full diff (no author
conclusions supplied). Confirmed and fixed: a pathologically nested studio
body and a lone surrogate escape each turned the whole endpoint into a 500
(now: studio unavailable / character replaced, with regression tests that fail
without the fix); stale "no Python in this release" wording in the transition
plan; an evidence claim about tie ordering that had no test (test added).
Also adopted: browser-equivalent UTF-8 decoding, `identity` encoding with
compressed replies refused (no decompression past the size bound), a stricter
port check, the Seaxneat caveat in STATUS, a wider timing margin, documented
date-parsing differences. Accepted as limits: date parsing beyond RFC 3339
differs from `Date.parse`; `stex.config.REPOSITORY_ROOT` assumes the package
runs from the checkout (uv's editable install), which is the only supported
way to run it today.
