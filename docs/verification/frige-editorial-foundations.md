# Frige editorial systems Phase A

**Objective.** Audit the complete editorial workflow and repair source-save
integrity before adding durable history and author decision records.
The [implementation matrix](../program/frige-editorial-systems.md) records
existing and planned capabilities, ownership and delivery dependencies.

**Revisions.** Suite `main` at `b06ebea` and private Igor at `e9c0d85`
matched their remote `main` heads on 2026-11-23. The Phase A changes are in
the local suite working tree. The Igor checkout and suite gitlink use the
same private revision as the baseline.

## Changes

- Frige's existing publishing v1 source write rejects malformed Unicode and
  streams UTF-8 across request chunks. The save checks both its required base
  hash and the original UTF-8 bytes from one read. A detected outside edit
  after writing is reported as a conflict, with the later bytes preserved.
- Pantheon preserves the editor's buffer and undo stack during a save.
  Input typed after submission remains a draft with the returned base hash
  only when the returned source matches the submitted source. A late save
  refreshes the book graph even if the author opened another piece or the
  whole book. Proof currency is unverified when contents need refreshing.
- Plain, CRLF and mixed line endings are kept on matched lines and
  one-for-one replacements where they can be mapped. New or unmapped
  separators use the original file's first convention, or LF. When two
  unpaired CR and LF breaks would otherwise coalesce, the editor encodes
  them as two breaks to preserve lineation.

| Area | Changed paths |
| --- | --- |
| Frige | `apps/frige/server.mjs`, `apps/frige/src/project-store-vault.mjs`, `apps/frige/test/base-path.test.mjs`, `apps/frige/test/change-contract.test.mjs`, `apps/frige/README.md` |
| Pantheon | `apps/pantheon/workspaces/frige/app.js`, `apps/pantheon/workspaces/frige/line-diff.js`, `apps/pantheon/test/server.test.mjs` |
| Shared boundary and browser verification | `protocol/frige/README.md`, `scripts/verify/verify-frige.mjs` |
| Program and evidence | `docs/STATUS.md`, `docs/program/MASTER-PLAN.md`, `docs/program/DECISIONS.md`, `docs/program/frige-editorial-systems.md`, `docs/verification/README.md`, this report |

## Verification

| Check | Evidence |
| --- | --- |
| Baseline `corepack pnpm test` and `corepack pnpm -C stex-igor test` | Passed before implementation. The Frige suite had 149 passes and no skips. |
| Baseline `corepack pnpm run verify:frige` | Passed locally in Chrome with synthetic source, stub inference, verified LuaLaTeX proofs and five viewports. |
| Regression reproduction | The new publishing v1 test received HTTP 200 for an unpaired surrogate on the baseline. The delayed-save browser test showed the newer buffer text disappear on the baseline. The reviewer also reproduced split-byte corruption and stale proof currency with disposable fixtures. |
| Focused HTTP, store and serialization tests | Three passed. Covered input encoding, source-byte preservation, conflict on an intervening edit, BOM, indentation, mixed separators and added stanza breaks. |
| Final `corepack pnpm test` | Passed. 351 Node tests including 150 Frige and 30 Pantheon tests, no Node skips. Ruff, mypy, 64 pytest tests and the Igor sync check passed. |
| `corepack pnpm run build:pantheon` | TypeScript and Vite production build passed. |
| Final `corepack pnpm run verify:frige` | Passed with Chrome, stub inference, real LuaLaTeX proofs and five viewports. Verified in-flight drafts, stale saves and selections, proposal decisions, rollback and both proof-currency cases. The navigation check compiles a fresh book proof to use the current publication profile. |
| Frige through `dev:alpha` | Separate disposable Chrome check passed for an explicit save preserving CRLF, followed by a real proof with verified pagination rendered in the browser. |
| `node --check`, `git diff --check`, documentation links | Passed. Syntax checked on changed scripts and 12 local links checked in the new documents. |

## Independent review

The first review independently reproduced a save exposing a hash for
unseen source after an outside edit, split-chunk UTF-8 corruption, and a
false current-proof status following a failed graph refresh. The repairs
guard the returned source, decode JSON as a single UTF-8 stream, and keep
proof currency unverified during and after an unsuccessful contents refresh.
The second review identified a navigation variant of the stale proof status.
A completed save now refreshes project-wide proof state independently of
which buffer is open. The browser verifier exercises the failure and the
navigation variants. The reviewer rechecked both in Chrome. Two review rounds
were used. The work stayed within the repair budget and required no replan.

## Limits and next increment

- Source hashing and store serialization protect Frige-managed writes in
  one process. Outside processes need their own file coordination. An
  interruption between writing a source file and refreshing its derived
  graph is still outside a persistent direct-save transaction.
- Proposal rollback is distinct from general revision restoration. Audit
  fault injection confirmed that a post-write refresh failure can leave
  restored bytes recorded as accepted by the old rollback operation. A
  multi-piece rollback also lacks interrupted-write recovery. Phase B must
  resolve the relationship between source commits, revision events and the
  existing proposal transaction before claiming general restoration.
- Hosted users still share Frige projects under D-023, with per-project
  passwords under D-024. The local checks do not establish hosted account
  attribution, per-account isolation, live inference or release acceptance.
- The next increment is a durable single-piece revision event and exact
  restore under the existing source-write and project-password boundary.
  The event id, source hash, predecessor and author rationale are separate
  values. This supplies the first foundation for the audit trail used by
  proposal acceptance and anchored editorial decisions.
