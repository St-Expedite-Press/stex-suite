# Frige layout change contracts — Wave 3b evidence

**Objective:** a section's or a piece's conversation can propose a change to
that scope's own layout settings as a change contract, which the author
accepts or rejects and can roll back, as specified in
[the master plan](../program/MASTER-PLAN.md#3b--layout-change-contracts).

**Status:** implemented and tested locally; two independent review rounds,
confirmed findings fixed. Not pushed, not merged, not deployed.

| Item | Value |
| --- | --- |
| Branch | `feat/frige-change-contracts` (local), on top of `c75a87b` |
| stex-igor | `d0598d8`, unchanged |
| Date | 2026-11-17 |
| Environment | Windows 11, Node 24.18, LuaHBTeX 1.24 (MiKTeX), Chrome |
| Inference | Deterministic simulator and a local HTTP stub. No provider call |
| Data | Synthetic books in temporary directories only |

## What changed

| Path | Change |
| --- | --- |
| `apps/frige/src/change-contract.mjs` | `set-layout` change kind; record validation per kind; conflicts keyed on the changed target; proof of a layout change by profile hash; summaries per kind |
| `apps/frige/src/project-store-vault.mjs` | Builds a layout change for the conversation's own section or piece; accepts and rolls it back only against the expected profile hash, under the store lock; one kind of change per contract |
| `apps/frige/src/inference-client.mjs` | `Simulate layout: …` in the simulator; the optional `layout` reply field read from a gateway |
| `apps/frige/server.mjs` | Passes a proposed layout change to the store |
| `apps/pantheon/workspaces/frige/` | Layout card (each setting from what it follows to the proposed value), layout wording in the terms, rollback and profile refresh |
| `protocol/frige/` | Contract paragraphs and schema `oneOf` for the layout shape |
| `protocol/texgraph/README.md` | Optional reply field `layout` |
| Tests | Four store tests and simulator cases; a `verify:frige` step through the HTTP gateway path |

Contract touched: `stex.frige.change-contract.v1`, extended while still
unpublished ([D-011](../program/DECISIONS.md)); `stex.texgraph.scope-turn.v3`,
additively (an optional reply field that the STEX gateway does not yet send).

## Acceptance criteria and evidence

| Criterion | Evidence |
| --- | --- |
| A contract change may set or clear one override | "a piece conversation proposes its own layout…"; "a section conversation proposes the section override…" (including clear) |
| Acceptance writes only if the profile hash still equals the base | "a layout change is refused, never applied, against a profile that changed…" |
| Rollback restores `before` only if the hash still equals the after hash | Same test, and the round trip in the first test restores the exact profile and its hash |
| The author sees what an override replaces | `inherited` asserted in the first test; the card shows "as its section (13pt / 13.6pt) → 14pt / 17pt" in `verify:frige` (`layout-proposal.png`) |
| The simulator proposes layout | Simulator cases in `inference-client.test.mjs` |
| Shown and usable in the workstation | `verify:frige`: proposed in conversation through the HTTP gateway path, accepted into the profile, proved by a real LuaLaTeX proof, rolled back |
| Invalid or impossible proposals are set aside with a reason | "layout proposals that cannot be a contract…" (book scope, invalid values, book-only keys, no-op, mixed with text) |

## Commands and results

| Command | Result |
| --- | --- |
| `corepack pnpm run test:frige` | 100 pass |
| `corepack pnpm test` | Passes as one command (exit 0): 205 Node tests across nine suites, Ruff, mypy, 64 pytest, stex-igor sync. Run after the round-2 fixes |
| `corepack pnpm run test:pantheon` | 19 pass |
| `corepack pnpm run build:pantheon` | Built |
| `corepack pnpm run verify:frige` | PASS after the round-2 fixes, including the layout contract step and five widths |
| `git diff --check` | Clean |

## Independent review

**Round 1**, by a separate reviewer agent with a reproduction script on
temporary fixtures. It confirmed that every profile write runs under the
store lock, that stale acceptance and stale rollback write nothing, that
rollback restores the exact base profile, and that no normalization path
lets a stale change through or blocks a rollback forever.

| Finding | Disposition |
| --- | --- |
| **High:** a layout contract was "proved" by a build of unrelated pieces under the same profile, so the thread could claim a proof that never typeset the target. The store test passed only because it did the same | Fixed: a layout change records its `pieces`, and a proof must typeset all of them. Tests: the first layout test now asserts the empty build proves nothing; "a section layout change is proved only by a build of all its pieces…" |
| Medium: an unbounded gateway `layout.set` produced a 2.3-million-character reason stored in the conversation | Fixed: more than eight keys is malformed; stored reasons are capped at 1,000 characters. Tests in both suites |
| Medium: accepting wrote an override for a piece that had left the table of contents | Fixed: acceptance re-checks the target; the change is stale. Test in the section test |
| Medium (code reading): reloading the profile after a decision silently replaced unsaved Design-panel edits | Fixed in round 1 by keeping the edits; that fix introduced the round-2 High below, now fixed. The reload happens only after an accepted layout change, and its failure no longer hides the decision |
| Low: the card showed the wrong inherited recto value and running head | Fixed: `inherited` records the recto opening and running head the target would otherwise have; the card shows them |
| Low: the simulator claimed a change even when none was made; a no-op gave no reason | Fixed: neutral wording; a no-op is set aside with "would change nothing" |
| Low: a section's settings reach every run of its folder, undocumented in the card | The terms now say so; documented |
| Low: stale JSDoc | Fixed |
| Also adopted | Prototype keys in a proposal are refused; the gateway reader is exported and tested directly; schema conformance of stale and superseded layout records and of text contracts beside layout ones is tested; the master plan's 3b section describes what was built |

**Round 2**, by the same reviewer with a second script that used real
assembled build records. Round-1 items were confirmed fixed, except the
Design-panel item, whose fix introduced a new defect:

| Finding | Disposition |
| --- | --- |
| **High, new:** with unsaved Design-panel edits kept, saving the panel after accepting a layout change resent the old override and silently undid the accepted change, which then could never be rolled back | Fixed: a profile save carries the hash of the profile its form was filled from and is refused with `409 STALE_DESIGN` if the profile has moved on; the workstation always sends it and says so. Test: "a profile save made from an outdated form cannot undo an accepted layout change" |
| Low: a piece removed from the book after the proposal blocked the proof forever | Fixed: only pieces still in the reading order are required. Test: "a layout proof needs every affected piece still in the book…" |
| Low: a section filed in several places is not proved by its own conversation's automatic proof | Documented; a whole-book proof proves it |
| Docs: the gateway's eight-key rule drops the field with no reason; `pieces` had no minimum in the schema | Documented; `minItems: 1` added and checked |

The reviewer found no wrongful refusal by the table-of-contents check (front
matter and split folders accepted), no way for the inherited-value helper to
throw, and that every piece in a build's range, printing or not, is in its
source hashes. **The round-2 fixes were verified by tests and the browser
workflow, not re-reviewed** (the charter budgets two rounds).

## Limits

- **No real director proposes layout yet.** The gateway field exists only on
  Frige's side; the STEX gateway change is Wave 4.
- **Section and piece overrides only.** The whole book's settings are changed
  in the Design panel, not by contract.
- **One layout change per contract**, and never mixed with text changes.
- **Any profile change makes a pending layout change stale**, even a change
  to an unrelated setting, because the check is on the whole profile.
- **Chrome only**, local machine only; CI has not run this branch.
