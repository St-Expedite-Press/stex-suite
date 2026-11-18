# Program progress

Work packages for [the master plan](MASTER-PLAN.md). Area status stays in
[`docs/STATUS.md`](../STATUS.md); this file tracks the program's own packages.

## Current wave

**Wave 3 — section and book intelligence.** Waves 2, 3a and 3b are implemented,
reviewed and committed on the local branch `feat/frige-change-contracts`.
Evidence: [Wave 2](../verification/frige-change-contracts-w2.md),
[Wave 3a](../verification/frige-layout-overrides-w3a.md),
[Wave 3b](../verification/frige-layout-contracts-w3b.md).

## Work packages

| ID | Package | Wave | State | Evidence |
| --- | --- | --- | --- | --- |
| W0-1 | Two-repository audit and test baseline | 0 | Done | [Baseline](../verification/program-baseline-2026-11-13.md) |
| W0-2 | Coordination record | 0 | Done | This directory |
| W1-1 | Change-contract protocol (`stex.frige.change-contract.v1`) and JSON Schema | 1 | Done | [`protocol/frige`](../../protocol/frige/README.md#change-contracts-v1) |
| W2-1 | Engine: contract record, journal, supersede, rollback, proof link, required base hash, UTF-8 guard | 2 | Done | `test:frige` (83) |
| W2-2 | Simulator proposal in fake mode | 2 | Done | `inference-client.test.mjs` |
| W2-3 | Workstation: contract terms on a proposal, roll back beside an accepted change | 2 | Done | `verify:frige` |
| W2-4 | Browser acceptance: accept, proof, rollback, reject in `verify:frige` | 2 | Done | `verify:frige` PASS |
| W2-5 | Independent review | 2 | Two rounds done (the charter budget); all confirmed findings fixed; round-2 fixes verified by tests only | [Review section](../verification/frige-change-contracts-w2.md#independent-review) |
| W2-6 | Local commit of Wave 2 | 2 | Done | `git log` on the branch |
| W3-0 | Wave 3 specification | 3 | Drafted; open to owner review | [Master plan](MASTER-PLAN.md#wave-3-specification) |
| W3-a | Typed layout overrides (book → section → element) | 3 | Done; one review round, findings fixed | [Wave 3a report](../verification/frige-layout-overrides-w3a.md) |
| W3-b | Layout change contracts | 3 | Done; two review rounds, findings fixed | [Wave 3b report](../verification/frige-layout-contracts-w3b.md) |
| W3-c | Hierarchical context with categories | 3 | Next | — |
| W3-d | All-or-nothing application across pieces | 3 | Planned | — |
| W3-e | Stable section identity | 3 | Planned | — |
| D-13 | Baseline debt 13: `corepack pnpm test` blocked locally by Application Control | — | Done: mypy and pytest run as Python modules; the full suite now passes as one command | `corepack pnpm test` exit 0 |
| D-09 | Baseline debt 9: Seaxneat simulator input handling | — | Done: replacement patterns literal, braces stripped; regression test; `verify:platform` PASS | `test:seaxneat` (24) |

## Blocked or waiting

| Item | Waiting on |
| --- | --- |
| Any change to `stex-igor` reaching `main` | Owner authorization for a named release |
| Proposals from a real director (Wave 4) | A local `stex-igor` branch first; live verification needs authorization for paid calls |
| Suite PR 5 merge | Owner |
| Pushing `feat/frige-change-contracts` | Owner authorization |

## Next actions

1. Owner: review the Wave 3 specification and the open decisions in the
   [handoff](HANDOFF.md#decisions-waiting-on-the-owner).
2. Wave 3c: hierarchical context with categories.
3. Then Waves 3d–3e: all-or-nothing application, stable section identity.
