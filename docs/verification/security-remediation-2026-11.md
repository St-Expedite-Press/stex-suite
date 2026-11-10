# Audit remediation: SEC-01, SEC-04, SEC-02 (2026-11-09)

An external read-only audit (2026-11-09) checked suite `5800920` and Igor
`462bf60`. We re-checked its findings against the platform branches before
changing anything.

| Finding | On the platform branches before this change | Outcome |
| --- | --- | --- |
| SEC-01: any signed-in account could list, read, change and delete every conversation | Confirmed; recorded in the runbook as an accepted owner decision of 2026-11-07 | Owner chose per-user ownership; implemented |
| SEC-04: sign-out revocation lost on restart | Confirmed (in-memory map) | Implemented |
| SEC-02: generated Seaxneat processes inherit the full parent environment | Confirmed for install, build, Git and preview; previews already had opaque sandbox origins (P1) | Environment allow-list implemented; no OS isolation claimed |
| CI-01: suite CI green with tests skipped | Stale here: `45cdb0d` makes a missing key fail the gate | Still blocked on the owner-authorized read-only deploy key (GitHub policy 422) |

## Behavior

- **Ownership (stex-igor `apps/igor`).**
  - **Principals.** Every conversation stores an `owner`: the password-mode
    username, the Access email (`sub:<id>` when there is no email), or
    `local`.
  - **Scope.** Each operation is bound to the caller's principal. That covers
    list, get, rename/archive, delete, post, retry, context create and
    selection.
  - **Other accounts.** Another account's conversation answers the same
    `404` as a missing one.
  - **Idempotency.** Keys are stored per principal.
  - **API shape.** The `owner` field is not part of the v1 API shape.
- **Migration.**
  - **Who gets old records.** Records without an owner are assigned once to
    `STEX_IGOR_LEGACY_OWNER`. The value is validated: it must be an existing
    user, an allow-listed email, or `local`, depending on the mode. Without
    it, they go to the single active `owner`-role user (password mode), the
    sole allow-listed email (Access mode), or `local`.
  - **Legacy keys.** Legacy idempotency keys are rescoped to their
    conversation's owner.
  - **Ambiguous or invalid cases.** Igor exits at start-up and assigns
    nothing. The only possible store write is the existing marking of
    interrupted replies.
  - **Rollback.** The migration only adds a field, so earlier releases can
    still read the store.
  - **Reserved names.** The usernames `local` and `sub:…` are reserved.
  - **Hosted readiness.** For signed-in callers it omits the global
    conversation count.
- **Durable sign-out.**
  - **Storage.** Signed-out session ids (not cookies) persist in
    `session-revocations.json` until expiry.
  - **Unreadable file.** The record is read once at start-up, and an
    unreadable one stops Igor. After that, in-memory revocations are
    authoritative.
  - **Failed sign-out write.** The browser cookie is still cleared, and the
    response is `STORAGE_FAILED`.
  - **Shutdown.** Igor waits for pending sign-out writes before exiting.
- **Operations.**
  - **Backup.** The backup copies `session-revocations.json`.
  - **Restore check.** The check now counts conversations through the
    content-free `/igor/api/ready`. A local-mode listing would show only
    `local`-owned records and fail after migration.
- **Seaxneat.** `src/child-environment.mjs` passes only OS, home/temp/cache,
  locale, proxy and CA variables plus `NEXT_BASE_PATH` and
  `NEXT_TELEMETRY_DISABLED=1` to generated-workspace processes.

## Independent review

One round by a separate reviewer agent, given the diff and the threat model.
It found no blockers and confirmed that every route checks the owner before
any other state check. It raised four should-fix items, all fixed in this
change:

- An unvalidated legacy owner.
- The global conversation count in authenticated readiness.
- Next telemetry no longer disabled.
- Run-time wording in this record.

Also fixed from the review: active-only sole owner, reserved principals, the
shutdown wait, and the docs and comments.

Accepted as limits:

- The idempotency key store (1,000 keys) is shared across accounts.
- The revocation file has no size cap.
- The project-context source routes are not per account.
- No Access-mode two-account test.

## Commands and results (Windows, Node 22, local)

| Command | Result |
| --- | --- |
| `corepack pnpm run test:igor` (stex-igor) | 22 pass (2 new: two-account ownership on every route plus legacy migration; durable sign-out across restart plus fail-closed starts) |
| New Igor tests against the pre-change server code | Both fail on the defects: the member listed the owner's conversation; the signed-out cookie got `200` after restart |
| `corepack pnpm test`, `typecheck:igor`, `build:igor` (stex-igor) | Pass |
| `corepack pnpm run test:seaxneat` | 23 pass (2 new: allow-list, and planted secrets absent from a real child process) |
| `corepack pnpm verify:platform` | PASS: real Next install/build, apply, restore and mounted preview in Chrome with the allow-listed environment |
| `corepack pnpm test` (suite) | Exit 0 (157 Node tests, 64 pytest, Ruff/mypy, instruction and stex-igor sync checks) |
| `corepack pnpm verify:igor`, `verify:igor-login` | Pass |
| Restore-check probe against an owned store in local mode | `/ready` counts 2; a local listing returns 0 (the old check would have failed) |
| `bash -n` on the backup and restore scripts; `git diff --check` | Pass |

## Release (owner-authorized 2026-11-09)

- **Igor CI.** CI on `d0598d8` passed (push run `42740714736`, PR run
  `42740722322`).
- **Merge.** stex-igor `main` was fast-forwarded `462bf60` → `d0598d8`; PR 1
  is merged.
- **Deploy.** Run `42740878426` passed CI and the deploy job. The VM reports
  active release `d0598d8`, generation 12, with no rollback.
- **Public checks after deploy.** `/igor/` redirects to sign-in. The
  conversations, readiness and session APIs answer `401`, and the login page
  answers `200`.
- **Suite.** Branch `0d53ba4` (PR 5) still fails CI at "Verify checkout
  access to the exact private Igor revision" (run `42740730030`), so it is
  not merged.

## Limits

- **Not verified in production.** Two-account isolation and durable sign-out
  have not been checked against production with real accounts, and the VM
  journal (the legacy-assignment line) was not read.
- **Suite not merged.** The suite part, including the Seaxneat allow-list,
  is unmerged.
- **Not run.** The Linux restore script was not executed; only its probe and
  parser were.
- **Rollback.** Rolling back to an earlier release makes conversations shared
  again (no data loss).
- **Restore from backup.** A real restore brings back only the sign-outs
  recorded up to that backup.
- **Seaxneat isolation.** Seaxneat processes still run as the same OS user
  with that user's file access. Proxy URLs that contain credentials still
  pass through.
