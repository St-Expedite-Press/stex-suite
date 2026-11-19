# Program baseline — 2026-11-13

Read-only reconnaissance of `stex-suite` and its `stex-igor` submodule, taken
before any change in the engineering program described in
[the master plan](../program/MASTER-PLAN.md). It records what the code and the
test run show, and separates that from what earlier documents claim.

The Press website is outside this program by owner decision (2026-11-13) and
is not described here. Operational detail about the hosted service stays in
the private `stex-igor` reports; this public file points to them.

## Revisions and method

| Item | Value |
| --- | --- |
| stex-suite | branch `feat/pantheon-platform-p1`, `d96340e`, 15 commits ahead of `main` (`5800920`); draft PR 5 open, mergeable, CI green |
| stex-igor | `d0598d8` on `docs/pantheon-platform-p1`, equal to `origin/main`; that commit is the deployed release per the [remediation record](security-remediation-2026-11.md) |
| Hermes runtime pin | `e76fbd80be65ea5c1b89831f8d7aaedb713f5cac` |
| Working tree | Clean apart from the untracked `apps/texgraph/` (see the debt register) |
| Toolchain | Node 24.18, pnpm 9.15.9, uv 0.11.26, LuaHBTeX 1.24 (MiKTeX), Git LFS 3.7.1; `check:prereqs` passes in full |

Four read-only investigators each audited one area and returned findings with
file references. The coordinating agent re-read the cited code for every
finding relied on below. Nothing was executed against a hosted service, a
provider or a database.

## Test baseline

| Check | Result |
| --- | --- |
| Nine Node suites (assets, design system, Pantheon, Igor, Frige, inference, Seaxneat, Hermes, knowledge) | 157 pass, 0 fail, 0 skipped |
| Ruff lint and format on `backend` | Pass |
| mypy | Pass when run as `python -m mypy` (15 files) |
| pytest | 64 pass when run as `python -m pytest` |
| `test:stex-igor-sync` | Copies match |
| `corepack pnpm test` as one command | **Fails on this Windows machine**: Application Control blocks the `mypy` launcher in `.venv` (`os error 4551`), so `test:platform` stops and the later steps do not run |

The last row is a local environment limit, not a code defect; CI on Linux runs
the same command successfully. No browser `verify:*` script was run for this
baseline.

## Architecture inventory

| Component | Path | Stack | Port | State owned |
| --- | --- | --- | --- | --- |
| Pantheon shell | `apps/pantheon` | Node `http`; plain JS pages; React/TS for the Seaxneat workspace | 4300 | None |
| Frige engine | `apps/frige` | Node `http`; LuaLaTeX | 4310 | Manuscripts, threads, proposals, design profile, proofs |
| Frige workstation UI | `apps/pantheon/workspaces/frige` | Plain ES modules, unbuilt | via 4300 | None |
| Seaxneat engine | `apps/seaxneat` | Node `http`; Git, pnpm, Next | 4320 | Website workspaces and validated revisions |
| Platform API | `backend/stex` | Python 3.12, FastAPI | 4340 | None |
| Knowledge | `services/knowledge` | In-process Node library | none | Opt-in metadata journal |
| Igor application | `stex-igor/apps/igor` | Node `http` server; React client | 4330 | Conversations, sessions |
| Inference service | `stex-igor/services/inference` | Node, no dependencies | 8100 | None |
| Hermes configuration | `stex-igor/hermes` | JSON, Markdown, validator | none | Declarative profiles and skills |
| Design system | `packages/design-system` | CSS tokens, fonts, brand marks | `/design-system/` | None |
| Eostre, Woden | `apps/eostre`, `apps/woden` | README only | none | Deferred |

## Maturity matrix

