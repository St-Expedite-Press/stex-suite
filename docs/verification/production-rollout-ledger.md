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
| **Backup key protected and decryption verified** | **NOT MET.** The private key still decrypts with an empty passphrase, and the unprotected export `stex-backup-PRIVATE.asc` is still on disk. This needs the owner (see the request below). **Every merge stage is held** |

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

## Request to the owner (blocks the Igor merge)

Protect the backup key, then reply when it is done:

1. Add a passphrase. This prompts you; choose a strong one and keep it:
   `gpg --homedir C:\Users\rberr\stex-backups\gnupg --passwd 974025A16B6850C82F44B2B56BDE06638E411A8D`
2. Export the protected key:
   `gpg --homedir C:\Users\rberr\stex-backups\gnupg --armor --export-secret-keys 974025A16B6850C82F44B2B56BDE06638E411A8D > stex-backup-private-protected.asc`
3. Store that file and the passphrase in your password manager. Keep one
   offline copy (an encrypted USB drive or paper) somewhere other than this
   PC and the backups.
4. Delete the unprotected `C:\Users\rberr\stex-backups\keys\stex-backup-PRIVATE.asc`.

Claude then verifies, without seeing the passphrase, that:
- the key no longer decrypts with an empty passphrase;
- the unprotected file is gone;
- with your passphrase entered in your own terminal, a real bundle decrypts.
