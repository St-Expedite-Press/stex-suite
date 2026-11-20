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

- **Suite:** Waves 2, 3a–3e, the suite side of 4a and two baseline fixes are
  merged to `main` by PR 6 (`51577f1`, 2026-11-19, CI green). Wave 4b's
  records, protocol note and Frige comments are on the local branch
  `feat/director-proposals`, cut from `51577f1`.
- **stex-igor:** `main` is still `d0598d8`, the deployed release. Three local
  branches are stacked on it, none pushed:
  - `feat/frige-scope-context`: Wave 3c ([D-014](DECISIONS.md));
  - `feat/agent-config`: Wave 4a, the Company;
  - `feat/director-proposals`: Wave 4b.

  The suite's submodule pointer stays at `d0598d8`. Never stage `stex-igor` in
  a suite commit while these branches are unpushed. A push to stex-igor
  `main` deploys, and pushing needs the owner's approval.
- **Until stex-igor is released:** the suite's Company links reach Igor's
  conversation list instead of the Company screen. Hosted Igor still runs
  `openai/gpt-4.1-mini`; the Grok stack applies after the release, once the
  operator reruns `apply-igor-profile.sh` and restarts Hermes. The director
  cannot propose Frige changes until then.
- **Current work:** Wave 4b is complete
  ([evidence](../verification/director-proposals-w4.md)). The one approved
  live turn (2026-11-20) proved the format with Grok but ran 2 seconds past
  the 30-second turn budget. Next: the owner's decision on that budget, a
  second paid turn, then bounded specialist investigation (needs a parked
  profile activated).
- **A visual-production skill procedure** (animating and scoring a still
  artwork) found uncommitted in stex-igor was reviewed and committed on its
  own local branch, `feat/skill-animate-still`, from `main`.
- **If a review is interrupted** (usage limits have stopped agents twice),
  rerun it from a self-contained brief. The round-1 reproduction scripts
  were kept outside the repository in the session scratchpad and may be gone.

## Rules that are easy to break

- **Never run `git add -A` or `git add .` in this repository.**
  `apps/texgraph/` holds author files. It is ignored now (D-015), but stage
  named paths only anyway, and never clean or move that folder.
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
| Release the stex-igor branches (3c, 4a, 4b) | Release after reviewing the Company screen's wording; then rerun `apply-igor-profile.sh` on the VM and restart Hermes | A push to `main` deploys to production; until then the suite's Company links and director proposals do nothing live |
| Scope turn time budget | Raise the scope turn to 120 s and the service cap to match; then approve one more paid turn | Grok 4.7 took 32 s on a six-line poem, so no live proposal reaches Frige at 30 s, and a timed-out turn is still billed |
| Output budget for long pieces | Keep 20,000 output characters until a long piece is needed | A piece over about 15,000 characters cannot be proposed today |
| Proposal channel ([D-017](DECISIONS.md)) | Keep the fenced block | Works with any catalog model; structured output would depend on each model |
