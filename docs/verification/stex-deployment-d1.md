# STEX deployment D1 — consolidation and production hardening (public summary)

**Milestone:** D1. This milestone covers repository consolidation, deployment
security, and operational verification for hosted Igor. It was authorised by
the project owner on 2026-11-06. It hardens operations only; no features are
in scope, and the Python migration waits until D1 is accepted.

This repository is public. This summary therefore records outcomes and
statuses only. The full report — the baseline, the security findings, the
evidence, and the independent review — is private, in
[stex-igor](../../stex-igor/docs/verification/stex-deployment-d1.md),
together with the operations runbook.

Status values: PASS, FAIL, BLOCKED, NOT TESTED, NOT APPLICABLE.

## 2. Repository consolidation

| Step | Result | Status |
| --- | --- | --- |
| Divergence and conflicts | Linear history and a fast-forward; no merge needed | PASS |
| Identifier scrub of the 10 unpublished commits (`git filter-branch` tree filter limited to three documentation files) | 0 identifier lines remain in the new history. The submodule pointer is unchanged and the tip diff is 4 documentation lines. The pre-scrub tip is kept locally as `backup/pre-scrub-eb19b0b` and must never be pushed. | PASS |
| `main` fast-forwarded and pushed | `8a7ee41..d5afab8` | PASS |
| Fresh `git clone --recurse-submodules` (authorised user) | Clean checkout; the private submodule is at the pinned commit with real LFS media; `pnpm install --frozen-lockfile` works; Igor 10, Pantheon 12, and inference 21 tests pass | PASS |
| Same clone, shared-asset check | **FAIL → fixed.** The I3 path updates changed `packages/design-system/AGENTS.md` after the copy was synced. Re-synced in stex-igor `6b6aada`; it publishes with the D1 stex-igor release. | PASS after fix |
| Windows note | A clone into a path already about 150 characters long exceeds Windows' 260-character limit (deep manuscript paths). Use a short path, or `git config --global core.longpaths true`. | Documented |
| Local branches | `feat/igor-hosted` was moved to its scrubbed equivalent `d0905fa`; `feat/igor-i1` = `329ecf6` (unchanged). Remote `feat/command-center` and `feat/identity-splash` are merged and can be deleted with approval. | Pending cleanup approval |

## 3. Ownership

| Subsystem | Authoritative repository | Runs at | Consumers | Sync mechanism | Released by |
| --- | --- | --- | --- | --- | --- |
| Pantheon shell | stex-suite `apps/pantheon` | Owner's machine (loopback) | Owner | — | Local only |
| Igor frontend and conversation API | stex-igor `apps/igor` | Hosted VM, and locally through the submodule | Browser through Access; Pantheon (local handoff) | Submodule pointer in stex-suite | stex-igor Deploy workflow |
| Igor contract `stex.igor.conversations.v1` | stex-suite `protocol/igor` | — | Igor, Pantheon | Versioned contract | stex-suite |
| Hermes adapter (`services/inference`) | stex-igor | VM; locally for Frige development | Igor; Frige locally | Submodule | stex-igor Deploy workflow |
| Hermes turn contract `stex.hermes.turn.v1` | stex-suite `protocol/hermes` | — | Inference, Frige | Versioned contract | stex-suite |
| Hermes roster, profiles, runtime pin | stex-igor `hermes/`, `runtime/hermes-agent`, `deploy/hermes/` | VM (`hermes` user) | Hermes gateway | Profile script run manually | Owner (maintenance) |
| Frige, Seaxneat | stex-suite | Owner's machine | Owner | — | Local only |
| Design system | stex-suite `packages/design-system` | Locally; a copy is served by hosted Igor | All interfaces | `sync:stex-igor` plus the `test:stex-igor-sync` check | stex-suite, then a stex-igor commit |
| Brand assets and masthead media | stex-suite `assets/`, `apps/pantheon/public/media` | Locally; a copy is served by hosted Igor | Pantheon, Igor | Same sync and check | Same |
| Application registry v2 | stex-suite `protocol/applications` | Pantheon | Pantheon | — | stex-suite |
| Deployment scripts and CI/CD | stex-igor `deploy/`, `.github/workflows` | GitHub Actions; the VM | — | — | stex-igor |
| Credentials and configuration | Neither repository | VM `/etc/stex/*.env`, Hermes profile `.env`, the `cloudflared` token, Secret Manager; GitHub repository variables (not secret) | Services on the VM | Manual, owner only | Owner |
| Persistent conversations | Neither repository | VM `/var/lib/stex/igor`; each local checkout has its own `.local-data` | Igor | Backups (D1) | Owner |
| Tests and documentation | Each repository for its own code. Cross-application browser acceptance (`verify:igor`) and public verification evidence stay in stex-suite; the operations runbook is in private stex-igor. | — | — | — | — |

### Duplication

| Duplicate | Class | Control |
| --- | --- | --- |
| `stex-igor/vendor/design-system` ← `packages/design-system` | Intentional deployable snapshot | `sync:stex-igor` (deterministic; tracked files only; rejects LFS pointers; ignores line endings) and `test:stex-igor-sync` |
| `stex-igor/apps/igor/public/media/masthead` ← Pantheon masthead media | Synchronised asset | Same |
| Igor `src/chat/motion.ts` and Pantheon `public/motion.js` | Intentional parallel implementation of the same rules: the applications may not import each other | Same stored preference key; review both together |
| Loopback-host checks in Pantheon `shell.mjs` and Igor `http.mjs` | Intentional (no shared application code) | Both are covered by tests |
| — | Unintentional divergence | None found beyond the drift fixed above |

## 4. Hardening status

| Area | Status |
| --- | --- |
| Repository consolidation and submodule integrity | PASS |
| Shared-asset synchronisation | PASS locally; CI detection waits for a read-only token |
| Authentication boundary (UI, API, forged credentials, direct origin) | PASS |
| Deployment pipeline hardening (pinned actions, least-privilege permissions, release metadata, generation guard, active-SHA verification) | Implemented; not yet deployed |
| Health checks, deployment record, staging slot, backups, and restore verification | Implemented; independent review found issues to fix before the first deploy |
| Deployment identity tightening, egress policy, and edge TLS settings | Prepared; waiting for owner-run changes |
| Provider spend | Application-side bounds PASS; provider limit not applicable (owner decision) |
| Rollback exercise and restore verification on the VM | NOT TESTED |
| Independent review | Round 1 complete; findings tracked privately |

**D1 is not complete.** The Python migration waits until it is accepted.
