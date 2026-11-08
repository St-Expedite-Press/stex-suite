# Platform transition P3/P4 acceptance

Objective: finish the established-app platform migration and its bounded
knowledge foundation, preserving Frige, Seaxneat and Igor behavior. This follows
[P2](platform-transition-p2.md); it does not implement Ēostre/Woden or a
universal runtime. Scope and destination are in the
[transition plan](../PLATFORM-TRANSITION.md).

Base revisions: suite `9e4f6b202c5fc44f8507b4857dc216c71b2e3368`;
private renderer/service `d265894428289c6f42820fa9196974b47e0b9f79`.
Review publication uses the existing [suite PR](https://github.com/St-Expedite-Press/stex-suite/pull/5)
and [Igor PR](https://github.com/St-Expedite-Press/stex-igor/pull/1).
The overall goal started from suite `5800920a1ab67266e3be5b941be7605ea12d541e`.

## Implemented behavior

- Pantheon composes Igor's private renderer via `stex.igor.interface.v1`.
  One common navigation surrounds a compact Director toolbar. Igor keeps its
  API, records, secret, standalone masthead and hosted sign-in. Public suite
  code contains no copy/import of the private frontend. The composed page
  preserves the image CSP against external Markdown trackers.
- Frige and Seaxneat export `stex.project.context.v1`. Frige preserves exact
  BOM/Unicode/CRLF/lineation and validates linked-path containment before
  graph reads. Seaxneat exports only allowlisted files from validated Git
  objects. Working drafts and failed builds are excluded.
- Igor project selection is explicit: catalog, exact preview, approval,
  refresh and withdrawal. Digest/revision checks run again on approval.
  Conversations bind to one project. Changed/withdrawn context gets a fresh
  runtime epoch and excludes prior-epoch history; pending changes conflict.
  Retry preserves its snapshot and request id, and fails after withdrawal.
  Context-aware idempotency and actual UTF-8 budgets prevent changed replays
  or partial oversized-message mutation.
- Optional `services/knowledge` owns a metadata journal. Explicit accepted
  engine observations update source evidence and User Graph project views
  together. Assertions remain distinct from reviewable inferences, with
  evidence, confidence, correction and rejection. There is no transcript
  mining or raw source text in this journal.
- Graph checks current engine access; changed, deleted, restricted or
  unreachable sources become unavailable. Withdrawal, explicit renewed
  consent, replay, export, erasure, lock recovery and restart are supported.
  An accepted-relationship preview can be deliberately sent as a new Igor
  message after access revalidation. It never writes an engine artifact.

## Evidence

Status: **COMPLETE for the authorized established-app transition and bounded
knowledge foundation**. The long-term retrieval/runtime destination remains
explicitly staged in the transition plan.

`corepack pnpm test` passed **164 tests, zero failures and zero skips** across
all owning suites, including real LuaLaTeX proof
tests. `build:pantheon` (TypeScript/Vite), `build:igor` and Igor TypeScript
checks pass. Igor retains existing Vite warnings for a runtime-resolved emblem
URL and its bundle size; neither is suppressed.

`corepack pnpm verify:igor` passes in Chrome at 1440, 1280, 1024, 768 and 390
pixel widths. It measures handoff, exactly-once creation, continuity, failure
and request-id retry, refresh, Back/Forward, rename/delete, keyboard reach,
safe Markdown, no browser secret, mobile drawer and standalone reduced-motion
behavior. Its real Frige fixture proves preview starts no inference, the
approved payload contains exactly one selected source, withdrawal clears
future source/history and changes runtime identity, and knowledge handoff
matches the visible preview in a new conversation. Nine local stub turns;
no provider request.

`verify:frige` passes the mature publishing workflow with a real LuaLaTeX PDF
at five widths. `verify:platform` passes real Next.js create/edit/restore and
mounted sandbox preview at five widths. `verify:igor-login` passes its 15
viewports against isolated password sign-in; no hosted configuration changed.
Syntax checks and `git diff --check` pass. All 138 local Markdown links in
27 changed documentation files resolve.

`corepack pnpm verify:knowledge` passes with real Frige and Pantheon on
disposable data. It checks browser acceptance into both projections,
inference rejection, unchanged-source withdrawal/renewal, stale refusal,
explicit new-revision acceptance, replay, restart, provenance-only export and
deletion with exact canonical source preservation. Chrome at 1440, 1024, 768
and 390 pixels has no horizontal overflow.

Focused tests cover split multibyte network chunks, a six-second aggregate
access-check deadline, revision fidelity, linked manuscript escapes,
validated Git object reads, context retry/withdrawal, oversize rejection before
mutation, storage rollback, descriptor traversal, hosted auth protection,
event ordering, replay/renewal, failed durable writes and crashed-writer locks.

## Review and limits

Independent review found and verified repairs for BOM stripping, unchanged
source reconsent, split UTF-8 decoding, unbounded aggregate access checks and
cold Frige initialization ordering. A real cold-server junction test proves
rejection before graph state creation; unknown context projects return 404.
The author reran the integrated tests and browser workflows. No protected
manuscript diff, credential change, paid call, runtime-tool enablement or
production deployment is part of this change.

Access revalidation checks at most 40 accepted source references, four at a
time, within six seconds; the unverified remainder is marked unavailable.
Source selections are at most four; model context is capped at 12,000 UTF-8
JSON bytes within a 24,000-byte turn envelope. Knowledge is disabled unless
`STEX_KNOWLEDGE_DATA_DIR` is explicitly configured. The legacy vault reader is
separate and remains unexposed; its hardening is required before browser use.
Safari/Firefox, embeddings, multimodal retrieval, automatic synchronization,
shared identity and runtime engine tools remain unverified or unimplemented.
Withdrawal does not erase already transmitted conversations/provider records.

Orientation, implementation, verification, evidence and integration loops
completed. No repair/replan budget was exhausted. P3 review and two bounded
P4 review/fix rounds closed all confirmed findings, including independent
verification of the cold-server repair. The next smallest
milestone is owner-reviewed production rollout of the composed Igor build,
or a separately scoped retrieval extension; deployment is not authorized by
the instruction to push review branches.
