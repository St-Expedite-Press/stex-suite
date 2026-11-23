# Hosted Pantheon verification

2026-11-22/23. Suite base `545fd93` (branch `feat/hosted-pantheon`, not yet
merged), private Igor pin `5db7e51` (active Igor release unchanged). Owner
authorization: hosted Pantheon on the existing VM with Seaxneat deferred and
the VM copy of the manuscripts canonical (2026-11-22). The owner then chose
"make the login real across the board" with Igor's password accounts
instead of Cloudflare Access ([D-023](../program/DECISIONS.md#d-023--hosted-pantheon-uses-igors-accounts-as-its-sign-in)).

## What runs

`https://pantheon.stexpedite.press` reaches Pantheon through the existing
Cloudflare Tunnel. Pantheon and Frige run on the Igor VM as two new loopback
services under their own system user. Igor, the inference service and Hermes
are unchanged, apart from one added Igor setting that lets it read
approved Frige project context over loopback.

| Piece | Hosted state |
| --- | --- |
| Pantheon shell, Frige workspace, Graph | Live, behind Igor sign-in |
| Frige engine and LuaLaTeX proofs | Live, loopback only, no outbound network |
| Igor | Composed at `/igor/` on the Pantheon origin; standalone Igor host unchanged |
| Seaxneat | Deferred on the host (`STEX_PANTHEON_DEFERRED`); honest deferred page, never proxied |
| Python platform API | Not deployed; Pantheon reads studio summaries directly |

Hosted mode (`STEX_PANTHEON_PUBLIC_ORIGIN`) admits a public request only
when Igor confirms a password-mode session for it over loopback. The only
exceptions are Igor's sign-in page, its session endpoint and the files the
sign-in page loads. Igor in any other mode fails closed (503). Igor's
session cookie is removed from requests to every other application. The
local, credential-free splash entry is unchanged.

## Acceptance

| Check | Result |
| --- | --- |
| `node --test apps/pantheon/test/hosted.test.mjs` | 7 passed |
| `corepack pnpm run test:pantheon` | 29 passed |
| `corepack pnpm run test:knowledge` | 13 passed |
| Frige base-path suite, including the new relative redirect through Pantheon | 11 passed |
| `corepack pnpm test` (all suites) | Passed (exit 0) |
| Local end-to-end: real Igor in password mode, real Frige, hosted Pantheon, requests shaped as the tunnel sends them | 31 passed: sign-in page and its assets while signed out; 401 for Frige, books, Igor API; wrong password and foreign-origin sign-in refused; owner and member accounts sign in and open the command center, Frige, composed Igor and Igor's API; sign-out revokes; standalone Igor still requires its own sign-in |
| Debian 12 container run of the deploy bundle (stand-in `systemctl`) | 31 passed: failed first install leaves nothing enabled; install with health and gate checks; upgrade; refused downgrade; broken upgrade rolls back; release carrying books refused; byte-exact seeding refuses to overwrite and refuses links; backup excludes the font cache and is mode 600 |
| VM host setup | LuaLaTeX self-check (geometry, fontspec, microtype, Latin Modern Roman) passed as the service user |
| VM install | Installed with two consecutive health passes, including the gate checks; Igor, inference, Hermes and the tunnel stayed active |
| VM seeding | 107 book files byte-identical to the local copy (SHA-256 manifest) |
| VM proof | One full-book LuaLaTeX build by the sandboxed Frige service in 6 s; PDF written by the service user; manuscript hashes unchanged |
| Public internet, signed out | `/` and `/home/` redirect to sign-in; sign-in page 200; Frige, books, Igor and knowledge APIs 401; forged cookie redirected; foreign-origin sign-in 403 |
| Public internet, signed in as a member account | Command center, Frige library and projects, composed Igor and Igor's API 200; Seaxneat deferred page; sign-out 204 then redirected |

## Review

Two independent review rounds. Round 1 reviewed the earlier Access design
and the deploy bundle. Its deploy-script findings were all fixed: the stale
gate check, pipe-based safety checks in seeding, hidden files skipped in
seeding, backups failing while files change, units left enabled after a
failed first install, and env backups readable by the service group. Its
Frige loopback redirect and routed-Seaxneat findings were also fixed. Round
2 reviewed the session design. It found one medium fail-open: Igor's own
paths skipped the session check, so a non-password Igor would have been
open. This was fixed before the public route was added, with a regression
test. Its low findings (cache eviction, knowledge lookups of deferred
studios) were also fixed. Two items are accepted by design and recorded in
D-023:

- every Igor account has full Pantheon access;
- Igor's session cookie now also lives on the Pantheon origin.

## Project passwords

2026-11-23, decision [D-024](../program/DECISIONS.md#d-024--frige-projects-can-have-their-own-password).
The hosted Lift Wind book now has its own password, on top of the account
sign-in.

| Check | Result |
| --- | --- |
| `node --test apps/frige/test/project-access.test.mjs` | 2 passed. Covered: hashing only, wrong password, rate limit, forged, re-targeted, expired and old-version cookies, password change without restart, clear, damaged file failing closed. Every protected route answers `PROJECT_LOCKED` until unlocked: book API reads and writes, project context, legacy documents. Listings stay marked, other books stay open, JSON and same-origin rules hold |
| `corepack pnpm run test:frige` / `test:pantheon` | 149 / 29 passed |
| Headless Chrome through Pantheon and Frige (local, synthetic book) | 5 passed: the library shows "Password protected"; the workstation shows only the prompt, focused; a wrong password shows a message; the right password reloads into the loaded book; the unlock cookie is not readable by page script |
| VM install and protection (loopback) | Installed with health and gate checks. The access file is mode 600 and owned by the service user. The book API and Igor context answer locked. A wrong password is refused; the right one unlocks. The other hosted book is unchanged |
| Public internet, signed in as a member | The book is locked until unlocked. A wrong password gets 403. The unlock cookie is `HttpOnly; SameSite=Strict; Secure`, path `/frige/`, 12 h. An unlock cookie without an account session gets 401. The unlocked book answers 200 |

An independent review found no route that opens a protected book without
the unlock. Its findings were fixed, redeployed and rechecked on the VM and
the public site:

- **Parallel guesses evaded the limit.** Attempts now run one at a time per
  project and are counted first; 30 parallel guesses give 10 checks and 20
  refusals.
- **Clear-then-set revived old cookies.** A cleared password now keeps its
  version.
- **A missing record switched protection off.** It now refuses everything
  with 503.
- **The legacy listing exposed author and description.** It now keeps only
  the title.
- **Running the tool as root broke Frige.** The tool now refuses to run as
  root.

Remaining, by design or low:

- the nightly backup contains the record's signing secret (backups are
  root-only);
- legacy document routes through `/api/books` cannot be unlocked;
- Igor shows a protected source as "unavailable" rather than "password
  protected";
- the limit is per project, so wrong guesses by one account pause the owner
  too.

## Limits

- A signed-out visitor always lands on Igor after signing in, not on the
  page they asked for.
- Frige state is single-user: every account sees and edits the same books.
- The local copy of the manuscripts is no longer canonical; edits made
  locally do not reach the VM.
- The release was built from a working tree with uncommitted changes
  (generation 0, labelled `-dirty`); there is no CI build or automatic
  deploy for the suite release yet.
- No live model turn was made for this verification. Frige editorial turns
  use the production inference service and are paid calls when used.
- Seaxneat and the Python platform API are not hosted.
