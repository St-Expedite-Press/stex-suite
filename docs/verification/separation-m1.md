# Separation milestone 1 (local candidate)

2026-11-26. Owner-authorized local milestone: separate Pantheon, Frige and
the Python platform locally; move knowledge server behaviour behind FastAPI;
add approved-excerpt passages and private contributions; evaluate a Hermes
upgrade and the official Obsidian connector in isolation. Nothing was pushed,
merged, deployed or run against the VM, a real vault, real books or a provider.

Base: suite `9c4f77c`, Igor `0455f82`, Hermes pin `e76fbd80`. Work is on the
local branch `feat/separation-m1` in both repositories (a separate worktree;
the uncommitted Frige workstation work in the main checkout is untouched).

## 1. Containers and the Python split

| Check | Result |
| --- | --- |
| `deploy/staging-compose`: Pantheon, Frige, platform as separate containers; only Pantheon published, on `127.0.0.1:4300`; Frige and platform on an internal network | Running; `scripts/verify/verify-staging-compose.mjs` 15/15 |
| Existing UI through the new path: command centre, splash, Frige library and workstation, platform project list, Graph | Served through the single port |
| Real LuaLaTeX proof inside the Frige container | `%PDF-` returned (7,855 bytes, synthetic book) |
| Recreate Frige without restarting Pantheon | Attachment bytes, proof and knowledge access survive; Pantheon start time unchanged |
| Knowledge through FastAPI | Pantheon has no journal directory and no journal file; the platform container holds it |
| Node/Python journal parity (`backend/tests/test_knowledge_parity.py`) | 15 operations: results, error codes, views, fingerprints and journal bytes match (generation and times excepted); each runtime replays the other's journal |
| Existing Graph UI, real Chrome, both paths (`verify-knowledge.mjs`, with and without `--platform`) | PASS both: accept, infer, reject, withdraw, renew, stale refusal, restart replay, export without text, erase, four widths without overflow |
| Native defaults | Unchanged: `test:pantheon` 42, `test:frige` 197, `test:knowledge` 27 |

Container mode is opt-in (`STEX_BIND_ALL`, `STEX_INTERNAL_HOSTS`); hosted
Pantheon refuses it. Hosted sign-in was **not** exercised in containers: the
stack runs Pantheon in local mode. Hosted knowledge identity was tested in
the platform API with actor headers as Pantheon sends them
(`backend/tests/test_knowledge_api.py`) and the relay's header handling in
`apps/pantheon/test/container-mode.test.mjs`.

Still on Node: Pantheon (shell, hosted gate, proxy, knowledge relay), Frige,
Seaxneat, Igor, inference, and the Node knowledge library (native default and
rollback path). Rollback of the knowledge move is configuration only (unset
`STEX_KNOWLEDGE_SERVICE`, give Pantheon the same data directory). The schema
gap noted in the first pass is closed in the hardening pass (section 4).

## 2. Passages and private contributions

`scripts/verify/verify-passages.mjs` (real Frige, platform API, Igor; recording
stand-in for inference; synthetic data) — 11/11:

