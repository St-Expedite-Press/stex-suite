# Igor free mode, model prices and descriptions

**Date:** 2026-11-21. **Status:** implemented and tested locally on stex-igor
`feat/free-mode`; unreleased; one independent review round, findings fixed
except Hermes memory, which is a precondition for release (see the end).
**Decision:** [D-022](../program/DECISIONS.md).
**Contract:**
[`stex.hermes.agent-config.v1`](../../protocol/hermes/README.md#agent-configuration-v1)
(additive).

| Repository | Base | Branch and commits |
| --- | --- | --- |
| stex-igor | `1e2556a` (`feat/frige-passages`, on the deployed `c5af494`) | `feat/free-mode`: `f700fb0`, `25b3950` |
| stex-suite | `feat/frige-ui-passages` | Protocol and records |

## What the owner asked for, and what was built

| Request | Built |
| --- | --- |
| A free model mode | `freeMode {enabled, model}` in the company configuration, set from a row under Igor's conversation quest |
| Only Igor's conversational sandbox | Applies only to a generic Igor turn (`/v1/hermes/turn`, product `igor`) with no project sources. Every other turn stays paid: Frige's scope turns, the legacy page and interview turns, an Igor turn about a project, and other products |
| Frige never on free endpoints | Besides routing, a free model is refused for every paid task and default model, so no configuration can put a manuscript on one |
| Never Claude | Claude's free variants and `openrouter/free` are refused like every Claude model and router |
| See model pricing | Prices appear in every quest select, in a card under each quest, beside the member's default model, and in the catalog table |
| Hover a name for a short description | OpenRouter's description, reduced to at most 280 characters of plain text. It shows on hover and on keyboard focus of the name; in the catalog table, also on focus of the row's radio |

A design hazard found while building: Igor's conversation task is also the
fallback for unknown tasks, and Frige's legacy one-page and interview turns
map to it. Switching that task's model would have sent those manuscripts to
free endpoints. So routing depends on the turn's origin, which the inference
service knows, as well as on the task.

## Evidence

| Check | Result |
| --- | --- |
| stex-igor `corepack pnpm test` (main checkout) | Igor 42 (2 new), inference 70 (5 new), Hermes 12, design system 8; none skipped. After the review fixes: inference 73, Hermes 13 |
| `corepack pnpm run typecheck:igor`; `corepack pnpm build:igor` | Clean; built |
| Inference tests | Free-mode routing across every route: sandbox free; project, other-product, scope, page and interview turns paid. Refusals: paid model as free, free model for a paid task or a default, Claude free variant, the free router, enabling without a model. History lines; off keeps the model; reset clears it; an untrusted stored file gives 503 and the turn fails closed. Catalog marking and the description reducer |
| Igor screen tests | Draft, change text, partial update (only the changed field), rebase with a clash report, refusal placement, local check, price wording, and the paid/free split |
| Browser check (Chrome, real inference service fed a synthetic catalog, Igor in local mode; throwaway script outside the repositories) | 12 of 12: prices in paid selects; no free, Claude or router model in a paid select; quest card; description on hover, hidden on leave, shown on keyboard focus; free mode offers only the free endpoint; warning shown; save reaches the service; chronicle records it; a sandbox turn asks for the free model; a Frige turn keeps the paid model |

## Limits

- **Not released.** Hosted Igor runs `c5af494`; releasing `feat/free-mode`
  is a push to stex-igor `main`, which deploys and needs the owner.
- **No live free turn yet.** The free model is real only once a release
  serves OpenRouter's catalog and Hermes routes per-request models to it.
  Free endpoints may refuse or rate-limit; a failure is reported like any
  failed turn and never falls back to a paid model.
- **Hermes side calls stay paid.** Session titles, compression and the
  other auxiliary calls stay on their pinned Grok models, by the owner's
  choice of scope, so free mode is not entirely free.
- **Descriptions come from OpenRouter.** They are shown as given, reduced to
  plain text. A model without one says so.
- **No suite browser script covers the Company screen.** This evidence comes
  from a throwaway script; `verify:igor` covers the chat screen only.

## Release (2026-11-21)

The owner authorized the release ("all of that works").

- **Suite:** PR 10 merged as `e754f52` after CI passed.
- **stex-igor:** PR 5 passed CI, and `main` was fast-forwarded from
  `c5af494` to `5db7e51`, the commit the suite pins.
- **Deploy run `44939125134`:** every step passed:
  - build;
  - ship over IAP;
  - install with its health checks;
  - "Verify the VM's active release", which reports `5db7e51` as
    generation 15.
- **From outside:** the sign-in page answers 200, and the API answers its
  own 401.
- **Not yet done:**
  - the operator step for R-15 (`apply-igor-profile.sh` on the VM, then a
    restart of `hermes-igor`), so Hermes memory is still on until then;
  - a live free-mode or passage turn.

## Independent review

**Round 1** (2026-11-21). A separate reviewer agent ran with attack scripts:
34 backend checks and 12 screen-logic checks, with no network.

- **Critical:** none reachable from today's callers.
- **The two High findings** each end in a manuscript reaching a free
  endpoint once their precondition holds.
- **What held:** every route stays paid except the sandbox; no Claude model
  can be stored or sent; saves are owner-only; and the screen works
  unchanged against an older service.

| # | Severity | Finding | Fix |
| --- | --- | --- | --- |
| H1 | High | A catalog cache written before this change has no `free` flag, so a zero-priced model it kept loaded as paid; a Frige task could be set to it, and the screen labelled it "Free" | `free` is recomputed from the id and prices on every load, never read back from the cache. Test with an old-style cache |
| H2 | High | The paid-only rule was checked only when a model was saved; if OpenRouter later prices a chosen model at zero, Frige turns would go to it silently | `routeFor` checks the catalog on every turn. A paid turn on a model now marked free fails closed (`MODEL_UNAVAILABLE`, with how to fix it). A free-mode turn whose model is no longer free, or cannot be confirmed free, fails too, so the owner is never charged unawares |
| M1 | Medium | Whether a turn counted as the sandbox depended on one context field, so a future Igor field carrying project text would have gone to the free model | `isSandboxTurn`: only the Igor product, a plain `{kind: "conversation"}` operation, and no context at all. Tested with passage, legacy-source, payload and null-project shapes, all paid |
| M2 | Medium | Hermes profile memory is shared by every turn on the `igor` profile | Confirmed in the pinned source; **not fixed** (see *Hermes memory* below) |
| L1 | Low | The Hermes pins helper did not check `freeMode.model`, so it accepted a file the service refuses | The helper checks the free mode's shape and model; Hermes test |
| L2 | Low | Turning free mode on while someone else changed its model adopted their model without notice | The rebase reports it; test |
| L3 | Low | The tooltip could not be hovered or dismissed (WCAG 1.4.13) | The tooltip is hoverable across its gap and Escape dismisses it until the next hover or focus; browser check. In the catalog table, a row focused by its radio shows the description and Escape does not hide it |
| L4 | Low | A description with no space could be cut inside a surrogate pair | Cuts by whole characters; test |
| Note | — | Anything between `<` and `>` was stripped, and `>` or `#` anywhere | Only real tags, and quote or heading markers at a line's start; test |

### Hermes memory: a precondition for releasing free mode

Read from the pinned Hermes (`runtime/hermes-agent`):

- Profile memory (`MEMORY.md`, `USER.md`) is loaded into the system prompt of
  API-server turns when memory is enabled, which is the default.
- Background review runs after turns by default (it fails open) and writes
  to the memory and skill stores.
- STEX's `apply-igor-profile.sh` pins the review's model but disables
  neither, and the API server has no per-request way to skip memory.

So a fact Hermes saves from a Frige session could appear in the prompt of a
later free-mode turn, and so reach a free provider. Whether anything has been
saved on the VM is unverified. This predates free mode; free mode only adds
a destination for it.

**Decided (owner, 2026-11-21):** `apply-igor-profile.sh` turns off
`memory.memory_enabled`, `memory.user_profile_enabled` and
`auxiliary.background_review.enabled` for the `igor` profile (stex-igor
`5db7e51`), and `test:hermes` fails if any is turned back on.

- It takes effect only when the operator runs the script on the VM and
  restarts `hermes-igor`; a release alone does not apply it.
- Existing memory files are left in place, unread.
- This also stops background review's paid calls.

See [R-15](../program/RISKS.md).

**After the fixes:**

- stex-igor `corepack pnpm test`: Igor 42, inference 73, Hermes 13, design
  system 8, none skipped; typecheck clean; build done.
- Browser check: 14 of 14, adding Escape dismissal and return on the next
  focus.
- Not re-reviewed.
