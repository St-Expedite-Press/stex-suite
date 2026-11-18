# Frige all-or-nothing acceptance — Wave 3d evidence

**Objective:** accepting several pieces of one change contract either writes
all of them or none, and an acceptance interrupted by a stop is undone when
the engine next starts, as specified in
[the master plan](../program/MASTER-PLAN.md#3d--all-or-nothing-application-across-pieces).
This closes the crash-window limit recorded for
[Wave 2](frige-change-contracts-w2.md#limits).

**Status:** implemented and tested locally; two independent review rounds,
confirmed findings fixed (round-2 fixes verified by tests, not re-reviewed). Not pushed, not merged, not deployed.

| Item | Value |
| --- | --- |
| Branch | `feat/frige-change-contracts` (local), on top of `4e55409` |
| stex-igor | `d0598d8`, unchanged |
| Date | 2026-11-17 |
| Environment | Windows 11, Node 24.18, LuaHBTeX 1.24 (MiKTeX), Chrome |
| Data | Synthetic books in temporary directories only |

## What changed

| Path | Change |
| --- | --- |
| `apps/frige/src/project-store-vault.mjs` | `#acceptText`: check every piece first, record an `applying` intent, write, restore on failure; `#recoverInterrupted`, run once per store from `initialize` |
| `protocol/frige/change-contract.v1.schema.json` | Optional `applying` record |
| `protocol/frige/README.md` | Acceptance and recovery rules |
| `apps/frige/test/` | Three new tests; the Wave 2 test of mixed per-piece results updated to the new rule |

Behaviour change: accepting several pieces together no longer ends partly
accepted and partly stale. If one piece changed since the proposal, it is
marked stale, nothing is written, and the others stay pending to decide
again ([D-005](../program/DECISIONS.md) is superseded). Accepting one piece
at a time is unchanged.

## Acceptance criteria and evidence

| Criterion | Evidence |
| --- | --- |
| Every piece is checked before any is written | `project-store-vault.test.mjs`: "a change set keeps only changes to offered nodes…" (one edited piece: neither written, the other still pending and acceptable alone) |
| A failure on the second of three pieces leaves all three unchanged | "accepting three pieces with a failure on the second leaves all three unchanged"; "a failed write part-way through accepting several pieces restores the pieces already written" |
| A write that reaches the file and then reports an error is still restored | "a write that reaches the file and then throws is still restored…" |
| A failed contract save never leaves `applying` behind | "a failure to save the contract during acceptance never leaves `applying` on disk" (a later legitimate write survives a restart) |
| A simulated stop mid-apply is recovered on restart | "an acceptance interrupted by a stop is undone when the store next starts"; "an interrupted acceptance whose piece was never written…"; "recovery leaves alone a piece edited after the stop…" |
| Records conform to the schema in every state, `applying` included | Schema assertions in the tests above |

## Commands and results

Run on 2026-11-17 after the round-2 fixes.

| Command | Result |
| --- | --- |
| `corepack pnpm run test:frige` | 110 pass (100 before 3d) |
| `corepack pnpm test` | Passes as one command (exit 0): 215 Node tests across nine suites, Ruff, mypy, 64 pytest, stex-igor sync |
| `corepack pnpm run build:pantheon` | Built |
| `corepack pnpm run verify:frige` | PASS |
| `git diff --check` | Clean |

## Independent review

**Round 1**, by a separate reviewer agent with reproduction scripts. It
confirmed that no path writes without the base-hash check, that the lock
prevents a supersede mid-acceptance, that recovery handles contracts that
are not current, missing scopes, damaged files and non-pending changes, and
it walked a stop at every await point of the acceptance. The new tests were
not vacuous.

| Finding | Disposition |
| --- | --- |
| **High:** a write can reach the file and then throw (in the graph refresh after it), so the piece kept the AI text while its contract said "not applied", and nothing would ever undo it | Fixed: restoration and every status are decided from what each piece holds on disk, not from whether a write threw. Test: "a write that reaches the file and then throws…" |
| **High:** if the contract save itself failed, `applying` could be saved and left behind, so a restart later "recovered" by overwriting a legitimate write | Fixed: `applying` is removed before any failure propagates and kept only when a piece's state could not be read. Test: "a failure to save the contract during acceptance never leaves `applying` on disk" |
| Medium: a piece actually restored could be recorded as accepted | Fixed by the same change |
| Low: recovery's "was not changed" could be false | Reworded: "does not hold the proposed text, so it was left as it is" |
| Also adopted | A transient read error in the first check is reported, not mistaken for a changed piece; a failed recovery is retried rather than cached; recovery falls back to every pending text change when its list is unusable; the plan's three-piece criterion restored and tested; tests for a hand edit after the stop and for schema conformance with `applying` |

**Round 2**, by the same reviewer with a second script. All three round-1
findings were confirmed fixed. It found two new defects in the fixes:

| Finding | Disposition |
| --- | --- |
| **High, new:** when a piece could not be read during an acceptance, `applying` correctly stayed for recovery, but accepting again or a newer proposal before the next start marked the piece stale or superseded it, so recovery skipped it and the AI text became permanent | Fixed: a contract carrying `applying` is settled first, under the lock, before any decision, rollback or newer proposal acts on it. Tests: "a half-applied acceptance is settled before a later decision…", "…before a newer proposal supersedes it, and before a rollback" |
| **High, new:** recovery still treated a read error as "the piece does not hold the proposed text" and left the AI text in place | Fixed: recovery reads strictly; an unreadable piece makes it fail, settling nothing, and it is retried on the next use. Test: "recovery that cannot read a piece fails and is retried…" |
| Low: the intent save could fail after writing the contract file, leaving `applying` on disk | Mitigated: a failed intent save tries once more to save the record without it |
| Low: "not found" was detected by message text | Fixed: the error carries the code `NODE_NOT_FOUND` |
| Docs: the `applying` rules did not say it is settled before later operations | Corrected in the protocol and schema |

The reviewer confirmed that restoring every piece holding the proposed text
is safe, since the first check proved each held its base text under the lock.
It also confirmed that a read error in the first check now fails the decision
instead of recording a false "stale". **The charter's two review rounds are
used; the round-2 fixes are verified by tests and the browser workflow, not
re-reviewed.**

## Limits

- **Recovery restores; it never completes.** An interrupted acceptance is
  undone and recorded as failed, so the author accepts again.
- **Recovery runs when a store is first used after a start**, not
  continuously.
- **A stop during restoration itself** (after a failed write) leaves
  `applying` in place, so it is settled the same way; this path is reasoned,
  not tested.
- **An outside process writing exactly the proposed text** while an
  acceptance is in progress would be restored by recovery. Negligible, and
  recorded rather than handled.
- **Layout contracts hold one change**, so they need no intent record.