| Capability | Implemented | Tested locally | Verified live | Deployed |
| --- | --- | --- | --- | --- |
| Pantheon splash, command center, project pages | Yes | Yes | No | No |
| Frige manuscript graph, scoped threads, change sets, proofs, preflight | Yes | Yes | No | No |
| Frige proposals from a real director | **No** — the gateway returns no changes | Browser path tested with a stub only | No | No |
| Frige rollback and change history | **No** | — | — | — |
| Frige section and element layout settings | **No** (book level only) | — | — | — |
| Seaxneat workspace, revisions, preview | Yes; proposals are a deterministic simulator | Yes | No | No |
| Platform API (M1, M2a) | Yes | Yes | No | No |
| Knowledge journal and Graph tab | Yes, opt-in | Yes | No | No |
| Vault adapter | Library only; no caller | One test file | No | No |
| Obsidian integration | No | — | — | — |
| Igor conversation, sign-in, per-account ownership | Yes | Yes (stub inference) | Bounded live turns; ownership not checked with two real accounts | Yes |
| Inference boundary `stex.hermes.turn.v1` | Yes | Yes (fake and stub) | Bounded live turns | Yes |
| Specialist profiles, skills, delegation | Configuration only | Shape checks only | No | No |
| Runtime tools and isolation boundary | No | No executable negative test | No | No |

## Dependency map

```
browser ──► Pantheon (4300) ──proxy──► Frige (4310) ──► inference (8100) ──► Hermes (loopback)
                │                      Seaxneat (4320)        ▲
                │                      Igor (4330) ───────────┘
                ├──► platform API (4340) ──► Frige and Seaxneat project summaries
                └──► knowledge library (in process) ──► engines' context exports
```

- **Suite to Igor:** the suite pins a stex-igor commit as a submodule, tests
  against it, and copies the design system, masthead and splash into it
  (`scripts/sync-stex-igor.mjs`).
- **Igor to suite:** stex-igor implements the contracts in `protocol/`. Its
  release cycle is independent, and a push to its `main` deploys.
- **Frige to Igor:** none. Frige calls the inference service directly through
  the legacy `scope-turn` adapter; Igor only reads Frige's context export.
- **Hosted Igor to local engines:** none. The hosted service cannot reach a
  local Frige or Seaxneat.

## Contract inventory

| Contract | Schema | Producer | Consumers | Validation at run time |
| --- | --- | --- | --- | --- |
| `stex.applications.registry.v2` | JSON Schema | Static file | Pantheon, platform API | Hand-written in Node, Pydantic in Python |
| `stex.projects.summary.v1` | JSON Schema | Frige, Seaxneat | Pantheon, platform API | Hand-written in three places; the schema file is not loaded |
| `stex.platform.projects.v1` | JSON Schema, OpenAPI | Platform API | Pantheon | Pydantic |
| `stex.frige.publishing.v1` | README | Frige | Pantheon workstation | Route allow-list plus store validators |
| Legacy books v1 | README | Frige | Pantheon `/api/books` proxy | Hand-written |
| `stex.texgraph.scope-turn.v3` | README | Inference adapter | Frige | Hand-written |
| `stex.seaxneat.workspace.v1` | README | Seaxneat | Pantheon workspace | Hand-written |
| `stex.project.context.v1` | README | Frige, Seaxneat | Pantheon knowledge host, Igor | Hand-written |
| `stex.knowledge.event.v1`, `.projections.v1` | JSON Schema, README | Engines, knowledge library | Pantheon | Hand-written; the schema file is not loaded |
| `stex.igor.interface.v1`, `.conversations.v1`, `.context.v1` | README | Igor | Pantheon | Hand-written |
| `stex.hermes.turn.v1` | JSON Schema (request, response) | Inference service | Igor, Frige adapter | Hand-written, not driven by the schema |

## What the code shows against what documents claim

