# Phase I readiness: reconciliation, gate integrity, candidate review

2026-11-27. Read-only reconciliation of both repositories, a mechanical gate
runner, an independent review of the separation candidate with fixes, a
production-parity matrix, and a backup and recovery plan. Nothing was pushed,
merged or deployed. No VM, real vault, real book, provider or paid call was
touched. Historical reports, including [separation-m1](separation-m1.md), are
unchanged; this report supersedes their open items where it says so.

## 1. Reconciliation (A0)

| Item | Handoff said | Observed |
| --- | --- | --- |
| Suite remote `main` | `9c4f77c` | `9c4f77c` (fetched 2026-11-27) |
| Igor remote `main` | `0455f82` | `0455f82`; the local `main` branch is 12 commits behind it, which does not affect the candidate |
| Suite candidate | `d215117` on `feat/separation-m1` | Present only locally, in the worktree `C:/Users/rberr/stex-wt/sep-m1`, clean, 18 commits ahead of `9c4f77c`, not on the remote |
| Igor candidate | `ec0ee08` | Present only locally, clean, 6 commits ahead of `0455f82`; the suite gitlink matches |
| Hermes pins | candidate `8fc0374` (v0.23.4); deployed `e76fbd80`; Obsidian `b110b2f8` | Source agrees: `runtime/hermes-agent` gitlink is `8fc0374…`, `hermes/eval/pins.json` names `e76fbd80…` current and `b110b2f8…` (1.2.1). The **installed** VM runtime was not read (it needs VM access) |
| Uncommitted Frige work | Ten entries | Ten entries in the main checkout (nine modified, one untracked): the Frige workstation stabilization slice on `9c4f77c`. Left untouched. It edits the same `docs/STATUS.md` and `docs/verification/README.md` tables as the candidate, so a merge conflict is expected on those two lines |
| CI | Suite CI runs the full test job | True. Suite CI ran `pnpm test`, a fail-fast chain, under bash with `pipefail`. Igor CI runs its tests, typecheck, build and archive check. Igor `deploy.yml` deploys every push to Igor `main` after CI |
| Deployed state | Pantheon generation 3 (`d3f995e`), Igor generation 25 (`0455f82`) | As recorded in [STATUS](../STATUS.md); not re-read from the VM |
| "VM needs no GitHub access" | Runbook: the VM never runs a package manager, so the egress lockdown needs no exception | **Conflicts** with the staging finding that `e76fbd80` re-resolves a GitHub-hosted wheel on every start. Either production egress is open, or the VM install differs from staging. Unresolved until the stage 1 read-only VM check |
| Backups | Step 0 precondition outstanding | Confirmed. See section 5 |

The gate defect was real: the first separation pass reported a passing Igor
gate for content that was not the committed tip, and `pnpm test` cannot say
which suites never ran.

## 2. Mechanical gate integrity (A1)

`scripts/verify/run-gates.mjs` (library `scripts/verify/gates/runner.mjs`):

- runs `check:prereqs`, `build:pantheon`, every step of the suite `test`
  chain, then every step of Igor's chain plus `typecheck:igor` and
  `build:igor`, each as its own process with no shell; refuses a chain it
  cannot parse;
- classifies each check from its exit status alone as passed, failed,
  skipped or unexecuted, and exits 0 only when all passed (1 failed,
  3 incomplete, 4 stale, 2 usage);
- fingerprints HEAD and worktree content of both repositories before and
  after the run, and fails the run if they changed during it;
- records the Node, Python, pnpm, lockfile, Igor gitlink and Hermes pins,
  the OS and toolchain, and skip counts reported inside each suite;
- writes `report.json` (`stex.verification.run.v1`), `report.md` and a log
  per check, outside the repositories;
- `--check <report>` rejects the report after any commit or file change;
  `--release` also rejects dirty trees, gitlink drift and toolchains off the
  pins.

Its 21 tests inject failing, lying ("PASS" with exit 1), aborting,
unstartable, timed-out, skipped, partially selected and mutating checks and
stale reports. Breaking the exit-status classification or the verdict in a
copy fails 7 and 5 of them. Suite CI now runs the gate through the runner
and writes the report to the job summary; a test fails if a workflow drops
bash (`pipefail`) or CI goes back to the bare chain. Local enforcement is
the same command; no hook is the only guard.

