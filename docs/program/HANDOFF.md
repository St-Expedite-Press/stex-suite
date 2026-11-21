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
  records and D-017 to D-019 are on `feat/director-proposals`, pushed as
  PR 7 (CI green, 2026-11-20), awaiting the owner's review.
- **stex-igor:** `main` is `bd8b3b0`, deployed on 2026-11-20 with the
  owner's authorization: Waves 3c, 4a and 4b, D-018, D-019 and the
  visual-production skill procedure (PRs 2 and 3, merged). The operator
  steps ran: `apply-igor-profile.sh` and a Hermes restart, so hosted Igor
  runs the Grok stack with every side model pinned. The suite's submodule
  pointer pins `bd8b3b0`. A merge or push to stex-igor `main` deploys and
  needs the owner's release authorization.
- **Current work:** Wave 4b is complete
  ([evidence](../verification/director-proposals-w4.md)). The one approved
  live turn (2026-11-20) proved the format with Grok but ran 2 seconds past
  the 30-second turn budget. The owner then raised a director turn's budget
  to 120 seconds ([D-018](DECISIONS.md), stex-igor `79d7f04`), and turns
  now stream so an abandoned one stops, with one turn slot per product
  ([D-019](DECISIONS.md), `9972d2a`). After the release a second paid turn
  carried a proposal into Frige, accepted byte-exact (W4-f). Next: bounded
  specialist investigation (needs a parked profile activated).
- **Wave F (2026-11-20):**
  - The owner's Frige Product Completion brief is now Wave F
    ([D-020](DECISIONS.md)).
  - Its first increment is anchored edits for long pieces plus passage
    review. It is merged to suite `main` (PR 8, `44cd3ac`).
  - The adapter is released: stex-igor `main` is `c5af494`, installed on
    2026-11-21 as generation 14 and health-checked. The deploy workflow's
    read-back step failed on SSH
    ([evidence](../verification/frige-wave-f-anchored-edits.md#release-2026-11-21-utc)).
  - One independent review round ran; every finding is fixed.
  - Next increments: F-B3 long-form context, then F-A1/A2/A4.
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
| A second live director turn | Approve one paid Frige turn on a synthetic book, about $0.02, now that the budget is 120 s | Shows a live proposal reaching Frige; the first turn ran out of time |
| Output budget for long pieces | Keep 20,000 output characters: anchored edits (D-020) let a piece up to the 60,000-character offer budget be revised | Only a whole-piece rewrite of a long piece still needs a wider budget |
| Confirm the active release on the VM | Read `/opt/stex/ACTIVE.json` (expect `c5af494`, generation 14), and check why the workflow's SSH read-back was refused | The install log shows the release installed and health-checked, but the workflow could not read it back |
| A live turn with anchored edits | Approve one paid Frige turn on a long synthetic piece, about $0.03 | Whether Grok writes exact anchors is unverified (R-14) |
| Reviewer model for development work | Record whether Claude review agents are acceptable, since the Wave F brief asked subagents to avoid Claude | Wave F's first review used one after the owner said to proceed |
| Proposal channel ([D-017](DECISIONS.md)) | Keep the fenced block | Works with any catalog model; structured output would depend on each model |
