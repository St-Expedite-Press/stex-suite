# Phase I production rollout ledger

The owner authorized the staged rollout on 2026-11-28, with stop conditions:
any failed security, persistence, authentication or recovery invariant
halts every later stage. Each stage records previous and new revisions,
release generation, runtime identity, times, service interruption,
verification commands and exit codes, data integrity, defects, rollback
readiness and a verdict. No record content, credential or key appears here.

## Stage 0: recovery preconditions (2026-11-28T00:37Z)

| Precondition | Result |
| --- | --- |
| Candidates and CI unchanged | Suite `b4bab21` and Igor `a607433` on `origin/feat/separation-m1`, worktrees clean. Suite CI run 46083776870 PASS and eligible; Igor CI on `a607433` success |
| Production identity | Igor `0455f82` generation 25 (`stex-igor-0455f82148ab.20261125T213340Z`); Pantheon `d3f995e` generation 3; Hermes `e76fbd80be65ea5c1b89831f8d7aaedb713f5cac`; all units and both backup timers active |
| Persistent storage | `/var/lib/stex/igor`, `/etc/stex/igor-users.json`, `/var/lib/stex/inference`, `/var/lib/hermes/.hermes`, `/var/lib/stex-studio/{frige,knowledge}` (inventory in `stex-igor/docs/operations/backup-recovery-plan.md`) |
| Fresh backup (under 24 h) | Igor and studio backups `20261127T184933Z` and the encrypted baseline bundle `20261127T184932Z`, about 5¾ h old |
| Restoration checks | On the VM, `stex-restore-verify.sh` on the newest Igor backup: PASS, 2 of 2 conversations, three databases ok (exit 0). The studio archive is readable (137 files). The baseline bundle passed the isolated full restore on 2026-11-27 |
| Previous release artifacts | Igor generation 25 and four earlier releases in `/opt/stex/releases`; Pantheon `d3f995e` and four earlier releases in `/opt/stex-pantheon/releases` |
| Rollback compatibility | The Igor candidate adds no store migration. Knowledge references are stored only when a client sends them, and the deployed Pantheon `d3f995e` has no passage interface. The generation 25 code reads the store unchanged |
| **Backup key protected and decryption verified** | Not met at 00:37Z. Met at 00:45Z (see Stage 0 completion) |

## Stage 0 completion: backup key custody (2026-11-28T00:45Z)

At the owner's request, Claude protected the key and stored the recovery
copies. A generated 32-character passphrase was applied to the key; it was
written only to a file and never printed. The folder `STEX backup key` on
the owner's OneDrive-synced desktop holds:
- the protected private key;
- the passphrase;
- the public key;
- a README on locating and decrypting the backups.

OneDrive provides the online copy. The owner accepted that the key and
passphrase sit together.

Verified by gpg exit status, on the working keyring and on the desktop
export imported into a fresh keyring:
- an empty passphrase and a wrong passphrase are refused (exit 2);
- the passphrase decrypts the real baseline bundle (exit 0, 485 of 485
  entries).

The unprotected `stex-backup-PRIVATE.asc` was shredded. One verification run
wrote the decrypted archive briefly to the local temp folder and deleted
it. **Precondition met.**

## Stage 2: Igor release (2026-11-28T00:46Z to 00:51Z)

