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
| stex-suite | `feat/frige-change-contracts` | `d96340e` | Program records; Wave 2 Frige change contracts (committed locally) | No | Owner authorization to push; PR 5 merge order |
| stex-igor | — | — | No program change yet | — | — |

## Compatibility requirements

| Boundary | Requirement | Verified by |
| --- | --- | --- |
| `stex.frige.publishing.v1` | Wave 2 adds routes and fields only; existing response bodies keep their meaning. Two protective refusals: a source save without `baseHash` ([D-004](DECISIONS.md)), and any write to a file that is not valid UTF-8 ([D-009](DECISIONS.md)) | `test:frige`, `verify:frige` |
| `stex.frige.change-contract.v1` | New. Record schema in `protocol/frige/change-contract.v1.schema.json`; stored records are validated against it in `test:frige` | `test:frige` |
| `stex.texgraph.scope-turn.v3` | Unchanged. Frige still accepts `changes: []` from the deployed adapter | `test:frige`, `test:inference` |
| `stex.hermes.turn.v1` | Unchanged in Wave 2 | `test:inference` |
| Design-system copies in stex-igor | Must match the suite sources | `test:stex-igor-sync` |
| Submodule pointer | Unchanged in Wave 2 | `git submodule status` |

## Verification status

| Change | Local tests | Browser | Independent review | CI |
| --- | --- | --- | --- | --- |
| Wave 2 Frige change contracts | 187 Node tests pass; Python checks pass via `python -m` | `verify:frige` PASS (Chrome) | Two rounds; findings fixed; round-2 fixes not re-reviewed | Not pushed |