## 3. Candidate review (A2)

An independent read-only reviewer (a separate agent given the diffs and the
charters, not this report) covered the eight areas. Its findings, checked
against the code here:

| Finding | Outcome |
| --- | --- |
| The platform API checked no Host or Origin, while local-mode knowledge needs no credential; a DNS-rebinding page could read `/export` and relayed passage text | **Fixed** (`stex.hosts.HostAdmission`): foreign Host, cross-site fetch and foreign Origin get 403 before any route. Staging lists the platform's own service name. Verified in `test_hosts.py` and the staging stack (15/15) |
| `contributions/resolve` released text after a Frige read without re-checking, so a withdrawal during the read still yielded it once | **Fixed**: re-checked after the read; test withdraws during the read |
| A storage failure during a withdrawal answered `400 INVALID_REQUEST` | **Fixed**: `503 KNOWLEDGE_UNAVAILABLE` (the Node library's code), state unchanged; test simulates a full disk |
| No directory fsync after rename: a power loss could revert a withdrawal | Open (minor). Process crashes are safe |
| Lock recovery across PID namespaces (two containers as PID 1 on one volume) | Open (minor). Shipped compose files use separate volumes; the verified rollback is native |
| Erase clears ledgers, then a concurrent journal write can make the journal erase 409 | Open (minor). Fails closed: nothing stays resolvable |
| A hosted Igor pointed at a local-mode platform resolves against one journal | Open (minor, misconfiguration). Igor sends no hosted marker |
| An empty or overlong passage title answers 503 instead of 400; CRLF excerpts are not split into paragraphs; hardlinks into the vault are not detected | Open (minor/note) |

Per-area verdicts (17 routes in OpenAPI and in the contract test; withdrawal
and erasure not revived by restart, replay, rollback or generation change;
path hardening; single writer on one host; hosted isolation; Frige passage
boundary; Igor resolution failing to `unavailable`; container exposure only
by opt-in) hold. Each fix's test fails with the fix removed.

## 4. Production parity (A3)

`stex-igor/apps/igor/test/parity-matrix.test.mjs` drives the real
conversation service with the real `isDocumentTurn` check:

| Project context | Knowledge | Result |
| --- | --- | --- |
| Absent | Absent | No grant; empty context |
| Present | Absent | Grant; the turn is an eligible document turn |
| Absent | Present | Passages only; no grant ever opened |
| Present | Present | **Refused** (400) at creation and when adding a selection. This design choice (Igor `ab11074`) makes the directive's rows "Present/Present", "Withdrawn/Present" and "Present/Withdrawn" unreachable. Document turns need the approved documents as their only context. Combining them is an owner decision |
| Withdrawn | n/a | Next turn: no grant, no documents |
| n/a | Withdrawn | Next turn: no passage, no grant, the turn still runs |

**Pre-existing defect found (deployed in generation 25):** a working session
continued from a project session, with sources re-approved, sends
`priorSessionSummary` beside `approvedDocuments`. Igor opens a grant and the
inference service refuses the turn (`INVALID_DOCUMENT_TURN`), so the user
sees "Igor could not answer". The test records it as a `todo`. The full
HTTP path was not exercised. Options: (a) send document turns without the
summary, (b) admit a bounded summary to the isolated document turn, or
(c) no grant on continued sessions. Each changes the document-worker
boundary and needs an owner decision.

The other rows of the production-parity matrix (sign-in, history, Frige
editing, proofs, proposals, journals) are covered by the passing suites
below and earlier evidence. None was re-run against production.

## 5. Backup and recovery (A4)

The [backup and recovery plan](../../stex-igor/docs/operations/backup-recovery-plan.md)
(in stex-igor, which owns the VM) inventories every authoritative path by
class. It found that:

- `/etc/stex/igor-users.json` (accounts and password hashes) is in **no**
  backup;
- the studio backup (books, editorial state, knowledge journals) has no
  manifest, checksums, release identity or restore check;
- both backups live on the VM's own disk, unencrypted, and the disk
  snapshot schedule has no recorded evidence of being applied;
- the only restore evidence is D1's single-conversation check.

It stages: (1) a read-only VM inventory, (2) an encrypted, manifested
bundle copied off the VM, (3) a network-less restore from the deployed
revisions with count and digest assertions and recorded recovery time and
point, and (4) standing protection.

## 6. Review of this pass

A second independent reviewer examined this pass's own diff (suite
`d215117..bdfa4ad`, Igor `ec0ee08..3b6b68b`):

