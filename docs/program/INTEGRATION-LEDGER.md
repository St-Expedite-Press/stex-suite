# Integration ledger

Cross-repository state for [the program](MASTER-PLAN.md): which revisions
were tested together, which branches hold unmerged work, and what each side
must keep compatible.

## Pinned revisions

| Repository | Revision | Role |
| --- | --- | --- |
| stex-suite | `44cd3ac` (`main`, after PR 8) | Current base; the program started from `d96340e` (PR 5 head) |
| stex-igor | `c5af494` (`main`, deployed 2026-11-21 as generation 14) | Submodule pin on suite `main` since PR 8; `bd8b3b0` was the pin before |
| Hermes runtime | `e76fbd80be65ea5c1b89831f8d7aaedb713f5cac` | Pinned upstream source; not modified |

## Branches

| Repository | Branch | Base | Contents | Pushed | Merge needs |
| --- | --- | --- | --- | --- | --- |
| stex-suite | `feat/frige-change-contracts` | `d96340e` | Program records; Waves 2, 3a, 3b, 3c, 3d, 3e and the suite side of 4a; two baseline defect fixes | Yes | Merged to `main` by PR 6 as `51577f1`, 2026-11-19 (CI green) |
| stex-igor | `feat/frige-scope-context` | `d0598d8` | Wave 3c adapter: `b79764f`, `a8880aa` | No (contained in `feat/director-proposals`) | Released in `bd8b3b0` |
| stex-suite | `feat/director-proposals` | `51577f1` (`main`) | Wave 4b records, protocol note and Frige comments; Frige's page-turn wait (D-018); D-019 records, `.env.example` and developer guide | Yes (2026-11-20) | PR 7; pins stex-igor `bd8b3b0`; merging deploys nothing |
| stex-igor | `feat/director-proposals` | `d0598d8` (`main`), carrying 3c and 4a | Waves 3c, 4a and 4b, D-018 (`79d7f04`), D-019 (`9972d2a`) and a CI test fix (`f57d610`) | Yes (2026-11-20) | Released: PR 2 merged by fast-forward to `bd8b3b0` and deployed, 2026-11-20; operator steps done |
| stex-igor | `feat/agent-config` | `a8880aa` (on `feat/frige-scope-context`) | Wave 4a the Company: `7da59e0` | No (contained in `feat/director-proposals`) | Released in `bd8b3b0` |
| stex-suite | `feat/frige-f5-workstation` | `06c5f13` (`origin/main`, after PR 7) | Wave F first increment: anchored edits, passage review, review fixes, records | Yes | Merged to `main` by PR 8 as `44cd3ac`, 2026-11-21 (CI green); pins stex-igor `c5af494` |
| stex-igor | `feat/anchored-edits` | `bd8b3b0` (`main`) | Scope-turn adapter reads `edits`; teaches them only to a Frige that advertises `proposalForms` | Yes | Released: PR 4 fast-forwarded to `c5af494` with the owner's authorization, 2026-11-21; installed and health-checked, read-back step failed on SSH |
| stex-suite | `feat/frige-ui-passages` | `af94e24` (`main`) | Interface increment 1: navigation, deep links, exact passage selection (D-021) | No | Review; pins stex-igor `c5af494` (unchanged), so merging deploys nothing |
| stex-igor | `feat/frige-passages` | `c5af494` (`main`) | Adapter forwards a selected passage and adds its rule | No | A push to `main` deploys: owner authorization |
| stex-igor | `feat/free-mode` | `1e2556a` (`feat/frige-passages`) | Igor free mode, catalog `free` and `description`, Company screen prices and descriptions (D-022); contains `feat/frige-passages` | No | A push to `main` deploys: owner authorization. Releasing it releases the passage adapter too |
| stex-igor | `feat/skill-animate-still` | `d0598d8` (`main`) | Visual-production procedure for animating and scoring a still artwork (procedure only; grants nothing): `430b6e5` | Yes (2026-11-20) | Released: merged into the release branch and deployed in `bd8b3b0` (PR 3 merged) |

## Compatibility requirements

