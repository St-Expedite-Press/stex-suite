# Frige change contracts — Wave 2 evidence

**Objective:** the first end-to-end Frige workflow of
[the program](../program/MASTER-PLAN.md#wave-2-acceptance-criteria): from a
conversation about one piece to a recorded change contract, an explicit
decision, a LuaLaTeX proof, and a rollback.

**Status:** implemented and tested locally. Not pushed, not merged, not
deployed.

| Item | Value |
| --- | --- |
| Branch | `feat/frige-change-contracts` (local) |
| Base | stex-suite `d96340e`; stex-igor `d0598d8` (unchanged) |
| Dates | 2026-11-13 to 2026-11-17 |
| Environment | Windows 11, Node 24.18, LuaHBTeX 1.24 (MiKTeX), Chrome |
| Inference | Deterministic simulator and a local stub only. No provider call |
| Data | Synthetic books in temporary directories. No real manuscript was read or written |

## What changed

| Path | Change |
| --- | --- |
| `apps/frige/src/change-contract.mjs` | New. Pure rules for the contract record: building it, validating a record read from disk, line counts, superseding, conflicts, proof matching and ranking, summaries |
| `apps/frige/src/project-store-vault.mjs` | Contracts journaled under `.texgraph/contracts/`; per-scope pointer; supersede instead of overwrite; `revertChanges`; proof linking in `recordBuild`; a save requires its base hash; a file that is not valid UTF-8 is never overwritten |
| `apps/frige/src/book-assembler.mjs` | A proof's source hashes are taken from the text actually typeset |
| `apps/frige/server.mjs` | Routes for contract history, one contract, and rollback; provenance passed to the store; error-code to status map |
| `apps/frige/src/publishing-contract.mjs` | The three routes added to the `stex.frige.publishing.v1` allow-list |
| `apps/frige/src/inference-client.mjs` | The simulator proposes one labelled change for `Simulate change: <line>` |
| `apps/pantheon/workspaces/frige/` | Contract terms on a pending proposal; **Roll back** and a proof note beside an accepted change |
| `scripts/verify-frige.mjs` | Browser journey extended: proof on the contract, rollback, reject |
| `protocol/frige/` | Contract documentation and `change-contract.v1.schema.json` |
| `apps/frige/README.md` | Workflow documentation |

Contract touched: `stex.frige.publishing.v1`, additively, plus the two
protective refusals recorded as [D-004](../program/DECISIONS.md) and
[D-009](../program/DECISIONS.md). New record contract:
[`stex.frige.change-contract.v1`](../../protocol/frige/README.md#change-contracts-v1).

## Acceptance criteria and evidence

Test names are from `apps/frige/test/change-contract.test.mjs` unless another
file is named.

| # | Criterion | Evidence |
| --- | --- | --- |
| 1 | Open a book, select a piece, send a message | `verify:frige` (Chrome) |
| 2 | The reply carries a contract: request, reason, exact before and after with hashes, context by category, effects, conflicts, rollback terms | "stored as a contract with provenance"; the schema test; `base-path.test.mjs` contract journey; terms asserted in `verify:frige` |
| 3 | Nothing changes until acceptance | Same tests assert the file bytes after the proposal |
| 4 | Rejecting leaves the manuscript byte-identical and records the decision | "rejecting a contract…"; `verify:frige` |
| 5 | Accepting writes through the base-hash path; a later edit makes the change stale | Existing "accepting never overwrites a node edited since"; "a save without a base hash is refused"; the conflicts test |
| 6 | A LuaLaTeX proof is built from the accepted text and recorded on the contract | "a real LuaLaTeX proof…is recorded on its contract"; "a proof records the hash of the text it typeset"; `verify:frige` waits for `proof.paginationVerified` |
| 7 | Rollback restores exact bytes and hash, keeps identity, and is refused after a later edit | "rolling back…restores the exact prior bytes, hash and identity"; "a rollback is refused…"; "a byte-order mark, Windows line endings…"; HTTP journey (`409 STALE_SOURCE`); `verify:frige` |
| 8 | Every contract stays readable; a newer proposal supersedes without erasing | "a newer proposal supersedes…"; both change-set-from-before-contracts tests; "unusable contract files…" |
| 9 | Store, HTTP and browser evidence | Rows above |

## Commands and results

Run on 2026-11-17 after the round-2 fixes.

| Command | Result |
| --- | --- |
| `corepack pnpm run test:frige` | 83 pass, 0 fail, 0 skipped (53 before this change) |
| `corepack pnpm test`, Node suites | 187 pass, 0 fail, 0 skipped across nine suites (157 before) |
| `corepack pnpm test`, as one command | Stops at `test:platform`: Windows Application Control blocks the `mypy` launcher. Same as the [baseline](program-baseline-2026-11-13.md); not caused by this change |
| `uv run --frozen python -m mypy` | No issues in 15 files |
| `uv run --frozen python -m pytest` | 64 pass |
| `corepack pnpm run test:stex-igor-sync` | Copies match |
| `corepack pnpm run test:instructions` (suite part) | Pass |
| `corepack pnpm run build:pantheon` | Built |
| `corepack pnpm run verify:frige` | PASS: create, save, stale save, proposal, accept, real proof, proof on contract, rollback, second proposal, reject, profile, model settings, keyboard, five widths (1440, 1024, 768, 390, 320) with no horizontal overflow |
| `git diff --check` | Clean |

Screenshots (`contract-proposal.png`, `contract-accepted.png` and the five
widths) and `report.json` are written outside the repository by
`verify:frige`.

## Independent review

A separate reviewer agent was given the diff and the charters, not the
author's conclusions, and reproduced its findings with scripts on temporary
fixtures.

**Round 1** found one High and six Medium defects, with lower-ranked items.
It confirmed that locking, path validation, the facade allow-list, HTML
safety, CSRF posture and every caller of the save path held up.

| Finding | Disposition |
| --- | --- |
| High: a contract kept a proof that never typeset a later-accepted piece | Fixed: the proof is cleared when a further change is accepted; the thread names a proof only for a piece it covers. Test: "a proof recorded before a further piece is accepted…" |
| A build could record a hash for text it did not typeset | Fixed in the assembler. Test: "a proof records the hash of the text it typeset…" |
| Rollback claimed exact bytes for a file that is not valid UTF-8 | Fixed: such a file is never overwritten ([D-009](../program/DECISIONS.md)). Tests: "a piece that is not valid UTF-8…", "a byte-order mark…" |
| A damaged current contract blocked its conversation | Fixed: an unusable pointer or contract counts as absent. Test: "unusable contract files…" |
| Contract records were trusted as read (id mismatch, missing fields) | Fixed: one validated reader. Same test |
| Every build rewrote every proved contract; a weaker build replaced a stronger proof | Fixed: a contract keeps its strongest proof. Test: "a contract keeps its strongest proof…" |
| A finished build re-rendered the thread and discarded an answer being typed | Fixed: the thread re-renders only when a proof record changed |
| An acceptance interrupted after its write became `stale` and lost its rollback | Fixed in round 1, **withdrawn in round 2** (see below). Now a recorded limit |
| Scope change during a rollback, proof note without a date, unvalidated provenance, line-ending-only proposals, a `null` request body, simulator edge cases, JSDoc errors, missing JSON Schema | Fixed; tests added where behaviour changed |

**Round 2** was run by a fresh reviewer from a self-contained brief, because
the first reviewer was stopped by a usage limit. It re-ran the round-1
reproduction scripts. Every round-1 finding was confirmed fixed, except two
interface items it found only partly fixed. It also found that one round-1
fix had introduced a new High defect.

| Finding | Disposition |
| --- | --- |
| **High, new:** the round-1 fix for interrupted acceptance recorded a change as accepted whenever the piece already held its text. Two conversations proposing the same text across a hand edit let a rollback restore text from before the hand edit, losing it | Fixed by removing that branch: a change is accepted only when its own decision wrote it. Test: "a change that did not write is never accepted…" reproduces the reviewer's scenario |
| Medium: a contract or pointer that existed but could not be read (a sync or scanner lock) was treated as missing, so a new proposal could orphan a pending contract | Fixed: only a missing or unparsable file counts as absent; other read errors fail the request and replace nothing. Test: "a contract file that exists but cannot be read…" |
| Partly fixed in round 1: a half-typed answer was still lost when acceptance triggered a proof | Fixed: answers are kept as drafts while typing |
| Partly fixed in round 1: a scope change during later steps of a rollback | Fixed: each result is applied only if its conversation is still open |
| Low: the length bound was checked before line-ending conversion, so a stored proposal could exceed it and never be accepted | Fixed; test added |
| Low: an equally strong proof under a new publication profile kept the old record | Fixed; test extended |
| Low: a lone surrogate in a proposal was not stored exactly | Fixed: such a proposal is dropped; test added |
| The line-ending test was vacuous (an LF-only piece) | Rewritten on a mixed-ending piece |
| README said every legacy change set joins the history | Corrected: only undecided ones do |

The charter budgets two review-and-fix rounds. **The round-2 fixes were
verified by tests and the browser workflow, not by a third independent
review.**

The reviewer's probes found no false refusals by the UTF-8 guard (byte-order
mark, empty file, CRLF, NUL, U+FFFD all pass; about 2.4 ms on a 468 KB file).
`isContractRecord` accepted every record the store writes. The proof ranking
matched the documentation.

## Limits

- **No real director.** Proposals came from the deterministic simulator and
  from the browser check's stub. The inference service still returns no
  changes for a Frige turn; that is Wave 4 and needs a `stex-igor` change.
- **Element scope only was exercised in the browser.** Section and book
  conversations produce contracts in the same form, and section cases are
  unit-tested, but hierarchical context and layout contracts are Wave 3.
- **Multi-piece acceptance is per piece**, as before
  ([D-005](../program/DECISIONS.md)).
- **Crash between an acceptance's write and its record.** The piece holds
  the accepted text but the contract still says pending. Deciding it again
  marks it stale, so it cannot be rolled back from the thread; the prior text
  remains in the contract's `before`. Wave 3d's recorded intent addresses
  this.
- **Crash between the two writes of a new proposal.** The contract exists in
  the history as pending but is not its conversation's current one, so it
  cannot be decided; the next proposal in that conversation supersedes it.
- **The journal has no index.** Every listing, proposal and successful build
  parses every contract file. The reviewer measured about 0.2 s to list 401
  contracts of 50 KB pieces. Acceptable for one author's book; an index is
  future work.
- **Conflicts are a snapshot** taken when a contract is proposed.
- **Stored error text** for a failed write is the system's message and can
  contain a local path. It is shown only to the local author.
- **Focus after a rollback or an acceptance** returns to the document, because
  the control that was activated is replaced. Not yet addressed.
- **Chrome only.** Safari and Firefox were not run.
- **Local machine only.** CI has not run this branch because it is not pushed.
- **Line counts are a summary**, computed as a multiset difference; the exact
  change is the stored before and after text.
- A recorded proof states that a successful build typeset the accepted text.
  It does not state that the proof on screen is current; the status bar and
  preflight report currency.
