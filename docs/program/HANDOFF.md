# Handoff

What a new session needs to resume [the program](MASTER-PLAN.md) safely.
Update this file whenever the state below changes.

## Read first

1. [`AGENTS.md`](../../AGENTS.md) and the nested charter for any path you
   touch — [`apps/frige/AGENTS.md`](../../apps/frige/AGENTS.md) for Wave 2.
2. [The baseline](../verification/program-baseline-2026-11-13.md).
3. [Decisions](DECISIONS.md), [progress](PROGRESS.md), [risks](RISKS.md) and
   the [integration ledger](INTEGRATION-LEDGER.md).

## State

- **Branch:** `feat/frige-change-contracts` in `stex-suite`, cut from
  `d96340e`. Local only; nothing is pushed. Waves 2, 3a and 3b and two
  baseline defect fixes are committed locally on top of `d96340e`.
- **stex-igor:** untouched, at `d0598d8`.
- **Current work:** Wave 3c (hierarchical context). See [progress](PROGRESS.md) for package states and the
  [Wave 2 report](../verification/frige-change-contracts-w2.md) for evidence.
- **If a review is interrupted** (usage limits have stopped agents twice),
  rerun it from a self-contained brief. The round-1 reproduction scripts
  were kept outside the repository in the session scratchpad and may be gone.

## Rules that are easy to break

- **Never run `git add -A` or `git add .` in this repository.**
  `apps/texgraph/` is untracked, not ignored, and holds author files. Stage
  named paths only, and never clean or move that folder.
- **Never push `stex-igor` `main`.** It deploys to production.
- **Never open or alter `apps/frige/books/*/manuscript/`.** Use synthetic
  fixtures in temporary directories.
- **No paid provider calls, deployments or credential changes** without the
  owner's approval for that named action.
- **The Press website is out of scope** ([D-001](DECISIONS.md)).
- **Code standards:** [D-002](DECISIONS.md) applies to everything written.

## Commands

```powershell
corepack pnpm run test:frige          # Frige engine suite, with real LuaLaTeX proofs
corepack pnpm run test:pantheon       # Pantheon, including the Frige workstation routes
corepack pnpm run verify:frige        # Chrome workflow against a synthetic book
corepack pnpm test                    # every suite
```

`test:platform` runs mypy and pytest as Python modules (`python -m`), because
Windows Application Control on the owner's machine blocks their launchers in
`.venv`. Keep that form.

## Decisions waiting on the owner

| Decision | Recommended default | Why it matters |
| --- | --- | --- |
| Renew the hosted provider credential | Renew before the date in the private D1 report | Hosted Igor stops answering when it lapses |
| Where the untracked author files under `apps/texgraph/` belong | Move them out of this public working tree, or add the folder to `.gitignore` | One unqualified `git add` would publish them |
| Merge order for suite PR 5 and this branch | Merge PR 5 first, then rebase this branch | This branch is cut from the PR 5 head |
| Base hash required on source saves ([D-004](DECISIONS.md)) | Keep | Closes a gap in the stale-write guard |
| Never overwrite a file that is not valid UTF-8 ([D-009](DECISIONS.md)) | Keep | Such a file's bytes were destroyed on the first write, beyond rollback |
| Push `feat/frige-change-contracts` so CI runs it | Push after review round 2 and the local commit | CI has not run this work |
| Authorize a `stex-igor` branch for Wave 4 and, later, its release | Authorize the local branch now; the release separately | Real proposals need the inference adapter to change |
| Runtime model for the director (no Claude models; xAI through OpenRouter preferred) | Decide after a catalog check, which is a paid-adjacent lookup | Wave 4 needs tool-capable, structured-output models |