| Boundary | Requirement | Verified by |
| --- | --- | --- |
| `stex.frige.publishing.v1` | Wave 2 adds routes and fields only; existing response bodies keep their meaning. Two protective refusals: a source save without `baseHash` ([D-004](DECISIONS.md)), and any write to a file that is not valid UTF-8 ([D-009](DECISIONS.md)) | `test:frige`, `verify:frige` |
| Profile overrides under `stex.frige.publishing.v1` | Additive `sections` and `nodes` in the profile and `layout` on page-map nodes; a profile without overrides keeps its hash | `test:frige` |
| `stex.frige.change-contract.v1` | New. Record schema in `protocol/frige/change-contract.v1.schema.json`; stored records are validated against it in `test:frige` | `test:frige` |
| `stex.texgraph.scope-turn.v3` | Frige reads an optional reply field `layout` and sends optional request fields `outline`, `documentSettings`, `approvedContracts` (additive; readers ignore unknown fields). The deployed gateway ignores the request fields and sends no `layout`; the local stex-igor branch forwards them and reports `meta.forwardedContext` | `test:frige`, `test:inference` |
| `stex.hermes.turn.v1` | Unchanged in Wave 2 | `test:inference` |
| `stex.hermes.agent-config.v1` `freeMode`, catalog `free` and `description` (D-022) | Additive. Igor's relay passes them through; Pantheon and Frige do not read them. A Company screen from before D-022 never sends `freeMode`, so free mode stays off; a new screen against an old service sees no `freeMode` and shows no free-mode row | `test:inference`, `test:igor` |
| Scope turn v3 request `selection` and `meta.forwardedContext.selection` (D-021) | Additive. The released gateway (`c5af494`) drops `selection`; Frige still bounds the proposal and marks the passage unconfirmed. Old Frige never sends it. Either release order is safe | `test:frige`, `test:inference`, end-to-end script |
| Scope turn v3 `changes[].edits` and request `proposalForms` (D-020) | Additive fields. The gateway teaches and sends edits only to a Frige that sends `proposalForms` with `edits`. An older Frige gets the released whole-piece instructions unchanged, and stray edits are set aside with a notice. Either release order is safe | `test:frige`, `test:inference` (instructions compared with `bd8b3b0`'s), end-to-end script |
| Design-system copies in stex-igor | Must match the suite sources | `test:stex-igor-sync` |
| Submodule pointer | Unchanged in Wave 2; moved to the released `bd8b3b0` with Wave 4b | `git submodule status`, `test:stex-igor-sync` |

## Verification status

| Change | Local tests | Browser | Independent review | CI |
| --- | --- | --- | --- | --- |
| Wave 2 Frige change contracts | 187 Node tests pass; Python checks pass via `python -m` | `verify:frige` PASS (Chrome) | Two rounds; findings fixed; round-2 fixes not re-reviewed | Merged (PR 6) |
| Wave 3a layout overrides | `corepack pnpm test` passes as one command (196 Node tests) | `verify:frige` PASS (Chrome) | One round; findings fixed; not re-reviewed | Merged (PR 6) |
| Wave 3b layout change contracts | `corepack pnpm test` passes (205 Node tests) | `verify:frige` PASS (Chrome) | Two rounds; findings fixed; round-2 fixes not re-reviewed | Merged (PR 6) |
| Wave 3c hierarchical context | Suite `corepack pnpm test` passes (227 Node tests); stex-igor suite 49 pass | `verify:frige` PASS (Chrome) | One round; findings fixed; not re-reviewed | Merged (PR 6) |
| Wave 3d all-or-nothing acceptance | `corepack pnpm test` passes (215 Node tests) | `verify:frige` PASS (Chrome) | Two rounds; findings fixed; round-2 fixes not re-reviewed | Merged (PR 6) |
| Wave 3e stable section identity | `corepack pnpm test` passes (240 Node tests; 64 pytest) | `verify:frige` PASS (Chrome) | Two rounds; findings fixed; round-2 fixes not re-reviewed | Merged (PR 6) |
| Wave 4a the Company (agent configuration) | Suite 288 Node tests and 64 pytest; stex-igor Igor 40, inference 42, Hermes 12; end-to-end 12 of 12 | `verify:frige`, `verify:home` PASS; Igor smoke 41 of 41 (Chrome) | Two rounds; findings fixed; round-2 fixes not re-reviewed | Suite side merged (PR 6); stex-igor released (`bd8b3b0`) |
| Wave 4b director proposals | stex-igor Igor 40, inference 52, Hermes 12, design system 8; end-to-end 13 of 13 (stub Hermes → inference → Frige); first live turn: format and exact copying proved, 30-second budget exceeded; second live turn after the release: 14 of 14, proposal accepted in Frige | Not needed: no interface change | Two rounds; findings fixed; round-2 fixes not re-reviewed | stex-igor released (`bd8b3b0`, CI and deploy green); suite PR 7 |
| Seaxneat simulator input fix | `test:seaxneat` (24) | `verify:platform` PASS (real Next build) | Not independently reviewed (small defect fix) | Merged (PR 6) |