- a passage of an approved excerpt is found and its exact citation opened;
- alice approves it privately; a duplicate approval is refused;
- bob sees the shared Frige passage (Frige's sharing rule) but nothing of alice's
  approval in search marks, counts, listing, knowledge view, export, resolve or withdraw;
- Igor's real resolver resolves alice's contribution for alice only; Igor's secret opens no other route;
- a changed excerpt makes the contribution stale and unusable; restoring the bytes makes it current;
- withdrawal: resolve answers withdrawn and search stops marking it;
- after restart, withdrawal persists and replays cannot revive it;
- the ledger holds metadata only; the Node library still opens the journal;
- Igor resolved before the turn; the text reached only that request, labelled
  untrusted, never a pasted message or the stored conversation;
- after withdrawal the next turn excluded it; the earlier turn and reply were unchanged.

The shared `stex.project.context.v1` export is unchanged (asserted in
`apps/frige/test/passages.test.mjs`). Reader UI in Chrome
(`verify-passages-browser.mjs` against the containers): search, citation with
all fields, focus moved to the citation, private approval, withdrawal text,
four widths without overflow — PASS. The check found and fixed a focus bug
(focus was attempted while the section was inert).

Unit coverage: `backend/tests/test_contributions.py` (2),
`stex-igor/apps/igor/test/knowledge.test.mjs` (3), `apps/frige/test/passages.test.mjs` (2).

## 3. Hermes and Obsidian

`stex-igor/hermes/eval/run-eval.mjs` (Docker, disposable volumes, uid 1000, all
capabilities dropped, `--network none` except the connector's git clone) — PASS:

| Check | Result |
| --- | --- |
| Candidate | Hermes `v0.23.4` (`8fc0374`, 2026-11-23, latest stable; reports `2026.9.24`); the current pin `e76fbd80` is its ancestor |
| STEX pins | `hermes/test` 14/14 with the `v0.23.4` checkout, including the cross-check that every upstream auxiliary task is pinned to Grok (the task set is unchanged) |
| STEX profile script | 62 settings from `deploy/hermes/apply-igor-profile.sh` applied. `hermes config set` warns that `gateway.standalone` is unrecognised on both revisions, but the gateway reads it (`profile_is_standalone`, `gateway/run.py`): it keeps the `igor` profile out of the host multiplexer. It is live, marked upstream as a temporary compatibility shim. *Corrected in the hardening pass; the first pass wrongly called it unread.* |
| Official connector | `obsidianmd/obsidian-skills`, the `obsidian` entry of Hermes's plugin catalog. Pinned at `b110b2f8e9eb1f287892f937050dfd40af862cbb` (`1.2.1`), the SHA in the tagged `v0.23.4` catalog; the first pass used `1.2.3` from the live catalog. The three enabled skills are identical in both. Installs always pass the SHA with `--ref`. Not the older built-in `obsidian` skill nor the third-party `obsidian-memory`/`obsidian-rag` entries |
| Skills | `obsidian:obsidian-markdown`, `obsidian:obsidian-bases`, `obsidian:json-canvas` load through `skill_view` (no preprocessing) and the system-prompt skill index; `obsidian-cli`, `obsidian-headless`, `defuddle`, `knap` and the built-in `obsidian` are disabled and do not load (Hermes warns `skills.disabled` is unrecognised but enforces it) |
| Isolation | Network blocked; root filesystem and fixture vault not writable; vault readable; uid 1000; CLI and API toolsets `[]` |
| Restart | Same skill results and settings from persisted state |
| Document worker coupling | `run_agent.AIAgent` (all 15 keyword arguments), `run_conversation`, MCP registration present on both; `services/inference` document tests 27/27 on Linux against each revision |
| Upgrade and rollback | State made by `e76fbd80` (profile, 62 settings, a synthetic session) opened by `v0.23.4`, then by `e76fbd80` again: session, settings and SQLite integrity preserved; schema `user_version` 0 throughout. `e76fbd80` also lists the candidate-installed plugin |

Read-only note import into Pantheon (one linked fixture note, bounded
retrieval) is done by the platform API (`stex.knowledge.notes.v1`), verified
through Pantheon in the staging stack, not by Hermes.

Limits: plain uv environments, not upstream's `pm`-managed install the VM uses;
no model turn; production keeps `e76fbd80` and installs no plugin. The Igor
branch moves the `runtime/hermes-agent` gitlink to `v0.23.4`; merging it is a
separate, authorized release.

## Commands run

`corepack pnpm run test:platform` (ruff, format, mypy strict, pytest: 85 passed,
1 skipped on Windows — the symlink case, which was then run on Linux in the
platform container: file and directory links refused), `test:pantheon`,
`test:frige`, `test:knowledge`, `test:igor`, `test:setup`, `test:assets`,
`test:design-system`, `test:inference`, `test:seaxneat`, `test:hermes`,
`test:stex-igor-sync`, `test:instructions`; `stex-igor`: `corepack pnpm test`.
One Frige real-proof test failed once with a Windows `EBUSY` while removing a
temporary build folder and passed on two reruns (pre-existing timing).

## Limits

- First pass: no independent review (done in the hardening pass, section 4).
- First pass: hosted sign-in not exercised (done in staging, section 4). The VM
  was never touched. No live model or provider call in either pass.
- The Igor branch is local; pushing it to Igor `main` deploys, so it is not pushed.
- The containers use Debian TeX packages matching the VM list, not the VM itself.

## 4. Hardening pass (2026-11-26/27)

Independent review: a separate read-only reviewer agent reviewed both diffs
against their baselines (suite `9c4f77c..ae2e7cc`, Igor `0455f82..671b380`).
It found no blocker for a local milestone. Findings, checked against the code,
and their outcome:

| Finding | Outcome |
| --- | --- |
| Erase left note metadata; a failure between steps could leave contributions resolvable | Fixed (`eba51a1`): everything is checked first, ledgers cleared before the journal |
| A native (Node) erase left contributions to be revived on the platform path | Fixed (`eba51a1`): each ledger is bound to the journal generation; a test runs the real Node library's erase |
| A crash left a lock naming PID 1 that blocked the containerised platform forever | Fixed (`f9d14ee`) |
| A hosted Pantheon over a local-mode platform shared one journal | Fixed (`33196b3`): `KNOWLEDGE_MISCONFIGURED` |
| The Igor gitlink moved while the manifest and runtime docs still named `e76fbd80`; the branch tip failed the gitlink test | Fixed (Igor `cf434ac`). The first pass's "Igor gate passed" ran before the gitlink was committed |
| A conversation with project context and knowledge opened an unused document grant | Fixed (Igor `ab11074`) |
| Passage cuts could split a surrogate pair; search echoed Frige's project object | Fixed (`4f8ca13`) |
| The Igor secret limits the route, not the person | Accepted: Igor owns accounts; the secret opens only `POST /contributions/resolve` |

Contracts: JSON Schemas at the owning boundaries
(`protocol/knowledge/{api,contributions,notes}.v1.schema.json`,
`protocol/frige/passages.v1.schema.json`). All 17 knowledge routes are in the
generated OpenAPI. `backend/tests/test_knowledge_contract.py` fails when the
README tables, route list, schemas and OpenAPI drift (confirmed by mutation),
and validates success, invalid input, stale revision, unauthorized and
disabled responses. Frige's own test validates its real passage responses.

| Proof | Result |
| --- | --- |
| `verify-knowledge-rollback.mjs` (real Frige and platform, the Node library as Pantheon hosts it) | PASS. Node → FastAPI (a contribution made, another withdrawn) → restart → Node → FastAPI → Node erase → FastAPI. Journals read identically both ways; contribution files byte-identical through the Node phase; nothing revived; ownership unchanged; Node's erase honoured |
| `verify-staging-hosted.mjs` (TLS edge, real Igor password sessions) | PASS, 10 checks: only the edge published; signed-out redirects and 401s; foreign origin, wrong password and wrong Host refused; Secure HttpOnly session; refresh past the cache; cross-account isolation; peers with a loopback Host get nothing but `/healthz`; sign-out revokes; Frige proof and recreate while signed in |
| `verify-staging-igor.mjs` (managed Hermes install, recording fake provider) | PASS: exact pins; Markdown/Bases/Canvas load on the API profile, the four others do not; toolsets `[]`; no egress; a signed-in turn carried only the approved current passage (Grok model, no tools); withdrawal excluded it next turn; clean restart; rollback to `e76fbd80` and forward with the VM procedure |

Knowledge rollback preserves journals, contribution and note ledgers,
per-person directories and ownership. While on the Node path,
`/contributions*`, `/passages/*` and `/notes*` answer 404, Igor resolves every
contribution as `unavailable` (passages are not used; turns still run), and
nothing can be withdrawn until the platform returns. An erase made on the
Node path is honoured afterwards.

Findings that need an owner decision:

- **The Obsidian skills are installed but not active in Igor's turns.** With
  empty toolsets the API turn prompt carries no skill index. Activating them
  needs a skills toolset, which is a separate authorization.
- **The current production pin needs egress at every start.** `e76fbd80`
  re-resolves a GitHub-hosted wheel on every activation; `v0.23.4` activates
  with no egress. Rollback to `e76fbd80` therefore needs its egress
  allowlist; the staging rollback phase ran with outside network attached.
- **Switching runtimes needs an egress window both ways**: the managed install
  keeps its tool store beside the profile in `~hermes/.hermes`.
- **Auxiliary calls**: Hermes attempts auxiliary tasks against OpenRouter on
  Grok pins; staging blocked them. On the VM they are paid calls under the
  existing policy.

Known flakes and limits: one Frige real-proof test can fail with a Windows
`EBUSY` when removing a temporary build folder (passes on rerun); one image
build failed transiently during upstream's managed setup and passed on
rebuild; `cua-driver` (optional computer-use tool) fails its self-check in a
headless image and the installer skips it. The plain-venv harness
(`stex-igor/hermes/eval/run-eval.mjs`) was not rerun after the connector pin
changed to `1.2.1`; the staging Igor host supersedes it.

## 5. Proposed deploy order and rollback (not executed)

Nothing below is authorized. Each step is a separate approval.

0. **Precondition (separate approval item):** a fresh off-disk backup of
   Frige books and state, Igor data, inference state, the Hermes profile
   (`state.db`, `response_store.db`, `runs_idempotency.db`, config) and the
   knowledge journals and ledgers, restored on a disposable host and checked.
1. Merge the Igor branch (auto-deploys Igor and inference; the Hermes runtime
   is not changed by the gitlink). Knowledge stays unconfigured
   (`STEX_KNOWLEDGE_URL` unset), so contributions are inert.
2. Release Pantheon and Frige from the suite branch with
   `STEX_KNOWLEDGE_SERVICE` unset (native knowledge path, unchanged).
3. Deploy the platform API on loopback with hosted knowledge and both secrets;
   stop Pantheon, set `STEX_KNOWLEDGE_SERVICE=platform`, start. Never run both
   writers on one journal directory.
4. Set Igor's `STEX_KNOWLEDGE_URL` and secret to enable contributions.
5. Hermes `v0.23.4` (separate change): stop `hermes-igor`, lift the egress
   rule, `git checkout` the pin and `./setup-hermes.sh --runtime-only` as
   `hermes`, run `apply-igor-profile.sh`, restore egress, start, run a
   tool-negative turn. Install the connector with `--ref` only if the skills
   are to be activated, which is a further decision.

Rollback, in reverse: Hermes by the same checkout-and-setup procedure with
egress (the old pin needs its allowlist at every start); knowledge by
stopping the platform and Pantheon, unsetting `STEX_KNOWLEDGE_SERVICE` and
giving Pantheon the same data directory (contributions stay on disk and become
unavailable); Igor and Pantheon releases by their existing rollback-capable
installers.

## Decision

**Production: no-go** until the step 0 precondition is verified. The local
candidate is ready for owner review.
