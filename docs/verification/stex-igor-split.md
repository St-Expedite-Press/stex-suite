# stex-igor repository split (I3) — verification report

**Milestone:** I3. Everything that runs on the hosted VM gets its own
repository, is developed here as a submodule, and is deployed to the VM by a
GitHub Action. The project owner authorised it on 2026-11-06 and decided:

- the repository is named `stex-igor`;
- it holds the whole `hermes/` roster and the runtime pin;
- it deploys through a GitHub Action from the start;
- the design system reaches it as a synced copy with a drift check.

**Base revision:** `ae0aad8` (`feat/igor-hosted`).

## Scope delivered

| Item | State |
| --- | --- |
| Private repository `St-Expedite-Press/stex-igor` (initial commit `9d7ca0e`, fresh history, provenance in the commit message) | Created and pushed; 9 LFS media objects |
| Contents: Igor app, inference service, `hermes/` roster and profiles, `runtime/hermes-agent` pin at `e76fbd80`, `vendor/design-system` copy, masthead media copy | Moved |
| `deploy/`: self-contained release build, VM install script with health check and automatic rollback, systemd units, env templates, the Igor profile as a script | Implemented |
| CI workflow (install, tests, typecheck, build) and deploy workflow (Workload Identity Federation → IAP → install) | CI passes on GitHub. Deploy is skipped until the repository variables exist |
| stex-suite: moved directories removed; `stex-igor/` submodule; workspace, scripts, `dev-alpha`, verifiers, manifest, and docs repointed | Done |
| `scripts/sync-stex-igor.mjs` (`sync:stex-igor`, `test:stex-igor-sync`) | Implemented; part of `corepack pnpm test` |

## Evidence

| Check | Result |
| --- | --- |
| stex-igor standalone: `pnpm install --frozen-lockfile`, `pnpm test` | Igor 10, inference 21, Hermes 7, design system 8 tests pass |
| stex-igor typecheck and build | Pass, locally and on GitHub Actions (run `42256165600`) |
| Release tarball unpacked and started with **no package install** | Igor `/igor/` 200; hexagram emblem 200; masthead loop 1,342,195 bytes 200; health ok. Inference started |
| stex-suite `corepack pnpm test` | 117 tests across 9 suites pass, plus the drift check |
| Drift check, negative case | Appending to the copy's `tokens.css` fails the check and names the file; restored |
| `verify:igor`, `verify:home` from the submodule layout | Pass |
| Suite link check | No new broken links. The protected manuscript's existing links were not touched |

## Limitations

- **No automated deploy has run yet.** It needs the owner to create Workload
  Identity Federation and a deploy service account (commands in the
  stex-igor runbook), then set two repository variables.
- **The VM still runs release `083532f`** in the old directory layout. The
  first automated deploy migrates it: new unit files, and a stale
  `STEX_IGOR_DIST_DIR` line removed from `/etc/stex/igor.env`.
