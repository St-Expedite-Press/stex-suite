# Director proposals — Wave 4b evidence

**Objective:** a Frige conversation can end in a real proposal from the
director, through `stex.hermes.turn.v1`, which the author accepts or rejects
as a change contract. Until this change only Frige's deterministic simulator
proposed anything. Decision [D-017](../program/DECISIONS.md); specification in
[the master plan](../program/MASTER-PLAN.md#wave-4-specification--proposals-from-a-real-director).

**Status:** released. stex-igor `main` was fast-forwarded to `bd8b3b0` and
deployed on 2026-11-20 with the owner's authorization ([the release](#release-2026-11-20)).
The first owner-approved live turn (W4-c) showed Grok writing a correct
proposal but exceeded the 30-second budget; the owner raised the budget to
120 seconds ([D-018](../program/DECISIONS.md)) and had abandoned turns stop
([D-019](../program/DECISIONS.md)). The second live turn (W4-f), after the
release, carried a director proposal into Frige as a change contract that the
author accepted byte-exact; see [the second live turn](#second-live-turn-w4-f).

| Item | Value |
| --- | --- |
| stex-igor branch | `feat/director-proposals` (local): `7f03c7e`, `ca499bc`, `07a931f`, on `feat/agent-config` |
| Suite branch | `feat/director-proposals` (local), from `main` at `51577f1`: comments, protocol notes and program records |
| Date | 2026-11-19 |
| Environment | Windows 11, Node 24.18 |
| Data | Disposable synthetic book and state directories; stub Hermes on loopback; catalog fetching off |

## What changed

| Area | Paths | Change |
| --- | --- | --- |
| Hermes client (stex-igor) | `services/inference/src/hermes-client.mjs` | `turn()` takes trusted `instructions` from the service's own adapters and places them in the system envelope, before the untrusted context. A request body cannot supply them |
| Adapter (stex-igor) | `services/inference/src/texgraph-adapter.mjs`, `src/app.mjs` | Scope turns send `SCOPE_TURN_INSTRUCTIONS`. `directorProposal` reads the reply's one `stex-proposal` block into `changes` or `layout`, bounded to offered pieces and override settings, and says what it set aside. A fence counts only at the start of a line. A reply cut short at its output limit proposes nothing, and neither does a simulated reply. `meta.model` names the model the turn requested, and `meta.taskId` its task |
| Docs (stex-igor) | `services/inference/README.md` | The proposal format and what is set aside |
| Suite | `protocol/hermes/README.md`, `apps/frige/server.mjs` and `src/inference-client.mjs` (comments only), program records | The note on director proposals; D-017; the Wave 4 specification |

Frige's behaviour is unchanged. It already validated `changes` and `layout`
from any gateway reply.

## Acceptance criteria and evidence

| Criterion | Evidence |
| --- | --- |
| A director proposal becomes a change contract that names the model asked to propose | End-to-end "a change contract was created", "the contract records the model that proposed" (`origin.model` is `x-ai/grok-4.7`, the requested task model; transport `remote`) |
| Nothing is written before acceptance; the accepted text is written byte-exact, with indentation and Unicode | End-to-end "nothing is written before acceptance", "the accepted text is written byte-exact"; adapter test on whitespace and Unicode |
| Changes to pieces the turn did not offer are refused, and the reply says so | Adapter test; end-to-end "a proposal for an unoffered piece creates no contract and says so" |
| A layout change is read only in a section or piece conversation, with override settings only | Adapter test; end-to-end "a whole-book layout proposal is set aside" |
| An unreadable proposal proposes nothing and the reply says why | Adapter test: not JSON, not an object, cut off, two blocks, empty |
| The fence label quoted in prose or inside a piece is not taken for a block | Adapter test |
| A reply cut short at its output limit proposes nothing and says so | Adapter test; server test with a stub reply that ends `length` |
| The instructions sit before the untrusted context, and generic Igor turns never carry them | Inference server test |
| A simulated reply is never labelled with a real model and never proposes, even when the author types a block | Fake-transport server test (`stex.hermes.fake`, `requestedModel` only; echoed block ignored) |
| Existing suites pass | Commands below |

## Commands and results

| Command | Result |
| --- | --- |
| stex-igor `corepack pnpm test` (after the round-2 fixes, `07a931f`) | Passed: Igor 40, inference 52 (ten new), Hermes 12, design system 8; none skipped |
| End-to-end script (stub Hermes → inference, remote transport → Frige, synthetic book), before and after the fixes | 13 of 13 both times |
| Suite `corepack pnpm test`, with the stex-igor checkout on `feat/director-proposals` | Passed: 298 Node tests, 0 failed, 0 skipped (Frige 131); mypy clean; 64 pytest |
| `node --check` on the touched modules, `git diff --check` in both repositories | Clean |
| Time budget raised to 120 seconds (D-018): stex-igor `79d7f04` and the suite's Frige page-turn wait | stex-igor `corepack pnpm test`: Igor 40, inference 54 (two new tests that pin the director budget and the default cap), Hermes 12, design system 8. Frige 131. The pins test now compares the refusal rule's two copies without line endings, which failed spuriously on a Windows checkout |
| Streaming turns, request-id replay and per-product turn limits (D-019): stex-igor `9972d2a` | stex-igor `corepack pnpm test`: Igor 40, inference 62 (eight new tests against a loopback SSE server that observe the connection closing), Hermes 12, design system 8. One independent review round: two Medium findings (idempotency lost on streaming requests; wider concurrency under an unchanged setting) fixed or recorded as D-019; four Low findings fixed; three notes documented |

The end-to-end script is a throwaway file outside the repositories, by the
Frige charter's rule against committed throwaway scripts. Its checks are
listed in the acceptance table.

## Independent review

**Round 1** (separate reviewer agent, with reproduction scripts): no
Critical or High findings. The fixes are in stex-igor `ca499bc`.

| Finding | Disposition |
| --- | --- |
| Medium: the turn's 30-second time and 20,000-character output budget are small for whole-piece replacements | Budgets kept: widening one is the owner's decision. The instructions ask the director to describe, not propose, a change whose text would not fit. Recorded under limits |
| Medium: a reply cut short at its output limit could still yield a proposal | Such a reply proposes nothing, and the commentary says so |
| Low: the fence label quoted in prose or in a piece was taken for a cut-off block | A fence counts only at the start of a line |
| Low: the fake transport echoed a block the author typed back as a proposal | A simulated reply never proposes |
| Low: a summary clipped at 500 could split a surrogate pair | Clipped by code point |
| Low: "the model that answered" overstated what is known | Described as the model the turn requested; Hermes's reply names only its gateway |
| Note: a reply with both text and layout changes passes both to Frige, which sets the layout aside with its reason | Accepted: Frige gives the reason |
| Note: the stored reply has its block removed, so the next turn cannot see the exact proposal | Accepted; Frige keeps the contract, and the visible diff is the record |

**Round 2** (same reviewer, final round): fixes for findings 2, 3, 4 and 6
confirmed; finding 1 accepted as a limit. No Critical, High or Medium
findings. Its findings were repaired in stex-igor `07a931f` without a third
review, verified by tests:

| Finding | Disposition |
| --- | --- |
| Partial (#5): Frige clips summaries by UTF-16 unit, so a 500-code-point summary could still be split there | The adapter clips to 500 units without splitting a pair |
| Low: a fence after other text on its line was lost silently, with its JSON shown as prose | The reply says the block did not start on a line of its own |
| Low: a block written on one line stayed visible beside the notice | Stripped from the prose |
| Low: a block whose closing fence never matches removes the prose after it (as before) | Accepted: the reply says the block was cut off |
| Note: CRLF replies left a stray carriage return | Fixed |

## Live turn (W4-c)

**Approval:** the owner approved one paid turn with a $1 ceiling, run before
the stex-igor release by tunnelling to the production Hermes gateway over the
operator's SSH access. Nothing was deployed and nothing on the VM was
changed. The gateway key was read into the test process's memory only.

**Path:** real Frige → this branch's inference service (remote transport) →
a recording proxy that forwarded at most one call → production Hermes
(pinned `e76fbd80`) → OpenRouter. The book was the disposable synthetic
fixture: one six-line poem with an indented line and an em dash. The author
asked for one more closing line, keeping every existing line.

| Check | Result |
| --- | --- |
| Exactly one call reached the gateway, with `model` `x-ai/grok-4.7`, `provider` `openrouter`, and the trusted instructions | Passed |
| The deployed Hermes honoured the per-request model | Passed: its log shows the turn on `x-ai/grok-4.7` through OpenRouter, so per-request routing works on the deployed pin |
| Grok followed the proposal format | Passed: one line of prose, then one `stex-proposal` block naming the offered piece |
| Grok copied every unchanged line exactly | Passed: the proposed text is the original byte for byte, indentation and em dash included, plus one new line |
| The reply was not cut short | Passed: `finish_reason` `stop`; one model call, 2,991 input and 1,770 output tokens (mostly reasoning); a 374-character reply |
| The turn finished within the 30-second budget | **Failed:** the model call took 31.7 s and Hermes answered at 32.3 s. The inference service had already returned "Hermes did not answer before its budget expired"; Frige saved the message, changed nothing and created no contract |
| Grok's exact reply becomes a contract that is accepted byte-exact | Passed by replay: the captured reply, served by a stub through the same inference service and Frige, made a contract recording `x-ai/grok-4.7`, wrote nothing before acceptance, and wrote the accepted text byte-exact (10 of 10). The synthetic fixture's node id is deterministic and matched the live one |

**Cost:** about $0.02 at OpenRouter's listed Grok 4.7 prices: the main call,
plus one small title-generation side call. That side call also ran on paid
Grok, because production's side models are pinned only once the release's
profile setup runs. No retry was made. The turn left one session holding
only synthetic text in production Hermes's session store.

**Findings:**

- The 30-second turn budget is too short for Grok 4.7, even for a six-line
  piece: its reasoning alone took about 30 seconds. The scope turn sets 30
  seconds in `texgraph-adapter.mjs`, and the service caps every turn at 60
  seconds unless configured otherwise. Raising either is the owner's
  decision. Frige already waits up to 300 seconds.
- A timed-out turn is still paid for. Hermes finished the model call after
  the inference service had stopped waiting, so the answer was discarded but
  billed. Fixed by [D-019](../program/DECISIONS.md): turns now stream, and a
  closed stream makes Hermes stop the turn.

## Release (2026-11-20)

**Approval:** the owner authorized the merge, the release and one paid test
turn ("merge, release, test", 2026-11-20).

| Step | Result |
| --- | --- |
| Skill procedure (stex-igor PR 3) merged into the release branch | `bd8b3b0`; stex-igor `corepack pnpm test` passed (Igor 40, inference 62, Hermes 12, design system 8; none skipped); `typecheck:igor` clean; branch and PR CI green |
| Pre-release check | The host's inference configuration sets no turn-time cap, so the new 120-second default applies |
| Rollback readiness | The previous release (`d0598d8`) stays installed beside the new one; the Igor Hermes profile configuration was copied before the change |
| Release | stex-igor `main` fast-forwarded `d0598d8` → `bd8b3b0`, so PRs 2 and 3 show as merged. The deploy workflow passed its tests, build, install and health check and verified the active release commit |
| Operator steps | `deploy/hermes/apply-igor-profile.sh` from `bd8b3b0` (byte-identical to the commit, checked by hash) run as root, then Hermes restarted. Igor's default model is now `x-ai/grok-4.7`; compression `x-ai/grok-4.20`; titles `x-ai/grok-4.3`; vision, background review and delegation `x-ai/grok-4.7`; no fallback providers, no mixture-of-agents preset, CLI and API toolsets empty, terminal network off |
| Health after release | All three services active; the inference service reports `remote`, `chat-completions` and `agentConfig: ok`; the Hermes gateway answers; Igor and the public address redirect to the sign-in page |

## Second live turn (W4-f)

**Path:** as for the first live turn, after the release: real Frige (suite
`feat/director-proposals`) → the inference service at the released `bd8b3b0`
(remote transport) → a recording proxy that streamed through at most one
call → production Hermes → OpenRouter. Same synthetic poem and request. The
gateway key was read into the test process's memory only.

| Check | Result |
| --- | --- |
| Exactly one call reached the gateway, with `model` `x-ai/grok-4.7`, `provider` `openrouter` and the trusted instructions | Passed |
| The turn streamed (D-019) | Passed: `stream: true` requested, `text/event-stream` answered, and the service read the stream to its finish chunk |
| The reply was not cut short, within the 120-second budget | Passed: `finish_reason` `stop` after 29.2 s; 2,991 input and 1,580 output tokens |
| Frige made a change contract that records the requested model | Passed: one change for the offered piece, `origin.model` `x-ai/grok-4.7`, transport `remote` |
| Every unchanged line was copied exactly, in order | Passed: the original six lines byte for byte, plus one new closing line |
| Nothing was written before acceptance; the accepted text was written byte-exact | Passed |

14 of 14 checks passed. **Cost:** about $0.03 at OpenRouter's listed Grok
4.7 prices, plus one title side call, now pinned to Grok 4.3. No retry was
made. The turn left one session holding only synthetic text in production
Hermes's session store.

## Limits

- **Two live turns only.** Grok followed the format and copied unchanged
  lines exactly twice, on the same six-line poem. Reliability on long or
  difficult pieces is unmeasured. Frige's visible diff and the author's
  acceptance remain the safeguard.
- **The time budget is now 120 seconds** ([D-018](../program/DECISIONS.md)):
  the inference service's director turns ask for it, the service's default
  cap admits it, and Frige's page turn waits 150 seconds. The second live
  turn finished in 29 seconds.
- **Abandoned turns stop, within about ten seconds**
  ([D-019](../program/DECISIONS.md)). Remote turns stream; a timeout,
  cancellation or oversized answer closes the stream, and the pinned Hermes
  interrupts the agent at its next write (a keepalive at most ten seconds
  later). Tokens produced before then are billed. A completed streaming turn
  ran against the real Hermes (W4-f); an abandoned one has been tested only
  against a loopback stand-in.
- **Up to three paid turns can run at once,** one per product, where there
  was one in total (D-019).
- **The output budget is unchanged:** 20,000 characters of
  output (counted as JSON). Each proposal carries the whole new text of a
  piece, so a piece longer than roughly 15,000 characters cannot be
  proposed in one reply. A reply cut short proposes nothing and says so. A
  reply over the output budget fails the turn with
  `HERMES_OUTPUT_TOO_LARGE`. Widening it is the owner's decision. Frige itself allows 400 KB pieces and
  waits up to 300 seconds.
- **The recorded model is the one requested.** If OpenRouter substituted
  another model, the contract would not show it, because Hermes's reply
  names only its gateway.
- **The format is a convention, not a schema the model is held to.** A
  model that writes the block differently proposes nothing, and the reply
  says so.
- **Specialists stay parked.** Bounded specialist investigation is not part
  of this slice.
