# Frige single-piece editorial state

**Objective.** Make a Frige source save auditable and reversible, and let
the author record why a reading was kept or chosen. This is the approved
single-piece increment of Phase B in the
[editorial systems plan](../program/frige-editorial-systems.md).

**Revisions.** Local suite working tree based on `b06ebea`, including the
previous [Phase A foundation](frige-editorial-foundations.md). The suite
commit and private Igor pin `e9c0d85` are the same as at the start.

| Changed paths | Responsibility |
| --- | --- |
| `apps/frige/src/editorial-journal.mjs` | Exact snapshots, revision events, decisions, path and corruption checks, pending event reconciliation |
| `apps/frige/src/project-store-vault.mjs` | Shared write queue, guarded manual save and restore, coordination with recovery of proposal acceptance |
| `apps/frige/server.mjs`, `apps/frige/src/publishing-contract.mjs` | Additive route dispatch through the existing project-password gate |
| `apps/frige/test/editorial-journal.test.mjs`, `apps/frige/test/project-access.test.mjs`, `scripts/verify/verify-frige.mjs` | Store, HTTP authorization and real-proof verification on disposable manuscripts |
| `protocol/frige/README.md`, `apps/frige/README.md`, `docs/STATUS.md`, `docs/program/DECISIONS.md`, `docs/program/frige-editorial-systems.md`, `docs/verification/README.md` | Contract, workflow, program decision and current evidence |

## Acceptance evidence

- A direct save records its predecessor and preserves exact original bytes.
  Restore creates a new event with its own id, even when content repeats
  an older hash. The synthetic restoration tests cover BOM, mixed line
  endings, significant whitespace, Unicode and no final newline. They
  also cover preexisting sources above the new-save limit.
- Concurrent manual saves serialize. Restore and decision requests
  recheck both the source hash and the current event id. The decision
  records an author reason against a whole piece revision and never writes
  canonical source.
- With a saved intent and a simulated stop, a reopened store recognizes
  whether the intended bytes reached disk. It clears attempts whose bytes
  are absent and preserves different intervening bytes. Recovery is
  ordered with legacy proposal acceptance in both directions.
- Frige refuses corrupted metadata, invalid UTF-8 and linked snapshot
  paths. HTTP tests exercise reads and writes across a locked book, an
  unlocked browser and another book. The browser verifier uses the
  Pantheon proxy to restore through the API and compile a proof whose
  source manifest contains the restored hash.

## Verification and review

| Check | Result |
| --- | --- |
| `node --test apps/frige/test/editorial-journal.test.mjs apps/frige/test/project-access.test.mjs` | 15 passed, zero skips |
| `corepack pnpm test` | 364 Node tests passed, including 163 Frige tests, with zero Node skips. Ruff, mypy, 64 pytest tests and the Igor vendor sync check passed. |
| `corepack pnpm run verify:frige` | Passed in Chrome at five viewports, with stub inference and real LuaLaTeX. The proof source manifest matched the restored hash. |
| Frige through `dev:alpha` | A disposable Chrome run saved source, recorded a reason through the API, restored exact CRLF bytes, and rendered a compiler-verified proof with the restored hash. |
| `node --check`, `git diff --check`, documentation links | Passed. Seven Phase B links and heading anchors checked. |

An earlier Frige suite run hit a transient Windows file lock while
cleaning a LuaLaTeX build. The isolated proof test and the subsequent full
suite passed. This used one focused retry and required no replan.

Independent review reproduced an inability to restore verified legacy
source above the save size limit, and an unfinished proposal acceptance
that could undo a later restore of identical bytes. Both were fixed and
rechecked. The reviewer also confirmed fail-closed metadata decoding and
same-revision decision deduplication. In the second round an independent
child process exited after replacing the manuscript and before finalizing
the journal. Reopening recorded the exact restore once with its original
event id and predecessor. Two review rounds were used and no high-severity
finding remained open.

## Limits

- The current journal records manual source saves and exact restores.
  Proposal acceptance and rollback keep their own audit records. The next
  increment needs joint recovery with proposal transactions and tests for
  individual proposed edits. Existing proposal rollback guards still
  compare content hashes.
- Revision and decision history is exposed through the publishing API.
  A visual history browser, exact-passage annotations, comparison across
  revisions and passage-bound Igor discussion remain pending.
- Provenance records the author action in the existing shared project
  access model. Hosted audit attribution to named accounts and per-account
  project isolation require the separate ownership milestone.
- Recovery is exercised with process-stop fault injection and a reopened
  store. The write queue is per engine process. An external writer which
  changes a file and returns to the same bytes between observations is
  outside event tracking. Snapshot reclamation and multi-process
  coordination remain future storage work.
