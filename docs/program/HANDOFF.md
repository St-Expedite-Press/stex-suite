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
  `d96340e`. Local only; nothing is pushed. Waves 2, 3a, 3b, 3c, 3d and
  3e and two baseline defect fixes are committed locally on top of `d96340e`.
- **stex-igor:** local branch `feat/frige-scope-context` from `d0598d8`, at
  `a8880aa`, with the Wave 3c adapter change ([D-014](DECISIONS.md)). The
  suite's submodule pointer stays at `d0598d8`: never stage `stex-igor` in a
  suite commit while the branch is unpushed. Local only: a push to
  stex-igor `main` deploys, and pushing needs the owner's approval.
- **Current work:** Wave 3 is complete; Wave 4 (proposals from a real
  director) is next. Its live verification needs the owner's approval of a
  paid call and a budget. See [progress](PROGRESS.md) for package states and the
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
| Release the `stex-igor` branch (local branch authorized 2026-11-17, D-014) | Decide after Waves 3c and 4 are reviewed locally | A push to `main` deploys to production |
| Runtime model for the director (no Claude models; xAI through OpenRouter preferred) | Decide after a catalog check, which is a paid-adjacent lookup | Wave 4 needs tool-capable, structured-output models |
