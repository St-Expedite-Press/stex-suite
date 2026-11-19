# Integration ledger

Cross-repository state for [the program](MASTER-PLAN.md): which revisions
were tested together, which branches hold unmerged work, and what each side
must keep compatible.

## Pinned revisions

| Repository | Revision | Role |
| --- | --- | --- |
| stex-suite | `d96340e` (`feat/pantheon-platform-p1`, PR 5 head) | Program base |
| stex-igor | `d0598d8` (`main`, deployed) | Submodule pin tested with the base |
| Hermes runtime | `e76fbd80be65ea5c1b89831f8d7aaedb713f5cac` | Pinned upstream source; not modified |

## Branches

| Repository | Branch | Base | Contents | Pushed | Merge needs |
| --- | --- | --- | --- | --- | --- |
| stex-suite | `feat/frige-change-contracts` | `d96340e` | Program records; Waves 2, 3a, 3b, 3c, 3d, 3e and the suite side of 4a; two baseline defect fixes (all committed locally) | No | Owner authorization to push; PR 5 merge order |
| stex-igor | `feat/frige-scope-context` | `d0598d8` | Wave 3c adapter: `b79764f`, `a8880aa` | No | Owner authorization to push; a push to `main` deploys. The suite was tested with this branch in its working tree; its committed pointer stays at `d0598d8` |
| stex-igor | `feat/agent-config` | `a8880aa` (on `feat/frige-scope-context`) | Wave 4a the Company: `7da59e0` | No | Owner authorization to push; a push to `main` deploys. The suite's committed pointer stays at `d0598d8` |

## Compatibility requirements

| Boundary | Requirement | Verified by |
| --- | --- | --- |
| `stex.frige.publishing.v1` | Wave 2 adds routes and fields only; existing response bodies keep their meaning. Two protective refusals: a source save without `baseHash` ([D-004](DECISIONS.md)), and any write to a file that is not valid UTF-8 ([D-009](DECISIONS.md)) | `test:frige`, `verify:frige` |
| Profile overrides under `stex.frige.publishing.v1` | Additive `sections` and `nodes` in the profile and `layout` on page-map nodes; a profile without overrides keeps its hash | `test:frige` |
| `stex.frige.change-contract.v1` | New. Record schema in `protocol/frige/change-contract.v1.schema.json`; stored records are validated against it in `test:frige` | `test:frige` |
| `stex.texgraph.scope-turn.v3` | Frige reads an optional reply field `layout` and sends optional request fields `outline`, `documentSettings`, `approvedContracts` (additive; readers ignore unknown fields). The deployed gateway ignores the request fields and sends no `layout`; the local stex-igor branch forwards them and reports `meta.forwardedContext` | `test:frige`, `test:inference` |
| `stex.hermes.turn.v1` | Unchanged in Wave 2 | `test:inference` |
| Design-system copies in stex-igor | Must match the suite sources | `test:stex-igor-sync` |
| Submodule pointer | Unchanged in Wave 2 | `git submodule status` |

## Verification status

| Change | Local tests | Browser | Independent review | CI |
| --- | --- | --- | --- | --- |
| Wave 2 Frige change contracts | 187 Node tests pass; Python checks pass via `python -m` | `verify:frige` PASS (Chrome) | Two rounds; findings fixed; round-2 fixes not re-reviewed | Not pushed |
| Wave 3a layout overrides | `corepack pnpm test` passes as one command (196 Node tests) | `verify:frige` PASS (Chrome) | One round; findings fixed; not re-reviewed | Not pushed |
| Wave 3b layout change contracts | `corepack pnpm test` passes (205 Node tests) | `verify:frige` PASS (Chrome) | Two rounds; findings fixed; round-2 fixes not re-reviewed | Not pushed |
| Wave 3c hierarchical context | Suite `corepack pnpm test` passes (227 Node tests); stex-igor suite 49 pass | `verify:frige` PASS (Chrome) | One round; findings fixed; not re-reviewed | Not pushed |
| Wave 3d all-or-nothing acceptance | `corepack pnpm test` passes (215 Node tests) | `verify:frige` PASS (Chrome) | Two rounds; findings fixed; round-2 fixes not re-reviewed | Not pushed |
| Wave 3e stable section identity | `corepack pnpm test` passes (240 Node tests; 64 pytest) | `verify:frige` PASS (Chrome) | Two rounds; findings fixed; round-2 fixes not re-reviewed | Not pushed |
| Wave 4a the Company (agent configuration) | Suite 288 Node tests and 64 pytest; stex-igor Igor 40, inference 42, Hermes 12; end-to-end 12 of 12 | `verify:frige`, `verify:home` PASS; Igor smoke 41 of 41 (Chrome) | Two rounds; findings fixed; round-2 fixes not re-reviewed | Not pushed (stex-igor local) |
| Seaxneat simulator input fix | `test:seaxneat` (24) | `verify:platform` PASS (real Next build) | Not independently reviewed (small defect fix) | Not pushed |
