# STEX platform API — Python backend charter

**Scope:** `backend/` (the `stex` package and its tests), plus the root
`pyproject.toml`, `uv.lock` and `.python-version` it is built from. The
[root charter](../AGENTS.md) governs; this file adds Python-specific rules.

## What this package is

The Python/FastAPI platform API introduced by milestone M1 of the
[Python backend migration](../docs/PLATFORM-TRANSITION.md#python-backend-migration).
It runs **beside** the existing Node engines and currently serves
`/health` and the read-only [`stex.platform.projects.v1`](../protocol/platform/README.md),
which Pantheon's project pages read through `/api/platform/v1/projects` with a
browser fallback (M2a). `dev:alpha` starts it.

Separation milestone 1 (local candidate) adds `stex.knowledge` behind
`/api/knowledge/v1`: a byte-compatible port of the knowledge journals that
Pantheon relays to when `STEX_KNOWLEDGE_SERVICE=platform`, plus private
passage contributions and read-only Obsidian note import. The Node library
remains the native default and the rollback path. Do not claim more than that;
see [the evidence](../docs/verification/separation-m1.md).

## Rules

- **Ownership.** The platform owns only its own read models and, in later
  authorized milestones, platform records. It never reads or writes an
  engine's files, imports Node modules, or keeps a second copy of engine
  canonical state. Engines are reached only through versioned `protocol/`
  contracts over loopback HTTP origins validated by `stex.config`.
- **Layers.** FastAPI routers (`api.py`) handle transport only. Logic lives in
  domain services callable without HTTP, and is tested that way first.
  `platform` must not depend on a particular engine's internals.
- **Contracts.** Every endpoint has a JSON Schema and README under
  `protocol/`; `protocol/platform/openapi.v1.json` is generated with
  `corepack pnpm openapi:platform` and must match the app (a test fails
  otherwise). Extend with a new version rather than changing a published one.
- **Failure behaviour.** Bound every outbound call by time and size; never
  follow redirects to engines; do not use proxy environment variables; an
  unavailable engine is reported, never guessed or replaced with cached data.
- **Configuration.** Read only through `Settings.from_environment`. Bind and
  call loopback only, except the explicit container opt-in (`STEX_BIND_ALL=1`
  with fixed peer names in `STEX_INTERNAL_HOSTS`) used by
  `deploy/staging-compose`. Secrets (`STEX_PLATFORM_ACTOR_SECRET`,
  `STEX_KNOWLEDGE_IGOR_SECRET`) come only from ignored local configuration,
  never code or docs. The knowledge routes are listed once in
  `stex/knowledge/contract.py`; their payloads are the published schemas in
  `protocol/knowledge` and `protocol/frige/passages.v1.schema.json`, and
  `backend/tests/test_knowledge_contract.py` fails if the README tables, that
  list, the schemas and the generated OpenAPI drift.
- **Toolchain.** uv with the committed `uv.lock` and `.python-version` (3.12);
  FastAPI, Pydantic, httpx2; Ruff (lint + format), mypy `strict`, pytest.
  Add a dependency only with an identified caller and a failing test.
  PostgreSQL, SQLAlchemy and Alembic arrive with the milestone that first
  needs durable platform records, not before.
- **Migration slices.** Moving an engine operation into Python follows the
  migration plan: parity tests against the Node behaviour, disposable data,
  rollback to the Node path, and switching routing only after review.

## Checks

```powershell
corepack pnpm test:platform        # ruff check, ruff format --check, mypy, pytest
corepack pnpm verify:platform-api  # real Frige + Seaxneat + platform, disposable data
corepack pnpm dev:platform         # serve on 127.0.0.1:4340 (STEX_PLATFORM_PORT)
```