| Finding | Outcome |
| --- | --- |
| A report from an injected manifest or from one repository could pass `--check --release` | **Fixed**: reports record their gate scope. Release evidence needs both repositories, no manifest, and the exact check list the checkout defines now, each passed |
| On Linux a timeout signalled only the direct child, so descendants holding the pipes could stall the job | **Fixed**: checks run in their own process group, which gets SIGTERM and then SIGKILL. A test with a pipe-holding grandchild passes on Windows and on Linux (Node 22.23.5 in Docker, 21/21) |
| The backup plan's restore used the staging compose files, whose `edge` network has outbound access | **Fixed**: a dedicated `--internal` network, no published ports, a verifier container, and isolation asserted before any data is restored |
| The studio backup is a live `tar`, so "no stop needed" was wrong; plaintext staging copies were not deleted | **Fixed**: the baseline stops writers by default; plaintext copies are deleted after encryption |
| An over-long note path segment would answer 503 on Linux (ENAMETOOLONG) | **Fixed**: refused as 400 before any filesystem call |
| Parity test 4 accepted any 400 | **Fixed**: asserts the refusal reason |
| Ignored files are not fingerprinted; a CRLF-only change to a tracked file is invisible under `autocrlf` | Accepted: ignored files are local state outside the tested source; git normalises the content it tests |
| Skipped tests inside a passing suite do not fail the gate | Accepted: they are counted in every report. The known skips are Windows symlink and socket cases, which run on CI's Linux |
| CI keeps the full report in `$RUNNER_TEMP` only (the job summary has the table) | Open: uploading it needs `actions/upload-artifact` pinned to a verified commit SHA, which could not be verified offline here |
| A harness break inside the `todo` parity case would also read as todo | Open (note): the case's failure message was checked by hand on both reviews |

The Host check holds for every probe tried. These were refused: a trailing
dot, `127.1`, `0.0.0.0`, port 0 and out-of-range ports, a duplicate or
missing Host, and `null`, userinfo or trailing-slash Origins. The probes
found no legitimate caller that is now refused.

## 7. Verification

| Run | Suite | Igor | Result |
| --- | --- | --- | --- |
| 1 | `3d3e1e3` | `ec0ee08` | PASS: 24 of 24 checks, 111 s. Not release evidence (Node 24.18.0) |
| 2 | `91957ed` | `3b6b68b` | PASS: 24 of 24 checks, 114 s. Skips reported inside suites: Frige 1, knowledge 2, platform 1 (Windows symlink and socket cases); Igor's parity `todo` 1. Not release evidence (Node 24.18.0) |
| 3 | `bdfa4ad` | `3b6b68b` | PASS: 24 of 24 checks, 113 s. `--check` CURRENT; `--release` refused (Node 24.18.0). Run 2's report was refused as STALE (exit 4) after the docs commit |

A report cannot name the commit that contains it. The run on the final
revision is in the handoff, and anyone can reproduce it with
`corepack pnpm verify:gates`.

Other commands: `corepack pnpm run test:platform` (116 passed, 1 Windows
symlink skip, after the review fixes); runner tests 21/21 on Windows and on
Linux; staging stack `verify-staging-compose.mjs` 15/15 with the Host check
(built, verified, volumes removed). The first reviewer ran the pytest, Igor,
knowledge, Pantheon and Frige suites, `verify-passages` and
`verify-knowledge-rollback`, all exit 0, on `d215117`.

Not run: the hosted and Igor-host staging overlays after these fixes, a
clean uncached Hermes build or offline restart (A5), any VM check, any
browser workflow. Local runs used Node 24.18.0, not the pinned 22.23.5, so
**no local report is release evidence**; trusted CI on Node 22.23.5 must
produce it after an authorized push.

## 8. Next authorization

See the completion report for the exact request.
