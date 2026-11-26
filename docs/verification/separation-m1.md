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
`STEX_KNOWLEDGE_SERVICE`, give Pantheon the same data directory). Open gate:
the knowledge routes have contract READMEs but no JSON Schemas and are not in
the generated OpenAPI document.

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
| STEX profile script | 62 settings from `deploy/hermes/apply-igor-profile.sh` applied; only `gateway.standalone` unrecognised, **on both revisions** (pre-existing: production sets a key Hermes does not read) |
| Official connector | `obsidianmd/obsidian-skills` (the `obsidian` entry of Hermes's plugin catalog; Obsidian's 1.2.3 README names Hermes's catalog entry), pinned `a53f5910` = tag `1.2.3`, tier verified. The release's bundled catalog pins `1.2.1`; the three skills are identical between them. Not the older built-in `obsidian` skill nor the third-party `obsidian-memory`/`obsidian-rag` entries |
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

- No independent review yet; owner review requested.
- Hosted sign-in and the VM were not exercised. No live model or provider call.
- The Igor branch is local; pushing it to Igor `main` deploys, so it is not pushed.
- The containers use Debian TeX packages matching the VM list, not the VM itself.
