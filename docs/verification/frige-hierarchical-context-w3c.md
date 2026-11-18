# Frige hierarchical context — Wave 3c evidence

**Objective:** each editorial turn is offered context from the levels around
its scope (the book outline, the settings in force, and approved contracts),
each labelled by category and never merged with manuscript text, and that
context reaches the director, as specified in
[the master plan](../program/MASTER-PLAN.md#3c--hierarchical-context).

**Status:** implemented and tested locally in both repositories; one
independent review round, confirmed findings fixed (fixes verified by tests,
not re-reviewed). Not pushed, not merged, not deployed.

| Item | Value |
| --- | --- |
| stex-suite | `feat/frige-change-contracts` (local), on top of `0b7253f` |
| stex-igor | Local branch `feat/frige-scope-context` on top of the deployed `d0598d8` ([D-014](../program/DECISIONS.md)): `b79764f` and `a8880aa`. The suite's submodule pointer stays at `d0598d8` |
| Date | 2026-11-18 |
| Environment | Windows 11, Node 24.18 |
| Inference | Fake transport and local stubs. No provider call; whether a real director uses the context is unverified |
| Data | Synthetic books in temporary directories only |

## What changed

| Path | Change |
| --- | --- |
| `apps/frige/src/project-store-vault.mjs` | `hierarchy(scope, graph)`: outline (bounded to 20,000 UTF-8 bytes; pages only from a current proof), settings in force with their source, and up to eight relevant accepted contracts (requests only to the conversation that wrote them) |
| `apps/frige/server.mjs`, `apps/frige/src/inference-client.mjs` | The three parts are sent as separate scope-turn fields and recorded in the contract's provenance |
| `apps/frige/src/change-contract.mjs` | Contracts record `context.outline`, `context.settings` and `context.contracts` by category, without content, and `context.hierarchyConfirmed` |
| `protocol/frige/change-contract.v1.schema.json` | The three optional context fields |
| `protocol/texgraph/README.md`, `protocol/frige/README.md`, `apps/frige/README.md` | Request fields and contract fields documented |
| `stex-igor/services/inference/src/texgraph-adapter.mjs`, `server.mjs` | Forwards the three fields to Hermes under `context.legacy`, keeping only known fields, trims outline then contracts to keep a turn within budget, and reports what it forwarded in the reply's `meta.forwardedContext` |

Contracts touched: `stex.texgraph.scope-turn.v3`, additively (three optional
request fields that readers ignore if unknown); `stex.frige.change-contract.v1`,
additively (three optional context fields, while still unpublished).

## Acceptance criteria and evidence

| Criterion | Evidence |
| --- | --- |
| For each scope, the exact categories and hashes offered | "every scope is offered the outline, the settings in force and relevant approved contracts…" (book, section and piece) |
| No piece text outside the scope is sent | Same test; "approved context keeps requests in their own conversation…" (a request quoting text is not offered elsewhere); the adapter tests show settings and layout values pass by known keys only |
| What each level sees of settings and approved contracts | Same test: the book sees no settings scope; a section sees its own override; a piece sees where its size comes from; each sees only relevant accepted changes, never a rejected one |
| The contract records what was offered, by category | "a contract records the context categories it was offered…"; the HTTP journey in `base-path.test.mjs` (unconfirmed, no gateway); "a contract records the context the gateway reports it forwarded, marked as confirmed" |
| Frige sends the fields to the gateway | "a scope turn sends the outline, settings and approved contracts…" (a local HTTP stub captures the request) |
| The context reaches Hermes within budget | stex-igor `texgraph-adapter.test.mjs`: forwarding by category; trimming a 400-piece outline beside a 60,000-character source to within 90,000 characters |
| A long outline is bounded, in bytes | "a book outline longer than its budget is cut short and says so"; "the outline budget counts UTF-8 bytes…" |
| Pages are never offered from an out-of-date proof | "outline pages come only from a proof that still matches the text, the profile and the reading order" |

## Commands and results

Run on 2026-11-18 after the review fixes, with stex-igor at `a8880aa` in the working tree.

| Command | Result |
| --- | --- |
| `corepack pnpm run test:frige` | 118 pass (110 before 3c) |
| `corepack pnpm test` (suite) | Passes as one command (exit 0): 227 Node tests across nine suites, including 12 inference tests from the stex-igor branch; Ruff, mypy, 64 pytest, stex-igor sync |
| `corepack pnpm test` (stex-igor root) | 49 pass |
| `corepack pnpm run build:pantheon` | Built |
| `corepack pnpm run verify:frige` | PASS |
| `git diff --check` (both repositories) | Clean |

## Independent review

One round, by a separate reviewer agent with reproduction scripts across both
repositories. It found no Critical or High defect. It confirmed the relevance
rules (reverted and superseded changes are excluded, the sort is sound) and
that trimming always terminates.

| Finding | Disposition |
| --- | --- |
| Medium: the contract recorded what Frige sent, while the adapter could forward fewer outline entries and contracts | Fixed: the adapter reports what it forwarded; Frige records that with `hierarchyConfirmed: true`, or what it sent with `false` |
| Medium: page ranges from an out-of-date proof were offered as verified | Fixed: pages only from a proof matching the current text, profile and reading order |
| Medium/Low: an author's request quoting another piece reached other scopes | Fixed: a request is offered only to the conversation that wrote it |
| Low: the adapter forwarded settings and layout objects unfiltered, so an oversized field could crowd out the turn | Fixed: known keys only, bounded |
| Low: trimming re-serialized the request per removed entry (about 150 ms) | Fixed: each entry measured once |
| Low: the outline budget counted characters, not bytes, and missed separators | Fixed |
| Low: every turn parses the contract history; an unreadable contract file failed every turn | The parse remains (recorded limit); an unreadable history now leaves approved context out of that turn with `unavailable: true` |
| Docs: "no text", "verified pages", "only known fields", character budgets, and the plan's Done mark | Corrected; the plan records the as-built deviations |

Not changed: every scope receives the whole outline (titles are headings,
treated as metadata), and an earlier accepted layout change that a later one
overrode is still offered as accepted. Both are recorded in the plan and
limits.

## Limits

- **The director's use of this context is unverified.** Only fake and stub
  transports ran; a live turn needs authorization for a paid call.
- **The stex-igor change is on a local branch.** Deployed Igor forwards none
  of the new fields until that branch is pushed and released, which needs the
  owner's approval.
- **The outline carries no line counts**, and pages appear only from a
  verified book-order proof that still matches the book.
- **Every turn parses the contract history** to find approved context; the
  journal has no index.
- **An overridden layout change is still offered as accepted**; nothing marks
  that a later change replaced it.
- **A turn whose own sources and recent turns exceed the budget is still
  refused**; trimming applies only to the optional context.
- **Knowledge material** (User Graph, Obsidian) is not offered; that is
  Wave 6.
