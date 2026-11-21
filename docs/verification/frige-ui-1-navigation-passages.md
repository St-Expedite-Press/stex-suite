# Frige interface increment 1: navigation and exact passage selection

**Date:** 2026-11-21. **Status:** implemented and tested locally. The
independent review has not run (see the end). **Plan:**
[Wave F](../program/MASTER-PLAN.md#waves), [D-021](../program/DECISIONS.md).

| Repository | Base | Branch |
| --- | --- | --- |
| stex-suite | `af94e24` (`main`) | `feat/frige-ui-passages` |
| stex-igor | `c5af494` (`main`, deployed) | `feat/frige-passages` |

## Baseline (before this increment)

Observed in the code and in `verify:frige` screenshots of `af94e24` at five
widths:

| Area | Existed | Missing or hard to use |
| --- | --- | --- |
| Navigator | Book → section → piece tree from the engine's graph, verified page numbers, review flags, tablet drawer | Search; arrow keys; marks for pending proposals or unsaved edits; the open scope was not in the address, so a reload returned to the whole book |
| Editor | Exact-byte textarea, base-hash save, stale-save refusal, leave-page guard | Behind a Conversation/Source tab, with conversation the default even for a piece; no save shortcut; no position |
| Passage selection | None | Everything |
| Proposal review | Headed passages, terms, accept, reject and rollback (Wave F) | Inline markers in the editor (increment 2) |
| Conversation | Scoped threads at three levels; the composer stays visible | No way to attach source text; the scope is a small label (increment 3) |

## What changed

- **Engine:**
  - `resolvePassage` maps an editor selection to canonical bytes and checks
    its text.
  - `changedOnlyWithin` tests a whole-text change against a range.
  - `applyEdits` takes `within` and searches anchors inside the passage
    only.
  - The turn route checks the passage before recording anything (`409
    PASSAGE_STALE`, `400 INVALID_PASSAGE`), records it on the user turn, and
    bounds the proposal.
  - The inference client sends the labelled `selection` field and reads
    `forwardedContext.selection`.
  - The simulator answers passage actions.
- **Workstation:**
  - the navigator gains search, the summary, marks and arrow keys;
  - the scope is in the address, with Back and Forward;
  - a piece opens on its source;
  - the editor shows its position and saves on Ctrl or Cmd + S;
  - new: the passage bar, the chip in the composer, and the passage quoted
    in the thread, with a note when a real gateway did not confirm it.
- **stex-igor adapter** (branch, unreleased): forwards `selection` whole,
  only for an offered piece; adds the passage rule to the trusted
  instructions only then; reports `selection` as forwarded.
- **Records:**
  - the [publishing protocol](../../protocol/frige/README.md#selected-passages);
  - the [scope turn](../../protocol/texgraph/README.md);
  - the Frige README, D-021 and the master plan.

## Acceptance checklist (the directive's increment 1)

| Requirement | State | Evidence |
| --- | --- | --- |
| Navigate a synthetic book's hierarchy; current selection; expand and collapse | Done | `verify:frige` (Chrome) |
| Keyboard navigation in the tree | Done: Up, Down, Home, End; Right and Left open and close | `verify:frige` (Down, End, Home at desktop width) |
| Stable identity; no browser-side hierarchy | Done: rebuilt from the engine's graph; ids are the engine's | Code |
| Unsaved, pending and flag indicators from authoritative state | Done: pending counts come from the contract history; unsaved is the open editor's own state | `passage-proposal.png` |
| Search by title or path; jump to a piece | Done: filter, empty state, Enter opens the first match, Escape clears | `verify:frige` |
| Refresh, history and deep links | Done | `verify:frige`: a deep link survives reload; Back and Forward between book and piece |
| Exact selection carrying piece, hash, text, range, action | Done | Store and HTTP tests; `verify:frige` |
| Selection validated against current engine state; an outdated one rejected | Done | HTTP test (409, nothing recorded); `verify:frige` (concurrent save, visible refusal, no turn recorded) |
| Actions: Ask, Revise, Explain, Alternatives, Compare; they never modify text | Done | `verify:frige`: the proposal is inert until Accept |
| Inspect the exact context sent to Igor | Done for the passage: the chip and the thread quote show the exact text; the reply notes an unconfirmed gateway | `passage-attached.png` |
| A proposal tied to the right revision; no unrelated bytes changed | Done | HTTP test (CRLF piece); end to end (an anchor on all 1,200 lines changes only the passage); `verify:frige` (byte-exact accept and rollback) |
| Preserve normal editing shortcuts | Done: only Ctrl or Cmd + S is taken | Code review of the key handler |

## Commands

| Command | Result |
| --- | --- |
| `corepack pnpm run test:frige` | 145 passed (5 new), none skipped |
| `corepack pnpm run test:pantheon` | 22 passed |
| `corepack pnpm run build:pantheon` | Built |
| stex-igor `corepack pnpm test` | Igor 40, inference 66 (one new unit test and an extended service test), Hermes 12, design system 8 |
| `corepack pnpm run verify:frige` | PASS (Chrome): the earlier workflow, plus deep link, history, filter, arrow keys, passage revise → proposal → accept → rollback, and stale-passage refusal; real LuaLaTeX proofs; five widths |
| End-to-end script: stub Hermes → stex-igor `feat/frige-passages` → Frige | 12 of 12, including the passage forwarded with its rule and confirmed |
| `corepack pnpm test` | Passed as one command (exit 0): every suite, Frige 145, inference 66, Pantheon 22, Ruff and mypy clean, 64 pytest, stex-igor copies match |
| `corepack pnpm run verify:home` | Passed |
| `node --check` on touched modules; `git diff --check` | Clean |

Screenshots are written outside the repository by `verify:frige --out`. The
end-to-end script is a throwaway file outside the repositories.

## Limits

- **The released gateway does not forward passages yet.** Hosted Igor runs
  stex-igor `c5af494`, which drops `selection`, so a live director would not
  see the passage until `feat/frige-passages` is released.
  - The engine still bounds the proposal.
  - The reply says that the gateway did not confirm the passage.
  - The release is the owner's decision.
- **Withheld pieces.** A passage from a piece a section conversation
  withholds as too long (over 60,000 characters of section text) is refused
  as not offered. Excerpted context is F-B3.
- **Increment 1 only.** Not part of it: inline proposal markers in the editor,
  navigation between changed passages, the conversation panel's layout and
  context display, proof synchronization and the Design panel (increments
  2–4).
- **Source search** is by title and file only; no text search was added.
- **Pending marks** count the 200 most recent contracts, which is the
  history listing's limit. An undecided proposal older than that is not
  marked in the tree, though its own conversation still shows it.

## Independent review

Not run. The directive forbids Claude models for delegated development
work, and the only reviewer agent available in this session is a Claude
model. The charter requires a review for a change to behaviour, contracts
and multiple subsystems. This increment is therefore not accepted until the
owner or a non-Claude reviewer reviews it.