| Claim | Finding |
| --- | --- |
| Frige offers AI-assisted proposals | The acceptance machinery is real and tested. Nothing produces a proposal: the inference adapter returns `changes: []` for every Frige turn, and Frige's simulator does the same. Only the `verify:frige` stub emits one |
| "Writes go through one serialized path that rejects stale bases" (Frige invariant 6) | True when a base hash is sent. A save that omits it is written unchecked (`apps/frige/src/project-store-vault.mjs`, `#writeNode`) |
| Eight Igor profiles and twelve skills | Present as configuration with shape tests. `stex.hermes.turn.v1` has no profile field and all toolsets are empty, so no product can reach a specialist |
| `STATUS.md` on suite CI | Row 12 says PR 5 CI passes; rows 5 and 7, the M0 row of the transition plan and the release report still say blocked on CI access. The passing rows are current |
| `.env.example` enables the User Graph through `STEX_VAULT_PATH` | The Graph is enabled by `STEX_KNOWLEDGE_DATA_DIR`, which the example omits. The vault adapter has no caller |
| `build:seaxneat` is a React production build of Seaxneat | It delegates to Pantheon's build; Seaxneat has no client |
| `stex-igor/hermes/README.md` names `roster.yaml` and seven provisioned specialists | The roster file is asserted absent by its test, and no script provisions specialists |

## Technical debt register

Ranked by effect on the program. Each entry was confirmed by reading the cited
code unless marked otherwise.

1. **No producer of Frige proposals** — `stex-igor/services/inference/server.mjs`
   (`legacyTurn`). Blocks any real conversation-to-change workflow.
2. **No rollback or change history in Frige** — a new change set overwrites
   the previous file, including undecided changes
   (`project-store-vault.mjs`, `#createChangeSet`).
3. **Stale-write guard is optional** — see the table above.
4. **Book-scope conversations see only the table of contents**
   (`scopeContext`), so book-level editorial work cannot inspect pieces.
5. **Frige identities derive from paths** — a renamed file gets a new node id
   and orphans its thread and proposals; a section id changes when its first
   piece changes.
6. **Igor does not stream and has one global turn queue** — the page polls
   each second, and one account's turn delays every account.
7. **No usage or cost record** — token counts return from the provider and
   are discarded.
8. **Hand-written validation duplicates JSON Schemas** in several consumers,
   and the registry is validated by two implementations with different rules.
9. **Seaxneat simulator input handling** — the request text is used as a
   `String.replace` replacement pattern, and braces are stripped at project
   creation but not on a proposal (`apps/seaxneat/src/project-store.mjs`).
10. **Pantheon proxy forwards every request header** to the matched engine and
    sets no upstream timeout (`apps/pantheon/src/shell.mjs`).
11. **Frige duplication** — two LuaLaTeX runners, two atomic writers, and two
    attachment-manifest writers, one of them not atomic.
12. **Settings path mismatch** — the legacy scaffold writes
    `frige/settings.json`; the store reads `texgraph/settings.json`.
13. **`corepack pnpm test` fails on Windows under Application Control** — see
    the test baseline. Invoking the Python tools as modules avoids it.
14. **Untracked `apps/texgraph/`** — the pre-rename Frige path. It holds old
    local state and two untracked author files that an Obsidian vault appears
    still to write to. It is not ignored, so an unqualified `git add` in this
    public repository would publish them. It must not be cleaned or staged.

## Release-risk register

| Risk | Where recorded | Owner action |
| --- | --- | --- |
| A push to `stex-igor` `main` deploys to production, with no branch protection | [D1 summary](stex-deployment-d1.md) | Authorize each push |
| Provider credential expiry and spend bound for the hosted service | Private `stex-igor/docs/verification/stex-deployment-d1.md` | Renew before the recorded date; consider a limit |
| Owner-run hardening still open (identity, egress, edge) | [STATUS](../STATUS.md) hosted-Igor and D1 rows; private D1 report | Owner-run changes |
| Per-account conversation isolation unverified with two real accounts in production | [Remediation record](security-remediation-2026-11.md) | Authorize a production check |
| Rolling Igor back before `d0598d8` removes per-account ownership | Private runbook | Avoid that rollback target |
| Suite PR 5 is unmerged; this program builds on its branch | [STATUS](../STATUS.md) | Decide merge order |
| Untracked author files inside the public working tree | Debt item 14 | Decide where they belong |

## Limits

- No browser verification and no live service was exercised.
- Hosted state (model, profiles, firewall, tokens) was not queried; statements
  about it come from dated reports.
- Subagent findings not re-read by the coordinator are marked as reported, not
  confirmed, in the program records that cite them.
