# The Company: agent configuration — Wave 4a evidence

**Objective:** the user configures the team, which is the eight native Hermes
profiles, as a game of building a company:
- each member's persona: name, title, sigil, temperaments and voice;
- each member's loadout of skills;
- the model each task uses, chosen from OpenRouter's live catalog, with
  Grok by default.

It is one shared capability hosted on the VM, opened from the command
center and from each application's menu. Owner decision
[D-016](../program/DECISIONS.md); specification in
[the master plan](../program/MASTER-PLAN.md#wave-4a-specification--the-company-agent-configuration);
contract `stex.hermes.agent-config.v1`
([protocol](../../protocol/hermes/README.md#agent-configuration-v1)).

**Status:** implemented and tested locally, with two independent review rounds.
Not pushed to `main`, not merged, not deployed. No live provider or Hermes
call was made.

| Item | Value |
| --- | --- |
| Suite branch | `feat/frige-change-contracts` (draft PR 6) |
| stex-igor branch | `feat/agent-config` (local), on `a8880aa` |
| Dates | 2026-11-18 to 2026-11-19 |
| Environment | Windows 11, Node 24.18, headless Chrome |
| Data | Disposable state directories; fake and stub Hermes transports; catalog fetching off or faked |

## What changed

| Area | Paths | Change |
| --- | --- | --- |
| Contract | `protocol/hermes/agent-config.v1.schema.json`, `protocol/hermes/README.md` | The document, update, catalog and history shapes; rules; task ids; errors |
| Owner (stex-igor) | `services/inference/src/{app,agent-config,model-catalog,state-files,profile-facts,settings}.mjs`, `server.mjs`, `src/hermes-client.mjs`, `src/texgraph-adapter.mjs` | The configuration store, serialized and atomic, fails closed. Also: revision checks; history with self-repair and rotation; the filtered and cached catalog; refusal of Claude and router models; owner-only saves; per-request `provider` and model; Igor's persona sent as a system message followed by the fixed boundaries; `agentConfig` reported in health |
| Hermes pins (stex-igor) | `deploy/hermes/apply-igor-profile.sh`, `deploy/hermes/agent-config-pins.mjs`, `hermes/test/apply-igor-profile-pins.test.mjs` | Grok defaults and every auxiliary task pinned. No fallback providers or multi-model presets. Stored choices are applied after validation, and nothing is applied on a refusal |
| VM operations (stex-igor) | `deploy/backup/stex-backup.sh`, `deploy/staging/setup-staging.sh`, `deploy/env/*.env.example`, `docs/operations/hosted-igor.md` | Backup, restore and staging cover the new state directory |
| Screen (stex-igor) | `apps/igor/server.mjs`, `server/{inference,company}.mjs`, `src/team/*`, `src/chat/*`, `src/App.tsx`, header, `src/styles/igor.css` | "The Company": roster, a character sheet (Persona, Loadout, Mind, Quests), the quest board, the save bar and the chronicle. The relay requires sign-in, only the owner may save, and others see it read-only |
| Entry points (suite) | `apps/pantheon/server.mjs`, `src/pages.mjs`, `public/shell.css`, `workspaces/frige/*`, `workspaces/seaxneat/*`, `scripts/verify-{frige,home}.mjs` | A global "Company" link and the `/igor/team` route; Frige's dead model dialog replaced by a link; a Seaxneat link |
| Rules | Root `AGENTS.md` in both repositories; Igor, inference, Frige and Pantheon charters | One owner, Grok by default, Claude and routers refused, configuration grants nothing, only the owner saves, every change checked and recorded |

## Acceptance criteria and evidence

| Criterion | Evidence |
| --- | --- |
| Choosing a model for a task changes the model sent on the next turn | Inference tests (fake transport records the upstream body); end-to-end step "next piece turn uses the chosen model" |
| Claude and self-routing models are refused everywhere | Inference refusal and catalog tests; pins test; end-to-end "Claude refused"; review round 2 reproduction for `openrouter/auto` |
| A stale save is refused; edits survive it | Inference 409 test; Igor rebase test; browser smoke "stale save keeps the edits" |
| Parked members stay parked; configuration grants nothing | Inference document and validation tests; end-to-end "specialists parked" |
| Only the owner saves | Igor relay tests in password, Access and local modes; inference test for the missing role |
| Every accepted change is recorded, even after a failed append | Inference history tests (directory in place of the file, repair, rotation) |
| The screen works by keyboard, at phone width, honestly | Igor browser smoke (40 checks at 360, 768 and 1440 px, including read-only mode) |
| The command center and app menus open it | Pantheon server tests; `verify:home` (nine sizes); `verify:frige` (the settings menu link) |
| Existing suites pass | Commands below |

## Commands and results

Final run, 2026-11-19, after the round-2 fixes:

| Command | Result |
| --- | --- |
| stex-igor `corepack pnpm test` | Passed: instructions; Igor 40, inference 42, Hermes 12, design system 8; none skipped (the shell handoff test runs through Git Bash) |
| stex-igor `typecheck:igor`, `build:igor` | Passed (an existing warning about a large chunk) |
| Suite `corepack pnpm test` | Passed: 288 Node tests, 0 failed, 0 skipped; mypy clean; 64 pytest; stex-igor copies match |
| Suite `build:pantheon` | Passed |
| Suite `verify:frige` | `PASS: platform publishing workflow, real proof, five viewports` |
| Suite `verify:home` | Passed at nine sizes, with the Company link in the keyboard order |
| End-to-end script (Pantheon → Igor → inference, disposable state) | 12 of 12 |
| Igor browser smoke script (headless Chrome, owner and member) | 41 of 41 |
| `git diff --check` (both repositories) | Clean |

The end-to-end and smoke scripts are throwaway files outside the
repositories, by the Frige charter's rule against committed throwaway
scripts. Their checks are listed in the acceptance table.

## Independent review

**Round 1** (separate reviewer agent, with reproduction scripts): one High,
four Medium and eight Low findings, plus one note on existing code.

| Finding | Disposition |
| --- | --- |
| **High:** router models such as `openrouter/auto` passed the Claude filter and could pick Claude | Routers refused by id and by catalog name, everywhere the Claude rule applies |
| Medium: any signed-in user could change the shared configuration | Only the owner saves (Igor relay, and the inference service as defence in depth); others see it read-only |
| Medium: a failed history append reported a stored save as failed | The change is stored with the configuration; the history repairs itself |
| Medium: some settings looked effective but were not | The profile setup now applies the stored side-model and default choices; the screen says where each setting takes effect |
| Medium: the production state directory could be unset | Defaults to `/var/lib/stex/inference` for the remote transport |
| Low: auxiliary tasks not all pinned; weak pins test | All 19 pinned; every model line checked; the list is cross-checked with the pinned Hermes |
| Low: corrupt configuration invisible to health checks | `agentConfig` is reported by inference health and Igor readiness |
| Low: body limit too small for non-ASCII voices; boundaries hidden; a successful save could show as failed; a Back-cancel added a history entry; unbounded history | Each fixed |
| Low: Pantheon's current-page marker lags in-app navigation | Accepted as a limit |
| Note: Frige's server still relays the retired settings routes | Accepted: a published facade, and nothing calls it |

**Round 2** (same reviewer, final round): round-1 findings confirmed fixed,
#1 and #3 by rerunning the reproductions. No Critical or High defects. Its
findings were repaired without a third review, verified by tests:

| Finding | Disposition |
| --- | --- |
| Partial (#4): Igor's default model read as if it changed Igor's turns | The screen says it is Hermes's default for sessions outside STEX |
| Partial (#7): Igor readiness ignored a corrupt configuration | Igor readiness reads `agentConfig` |
| Low: refusal rule misses some router names | Broadened to any `route`, `router` or `routing`, and `auto` as a word or variant |
| Low: a refused save trapped the user's edits | Discard stays available in read-only mode |
| Low: the inference service did not enforce the owner rule | It refuses saves without `x-stex-actor-role: owner` |
| Low: the shell handoff test skipped without `bash` on PATH | It finds Git Bash, or says what is missing |
| Low: a stored id refused by a later, stricter rule makes the configuration untrusted | Accepted: it fails closed and affects only earlier development data; the operator edits the file |

## Limits

- **Nothing ran against a real Hermes, OpenRouter or the VM.** That covers
  the persona system message, per-request models, the profile setup script,
  backup and staging. The script ran only with a stub `sudo`; the backup
  script was syntax-checked only (it needs Linux).
- **Only Igor's persona reaches Hermes.** Specialists are parked: their
  personas, loadouts and default models are recorded for when they are
  activated. Equipped skills are recorded but not installed into Hermes.
- **Side-model and default-model choices apply at the next profile setup,**
  which the operator runs on the VM, followed by a Hermes restart.
- **The refusal rule is deliberately broad,** so some legitimate models
  whose names contain "route" or "auto" are refused.
- **The deploy helper keeps a tested copy of the service's rule,** because
  the release layout cannot share the module.
- **Pantheon's current-page marker** updates only on a full page load.
- **The screen's wording** (titles, sigils, temperaments) is a draft for the
  owner to review.