| Item | Result |
| --- | --- |
| Revisions | `0455f82` (generation 25) → merge `b19e5b7` (generation 26). Its parents are `0455f82` and the accepted candidate `a607433`, with an identical tree (`7b490ac1…`). PR stex-igor#16 |
| Pipeline | Deploy run [46089710246](https://github.com/St-Expedite-Press/stex-igor/actions/runs/46089710246): ci/test success, deploy success. The installer's health checks passed and the workflow verified the active release |
| Interruption | `stex-igor`, `stex-inference` and both document units restarted at 00:48:47–53Z. `hermes-igor`, Pantheon, Frige and cloudflared were untouched |
| Runtime | Hermes still `e76fbd80be65ea5c1b89831f8d7aaedb713f5cac` |
| Health | Readiness: store readable, 2 conversations, inference ok. All units active |
| Authentication | Public `/igor/login` 200 on both hostnames; signed-out `/igor/api/conversations` 401; signed-out Pantheon pages 303. The users file is byte-identical to the baseline (sha256 `e1a249b1…`); the revocation list is intact |
| Knowledge | Inactive: no `STEX_KNOWLEDGE_URL` in `igor.env` |
| Expanded backup | Installed. Ran once with `systemctl start stex-backup.service`: success, 342 files (333 from the Hermes home), six databases ok, 3 accounts. `stex-restore-verify.sh` on it: PASS, 2 of 2 conversations, users 3 (exit 0) |
| Frige state | Manuscripts byte-identical to the baseline (trees `951ce12b…`, `c6218a3d…`) |
| Not exercised in production | A real sign-in (no passwords held). Continued sessions with documents, and withdrawal (no working sessions exist in production). Both are covered by the deterministic tests in trusted CI |
| Rollback readiness | Generation 25 kept in `/opt/stex/releases` (the runbook's manual path) |
| **Verdict** | **ACCEPTED** |

## Stage 3: Pantheon and Frige release (2026-11-28T00:52Z to 01:08Z)

| Item | Result |
| --- | --- |
| Suite merges | PR #25 merged as `88daf36`, whose tree equals CI-tested `d0aef28` (run 46090083116: 25/25, eligible). PR #26 merged as `782585e`; it commits the Pantheon packager (see Defects) and passed CI |
| Revisions | Pantheon `d3f995e` (generation 3) → `782585e` (generation 4), pinning Igor `b19e5b7`. Built by the hosted-Pantheon runbook from a clean worktree of `origin/main`, with `dirty: false` |
| Pre-change backup | `stex-studio-backup.service` ran at 01:01:54Z (success) |
| Install | Attempt 1 at 01:03:00Z **failed safely** before any change (see Defects); generation 3 stayed active. Attempt 2 at 01:06:59Z: `installed … (generation 4)`, installer exit 0. Its gate passed twice: liveness, Frige via the proxy, signed-out redirect, API 401, foreign Host 403 |
| Interruption | `stex-pantheon` and `stex-frige` restarted at 01:07:01Z. Igor, inference, Hermes and cloudflared were untouched |
| Manuscripts and editorial state | Both books' manuscripts byte-identical to the baseline (trees `951ce12b…`, `c6218a3d…`). Editorial-state file counts unchanged (7, 16). The protected book is still locked |
| Knowledge ownership | Unchanged: Pantheon's native journal (`STEX_KNOWLEDGE_SERVICE` unset, `STEX_KNOWLEDGE_DATA_DIR` set). Journal generation `1ed190d7`, 2 events |
| Proof generation | The deployed Frige code and the VM's TeX, on a temporary copy of the unlocked book on a spare port, produced HTTP 200 and an 8,506-byte `%PDF-`. The copy was removed and production books were untouched |
| Public gate | `/`, `/home/`, `/frige/` 303; `/api/books` 401; `/igor/login` 200 |
| Not exercised in production | Signed-in workstation use and contextual conversations (no passwords held). Covered by trusted-CI tests |
| Rollback readiness | Generation 3 kept in `/opt/stex-pantheon/releases`; reinstall with `--allow-downgrade` |
| **Verdict** | **ACCEPTED** |

**Defects found and fixed during the stage:**

1. **The Pantheon packager was never committed.** The `.gitignore` rule
   `release/` also matched `scripts/release`, so generations 1 to 3 were
   built from an ignored local file. Fixed in PR #26: the packager is
   committed byte-identical, the rule is anchored to `/release/`, and a test
   fails if a package script runs an uncommitted file.
2. **Windows line endings in release artifacts.** On a checkout with
   `core.autocrlf=true`, `git archive` produced a CRLF deploy bundle, and
   bash refused the installer (`set: pipefail: invalid option name`). The
   packager also copied CRLF working files. The release was rebuilt from
   LF files (`git -c core.autocrlf=false`), verified at 0 CR bytes in both
   artifacts. The runbook needs this step; until a CI-built release
   replaces local builds, build releases from an LF checkout.

## Stage 4: platform API (HELD, 01:09Z)

**Not started.** Neither repository has a production install path for the
platform API:
- no systemd unit, installer, release packaging or env template;
- only the local Docker staging stack;
- the VM has Python 3.11.2, and the backend requires 3.12;
- Pantheon's `STEX_PLATFORM_URL` points at port 4349, where nothing listens.

Creating that tooling directly on production, right before moving canonical
knowledge ownership, would be an improvised change outside a tested
release. The stop conditions exclude it. The next engineering increment is
a reviewed, tested platform-API release:
- a pinned Python 3.12 runtime installed without network at start;
- an unprivileged unit bound to loopback;
- an env template with `STEX_KNOWLEDGE_HOSTED=1` and both secrets;
- packaging with the Pantheon release;
- an exercised single-writer cutover script that stops Pantheon, switches
  `STEX_KNOWLEDGE_SERVICE`, starts the platform on the same journal
  directory, and verifies;
- and its rollback, rehearsed on the VM's staging slot.

Stages 5 and 6 (Igor contributions, Hermes v0.23.4) depend on it or follow
it.

## Protection actions taken (not gated by the merge preconditions)

| Action | Detail | Rollback |
| --- | --- | --- |
| Disk snapshot schedule (owner-authorized, within the reported cost envelope) | `stex-daily`: daily at 04:00 UTC, 14-day retention, stored in `us-central1`, keeps automatic snapshots if the disk is deleted. Attached to `stex-inference-01`. Expected cost about $1 to $4 a month regional | `gcloud compute disks remove-resource-policies stex-inference-01 --zone us-central1-a --resource-policies stex-daily` |
| Igor release PR | [stex-igor#16](https://github.com/St-Expedite-Press/stex-igor/pull/16) created for `a607433`, **not merged** | Close the PR |
| Off-host project and bucket (plan steps 1–4) | Project `stex-offhost-backups`, billing linked, Storage API on. Bucket `stex-offhost-backups-4bc84d0e` in `us-east1`: Standard class, uniform access, public access prevention enforced, versioning on, 30-day retention (unlocked), 7-day soft delete. The VM service account holds only `roles/storage.objectCreator` on it. A $5 monthly budget alerts at 50% and 100% | Remove the IAM binding, delete objects after their retention ends, delete the project |
| First off-host copy (plan step 5) | The verified baseline bundle (2,895,830 bytes) with `SHA256SUMS` and its manifest, uploaded with `--if-generation-match=0`. Read back with the owner identity: sha256 OK. Overwriting it was refused (`412`) | — |

## Off-host retention: cost and IAM plan

**Design.**
- **Project:** a separate Google Cloud project, `stex-offhost-backups`, in
  the same organization, linked to the existing billing account. It is an
  IAM boundary separate from production. The organization and billing
  account are shared, which is a residual risk recorded under limitations.
- **Bucket:** one regional bucket in `us-east1`, a different region from the
  VM (`us-central1`), so a regional event does not take both. Settings:
  - storage class Standard;
  - uniform bucket-level access, with public access prevention enforced;
  - object versioning on;
  - a 30-day retention policy, **unlocked** at first; locking is irreversible
    and is an owner decision after a month of clean operation;
  - soft delete at the default 7 days.
- **Content:** only client-side encrypted bundles (`gpg` to the owner's
  public key, `974025A1…8E411A8D`), their `SHA256SUMS` and manifests that
  hold no content. Google-managed encryption applies on top.

**IAM (least privilege).**

| Identity | Role | Scope | Why |
| --- | --- | --- | --- |
| VM service account `stex-inference-vm@central-nerve-machine…` | `roles/storage.objectCreator` | The bucket only | It can add new objects. It cannot read, list, overwrite or delete them, so **production cannot erase or replace history** |
| Owner account | Project owner, inherited | The backup project | Restore, verify, and lock or unlock the retention policy |
| Optional verifier service account, without production access | `roles/storage.objectViewer` | The bucket only | Scheduled restore drills that need no owner session (later) |

Uploads use `gcloud storage cp` with the precondition
`--if-generation-match=0`, so an existing name is never replaced. Object
names carry the UTC timestamp.

**Network.** While egress is open, nothing changes. When the lockdown is
applied, it must allow `storage.googleapis.com` (or enable Private Google
Access).

**Cost estimate.** A bundle is about 3 to 6 MB encrypted; the baseline was
2.9 MB, and the fuller backup adds the Hermes home. Thirty days of daily
bundles plus noncurrent versions come to well under 1 GB.
[Cloud Storage pricing](https://cloud.google.com/storage/pricing) includes
5 GB-months of regional storage in `us-east1` in the free tier, and an older
pricing example puts Standard at about $0.02 per GB-month there. The
expected monthly cost is **under $0.10**, with transfer and operations
costing fractions of a cent. A budget alert at $5 a month on the project
flags any surprise.

**Implementation steps.**
1. Create the project and link billing.
2. Enable the Storage API.
3. Create the bucket with the settings above.
4. Grant the VM service account `objectCreator` on the bucket.
5. Upload the verified baseline bundle from the owner's machine, read it
   back with the owner identity, and compare its sha256.
6. **Later release (separate change):** a daily `stex-offhost-export`
   service and timer on the VM. It bundles the newest Igor and studio
   backups, encrypts them to the public key, uploads with the precondition,
   and logs failures to the journal, which is monitored by the
   backup-failure check in stage 7.

## Owner request (resolved)

The key-custody request was resolved by Claude at the owner's direction on 2026-11-28 (see Stage 0 completion).
