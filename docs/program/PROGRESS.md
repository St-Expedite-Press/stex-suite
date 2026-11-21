# Program progress

Work packages for [the master plan](MASTER-PLAN.md). Area status stays in
[`docs/STATUS.md`](../STATUS.md); this file tracks the program's own packages.

## Current wave

**Wave F — Frige product completion** (from 2026-11-20). Its first
increment adds anchored edits for long pieces and passage review. It is on
`feat/frige-f5-workstation`, with the stex-igor adapter on the local branch
`feat/anchored-edits`
([evidence](../verification/frige-wave-f-anchored-edits.md)).

**Wave 4 — Igor integration for Frige** (complete). Waves 2, 3 and the suite side of
4a are merged to suite `main` (PR 6, `51577f1`, 2026-11-19). Wave 4b (director
proposals) is implemented and reviewed. The stex-igor side of 3c, 4a and 4b,
with D-018 and D-019, was released on 2026-11-20 (`bd8b3b0`), and a live turn
after the release carried a director proposal into Frige (W4-f). The suite
records are on PR 7. Evidence:
[Wave 4b](../verification/director-proposals-w4.md),
[Wave 4a](../verification/agent-config-w4a.md),
[Wave 2](../verification/frige-change-contracts-w2.md),
[Wave 3a](../verification/frige-layout-overrides-w3a.md),
[Wave 3b](../verification/frige-layout-contracts-w3b.md),
[Wave 3c](../verification/frige-hierarchical-context-w3c.md),
[Wave 3d](../verification/frige-atomic-acceptance-w3d.md),
[Wave 3e](../verification/frige-section-identity-w3e.md). Wave 3 is complete.

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
| W3-c | Hierarchical context with categories (with the stex-igor adapter) | 3 | Done; one review round, findings fixed | [Wave 3c report](../verification/frige-hierarchical-context-w3c.md) |
| W3-d | All-or-nothing application across pieces, with crash recovery | 3 | Done; two review rounds, findings fixed | [Wave 3d report](../verification/frige-atomic-acceptance-w3d.md) |
| W3-e | Stable section identity | 3 | Done; two review rounds, findings fixed; round-2 fixes verified by tests only | [Wave 3e report](../verification/frige-section-identity-w3e.md) |
| W4a-0 | Agent configuration contract and spec (`stex.hermes.agent-config.v1`) | 4a | Done | [Protocol](../../protocol/hermes/README.md#agent-configuration-v1), [spec](MASTER-PLAN.md#wave-4a-specification--the-company-agent-configuration) |
| W4a-1 | Inference service: configuration store, catalog, history, per-request models; Hermes side models pinned to Grok | 4a | Done; two review rounds, findings fixed; round-2 fixes verified by tests only | [Wave 4a report](../verification/agent-config-w4a.md) |
| W4a-2 | Igor: "The Company" screen and relay routes | 4a | Done (same reviews) | [Wave 4a report](../verification/agent-config-w4a.md) |
| W4a-3 | Suite entry points: Pantheon shell link, `/igor/team` route, Frige menu, Seaxneat control | 4a | Done (same reviews) | [Wave 4a report](../verification/agent-config-w4a.md) |
| W4a-4 | Charter rules for agent configuration | 4a | Done in both root charters and the Igor, inference, Frige and Pantheon charters | `AGENTS.md` files |
| W4-0 | Wave 4 specification and the proposal channel ([D-017](DECISIONS.md)) | 4 | Done; open to owner review | [Master plan](MASTER-PLAN.md#wave-4-specification--proposals-from-a-real-director) |
| W4-b | Director proposals: trusted instructions, proposal reading, requested model recorded | 4 | Done; two review rounds, findings fixed; round-2 fixes verified by tests only | [Wave 4b report](../verification/director-proposals-w4.md) |
| W4-d | Director turn time budget raised to 120 s ([D-018](DECISIONS.md)) | 4 | Done; tests pin both values | stex-igor `79d7f04`; [evidence](../verification/director-proposals-w4.md) |
| W4-e | Abandoned turns stop (streaming), request-id replay, per-product turn limits ([D-019](DECISIONS.md)) | 4 | Done; one review round, findings fixed | stex-igor `9972d2a`; [evidence](../verification/director-proposals-w4.md) |
| W4-f | Release stex-igor `bd8b3b0` (Waves 3c, 4a, 4b, D-018, D-019, the skill procedure), apply the Hermes profile, and a second live turn | 4 | Done: deployed and healthy; the live turn streamed in 29 s and its proposal was accepted byte-exact in Frige (14 of 14), about $0.03 | [Release](../verification/director-proposals-w4.md#release-2026-11-20), [live turn](../verification/director-proposals-w4.md#second-live-turn-w4-f) |
| W4-c | A live director proposal against hosted Hermes | 4 | Done by W4-f. First attempt: one paid turn (about $0.02 of a $1 ceiling) through the production gateway. Grok followed the format and copied every unchanged line; the turn took 32 s, so the 30-second budget discarded it. The captured reply passes end to end by replay | [Live turn](../verification/director-proposals-w4.md#live-turn-w4-c) |
| WF-0 | Wave F (Frige product completion) defined; numbering reconciled with Waves 5–7 ([D-020](DECISIONS.md)) | F | Done; open to owner review | [Master plan](MASTER-PLAN.md#waves) |
| WF-1 | Anchored edits for long pieces (F-B1, F-B2), adapter on stex-igor `feat/anchored-edits` (F-B5), passage review in the workstation (F-A3, part) | F | Implemented and tested; one independent review round, all findings fixed (verified by tests, not re-reviewed) | [Wave F report](../verification/frige-wave-f-anchored-edits.md) |
| D-13 | Baseline debt 13: `corepack pnpm test` blocked locally by Application Control | — | Done: mypy and pytest run as Python modules; the full suite now passes as one command | `corepack pnpm test` exit 0 |
| D-09 | Baseline debt 9: Seaxneat simulator input handling | — | Done: replacement patterns literal, braces stripped; regression test; `verify:platform` PASS | `test:seaxneat` (24) |

## Blocked or waiting

| Item | Waiting on |
| --- | --- |
| Any change to `stex-igor` reaching `main` | Owner authorization for a named release |
| A live proposal that reaches Frige | A second approved paid turn, now that a director turn has 120 seconds ([D-018](DECISIONS.md)) |
| Wider output budget for long pieces | Owner decision (20,000 output characters today) |

## Next actions

1. Owner: review the Company screen's wording, and decide whether to release
   the stex-igor branches (3c, 4a, 4b; a push to its `main` deploys).
2. Owner: approve one more paid turn to see a live proposal reach Frige,
   now that a director turn has 120 seconds (D-018).
3. Then: bounded specialist investigation (Wave 4), which needs a parked
   profile activated and is the owner's decision.
