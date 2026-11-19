# Director proposals — Wave 4b evidence

**Objective:** a Frige conversation can end in a real proposal from the
director, through `stex.hermes.turn.v1`, which the author accepts or rejects
as a change contract. Until this change only Frige's deterministic simulator
proposed anything. Decision [D-017](../program/DECISIONS.md); specification in
[the master plan](../program/MASTER-PLAN.md#wave-4-specification--proposals-from-a-real-director).

**Status:** implemented and tested locally against a stub Hermes. Not
pushed, merged or deployed. No live provider or Hermes call was made.

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

## Limits

- **Nothing ran against a real Hermes or a real model.** Whether Grok
  follows the format reliably, and copies unchanged lines exactly, is
  unproven until a live turn, which needs the owner's approval and a budget.
  Frige's visible diff and the author's acceptance remain the safeguard.
- **Budgets are unchanged:** a 30-second turn and 20,000 characters of
  output (counted as JSON). Each proposal carries the whole new text of a
  piece, so a piece longer than roughly 15,000 characters cannot be
  proposed in one reply. A reply cut short proposes nothing and says so. A
  reply over the output budget fails the turn with
  `HERMES_OUTPUT_TOO_LARGE`, and a slow reply times out. Widening either
  budget is the owner's decision. Frige itself allows 400 KB pieces and
  waits up to 300 seconds.
- **The recorded model is the one requested.** If OpenRouter substituted
  another model, the contract would not show it, because Hermes's reply
  names only its gateway.
- **The format is a convention, not a schema the model is held to.** A
  model that writes the block differently proposes nothing, and the reply
  says so.
- **Specialists stay parked.** Bounded specialist investigation is not part
  of this slice.
