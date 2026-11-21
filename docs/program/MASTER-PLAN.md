# Program master plan

This plan sequences the engineering program the owner directed on 2026-11-12:
complete Frige as a contract-governed editorial studio, make Igor useful to it
within tested safety bounds, and continue the incremental platform work.

It adds sequencing only. Existing authorities keep their roles:

- [`AGENTS.md`](../../AGENTS.md) — engineering charter and authorization rules.
- [`docs/STATUS.md`](../STATUS.md) — what is implemented, tested and deployed.
- [`docs/PLATFORM-TRANSITION.md`](../PLATFORM-TRANSITION.md) — ownership, the
  Python migration gate, the Obsidian gate, and milestones P0–P4 and M0–M6.
- [`docs/verification/`](../verification/README.md) — acceptance evidence.

Companion records: [progress](PROGRESS.md), [decisions](DECISIONS.md),
[integration ledger](INTEGRATION-LEDGER.md), [risks](RISKS.md) and the
[handoff](HANDOFF.md) a new session should read first. The starting point is
the [2026-11-13 baseline](../verification/program-baseline-2026-11-13.md).

## Scope

In scope: `stex-suite` and `stex-igor`. The Press website is out of scope by
owner decision (see [D-001](DECISIONS.md)).

## Target architecture

Confirmed requirements, from the charter and the owner's directive:

- Pantheon owns presentation. Each engine owns its canonical state.
- Frige conversations exist at three scopes — book, section, element — and
  change canonical material only through an inspectable **change contract**
  that the author approves.
- LuaLaTeX remains the typesetting authority; layout is typed configuration,
  not free generated LaTeX.
- Igor is the single human-facing director. Specialists return findings to
  Igor and never hold canonical state. No Claude models in the runtime.
- Runtime tools stay off until an isolation boundary passes executable
  negative tests and the owner approves.
- Python/FastAPI is the backend destination, one slice at a time through the
  migration gate.
- The User Graph is portable, provenance-bearing and Obsidian-interoperable,
  and never overrides engine records.

Proposals, to be confirmed as each wave is specified:

- The change contract is the existing Frige change set extended in place, kept
  in an append-only journal, with rollback as a first-class operation
  ([D-003](DECISIONS.md)).
- Frige reaches the director through the inference service, as today. A
  Frige-scoped Igor conversation is a later, additive contract
  ([D-006](DECISIONS.md)).
- Section and element layout settings are overrides on the existing typed
  book profile, resolved book → section → element.

## Waves

Each wave maps to the milestones already defined in the transition plan. A
wave is accepted only with evidence under `docs/verification/`.

| Wave | Objective | Depends on | Existing milestone |
| --- | --- | --- | --- |
| 0 | Audit and baseline | — | — |
| 1 | Reconcile contracts: change-contract protocol, conversation hierarchy, migration and Igor boundaries | 0 | P2, P3 |
| 2 | Frige vertical slice at element scope: proposal → contract → approval → change → proof → rollback | 1 | P2 |
| 3 | Section and book scopes: hierarchical context, typed overrides, conflict detection, atomic multi-piece apply | 2 | P2 |
| 4 | Igor integration for Frige: proposals through `stex.hermes.turn.v1`, usage records, bounded specialist investigation | 2; owner authorization for any `stex-igor` push or paid call | P3, M6 |
| 5 | Backend modernization, one slice at a time | Migration gate | M3–M5 |
| 6 | Knowledge slice (Frige project to selected Obsidian notes, read-only), remaining Pantheon and Seaxneat interface work | Obsidian gate hardening | P4, M6 |
| 7 | Release readiness: full regression, browser acceptance, release and rollback plan | All accepted waves | M0 |

**Wave F — Frige product completion** (owner brief, 2026-11-20;
[D-020](DECISIONS.md)) runs beside Waves 5–7 and renumbers none of them. It
turns the Wave 2–4 machinery into a workstation for sustained work on a real
book, in dependency order:

| Increment | Objective | State |
| --- | --- | --- |
| F-A | Editorial workstation: navigation, editing, proposal review, usability | First slice done: diff passages headed by line numbers, long pieces reviewed as their changed passages ([evidence](../verification/frige-wave-f-anchored-edits.md)) |
| F-B | Long-form editing: anchored edits, multi-edit contracts, long-form context, a small vocabulary of editorial operations | Anchored edits done locally, stex-igor adapter on an unreleased branch; long-form context (B3) and operations (B4) not started |
| F-C | Professional typography: profiles, inheritance, diagnostics, profile comparison | Not started |
| F-D | Proofing and production: proof navigation, annotations, preflight, export | Not started |
| F-E | Integration and reliability: Pantheon, Igor, data integrity, performance, independent review | Not started |

Waves 5 and 6 do not block Waves 2–4. Wave 4's local work (fake transport,
contract design) can proceed before authorization; its deployment cannot.

## Wave 2 acceptance criteria

The first end-to-end workflow, using synthetic manuscripts only:

1. Open a book, select one piece, and send a message in its conversation.
2. The reply carries a change contract: the request, the director's reason,
   the exact before and after text with hashes, what context was offered and
   from which category, expected effects, conflicts, and rollback terms.
3. Nothing in the manuscript changes until the author accepts.
4. Rejecting leaves the manuscript byte-identical and records the decision.
5. Accepting writes through the serialized, base-hash-checked path; a piece
   edited since the proposal is refused, not overwritten.
6. A LuaLaTeX proof is built from the accepted text, with a compiler-verified
   page map, and the contract records that proof.
7. Rolling back restores the exact prior bytes and hash, keeps the piece's
   identity, and is refused if the piece changed after acceptance.
8. Every contract remains readable afterwards; a newer proposal supersedes an
   undecided one without erasing it.
9. Evidence: store tests, HTTP tests through `stex.frige.publishing.v1`, and
   the Chrome workflow in `verify:frige`, each failing without the change.

## Wave 3 specification

**Status:** draft for owner review; increments 3a–3e are ordered so each one
ships with its own evidence. Starting state is the Wave 2 engine.

### What exists to build on

- Sections are derived, not declared: consecutive reading-order pieces that
  share a top-level folder. A section's id is `scope-<first piece id>`, so it
  changes when the first piece changes, and its conversation is orphaned.
- The publication profile (`apps/frige/src/design-settings.mjs`) is typed and
  validated, but book-level only: trim, four margins, body font, size,
  leading, running heads, folios, recto openers, running-head title.
- A book conversation is offered only the table of contents. A section or
  piece conversation is offered its pieces' full text within a 60,000-character
  budget, with nothing from the levels above.
- Contracts change piece text only (`replace-node-source`). Several pieces in
  one contract are accepted independently.

### 3a — Typed layout overrides

Extend the profile with optional overrides, resolved **element → section →
book**: the nearest level that sets a key wins; unset keys inherit.

| Key | Book | Section | Element | Why that level |
| --- | --- | --- | --- | --- |
| Trim size, margins, body font, folios, running heads | Yes | No | No | Physical page and book-wide apparatus: one value per book |
| Body size, leading | Yes | Yes | Yes | A long poem or a section of notes may be set smaller |
| Opens on a recto | Yes (for openers) | Yes | Yes | Section and piece openings are editorial decisions |
| Recto running-head text | — | Yes | No | Replaces the section title in the head |

- Stored in `.texgraph/design.json` as `{ ...book, sections: { <key>: {…} },
  nodes: { <nodeId>: {…} } }`. Every value passes the same validation rules
  as the book profile. **No raw LaTeX is accepted at any level.**
- The profile hash covers overrides, so any override change makes affected
  proofs stale, as a book change does today.
- The assembler applies a piece's resolved size and leading inside a TeX
  group around that piece only, and records the resolved values per piece in
  the page map, so a proof states which settings it used.
- **Acceptance** (real LuaLaTeX, synthetic book):
  - a book size change reaches every piece;
  - a section override reaches only its pieces;
  - a piece override beats its section;
  - clearing an override restores inheritance;
  - pagination stays compiler-verified;
  - an invalid override is refused with the rule's message.

### 3b — Layout change contracts

**Done** (as built; see the [Wave 3b evidence](../verification/frige-layout-contracts-w3b.md)
and the [protocol](../../protocol/frige/README.md#change-contracts-v1)).

- A contract may hold exactly one change that sets or clears the override of
  the conversation's own section or piece: `{kind: "set-layout", level,
  target, before, after, baseHash, afterHash, pieces, inherited}`, where
  `before` and `after` are whole overrides and the hashes are of the whole
  profile.
- Acceptance writes through the profile under the store lock, only if the
  profile hash still equals `baseHash` and the target is still in the table
  of contents. Rollback restores `before` only if the hash still equals
  `afterHash`.
- The contract records what the target inherits without its own override
  (`inherited`), and the card shows each setting from that to the proposal.
- A build proves the change only if it typeset every affected piece under
  the resulting profile.
- The simulator takes `Simulate layout: 15pt/18pt`, `recto on|off|inherit`,
  `size inherit`, `head <text>`, `head inherit` or `clear`. A gateway may
  send the same proposal as the optional scope-turn reply field `layout`.
- **Contract version:** v1 was still unpublished, so it was extended
  ([D-011](DECISIONS.md)).

### 3c — Hierarchical context

Each turn is offered only what its scope needs. Every item carries its
category and revision, and categories are never merged.

| Scope | Offered |
| --- | --- |
| Book | Table of contents (canonical source); an outline of every piece (title, path, hash, line count, verified page range; no text); the resolved profile (document settings); the last approved book-level contracts (approved contracts) |
| Section | Its pieces' text within the budget (canonical source); its place in the outline; the profile values in force for it and where each comes from; approved book- and section-level contracts |
| Element | The piece's text; its section's titles and order; the values in force; approved contracts at all three levels that touched it |

- The contract records every item offered, with its category, as Wave 2
  already does for pieces and references.
- New categories: `outline`, `document-settings` and `approved-contract`.
  Historical conversation keeps its existing recent-turn bound.
- Knowledge (User Graph) material is not offered until Wave 6.
- **Acceptance:** for each scope, a test asserts the exact categories and
  hashes offered, and that no piece text outside the scope is sent.
- **Done** (as built: see the [Wave 3c evidence](../verification/frige-hierarchical-context-w3c.md)).
  Deviations from the table above:
  - every scope receives the whole book outline (titles, places, hashes), not
    only its own place in it; titles are headings, treated as identifying
    metadata;
  - the outline carries no line counts, and pages only from a proof that
    still matches the book;
  - the contract records counts and ids of what was offered, as the gateway
    reports forwarding it, not each item;
  - an author's request is offered only to the conversation that wrote it.
  The stex-igor adapter forwards the three fields on a local branch; deployed
  Igor drops them until that branch is released.

### 3d — All-or-nothing application across pieces

- **Accept all** checks every piece's base hash under the lock before writing
  any piece.
- Before the first write, the contract records an `applying` intent listing
  the pieces. If a write fails, the pieces already written are restored, and
  the contract records the failure.
- On start, a contract left `applying` by a crash is restored from its
  stored texts (never completed: the author decides again), and the outcome
  is recorded.
- Per-piece acceptance stays available.
- **Acceptance:** an injected failure on the second of three pieces leaves all
  three unchanged, including when a write reaches the file and then fails;
  a simulated crash mid-apply is recovered on restart.
- **Done:** see the [Wave 3d evidence](../verification/frige-atomic-acceptance-w3d.md).

### 3e — Stable section identity

- A section's id derives from its folder, not from its first piece.
- Threads and contracts under the old id stay readable, as the existing
  legacy-anchor turns are.
- **Acceptance:** reordering or renaming a section's first piece keeps the
  section's conversation and contracts.
- **Done:** see the [Wave 3e evidence](../verification/frige-section-identity-w3e.md).
  Ids are `section-<hash of folder>`, case-insensitive, with run suffixes
  matched by shared pieces (largest overlap first, against the previous graph
  and then every id the folder has had, remembered durably with its last
  pieces); a run of wholly new pieces inherits only a one-for-one vanished
  run, and otherwise gets an id never issued before. Old-form ids are derived
  from each section's pieces and remembered durably once they carry data.
  Renaming the folder itself changes the id.

### Not in Wave 3

- Proposals from a real director (Wave 4).
- Knowledge material in context (Wave 6).
- Free-form LaTeX at any level.
- Section boundaries that are not folders.

## Wave 4a specification — the company: agent configuration

Owner decision [D-016](DECISIONS.md). Goal: the user configures the team
(the eight native profiles) as a game of building a company. Each member
gets a persona, a loadout of skills and a model for each task, from
OpenRouter's live catalog, with Grok by default. It is one shared
capability hosted on the VM, opened from the command center and from each
application's menu.

- **Contract:** `stex.hermes.agent-config.v1`
  ([protocol](../../protocol/hermes/README.md#agent-configuration-v1)).
- **Owner:** the inference service (`stex-igor/services/inference`). It
  holds state in `STEX_INFERENCE_STATE_DIR`, caches the catalog, keeps the
  history, and applies per-request models (`provider: "openrouter"` plus the
  task's model on each Hermes request).
- **Hermes pins:** `deploy/hermes/apply-igor-profile.sh` sets the Grok
  default and pins every side model to Grok: compression, titles, vision,
  background review, delegation, an empty `fallback_providers`, and no
  multi-model presets. A test fails if any non-Grok model or Claude
  appears there.
- **Screen:** the Igor application serves "The Company" at `/team`
  (hosted) and `/igor/team` (composed in Pantheon):
  - a roster of eight character cards;
  - a character sheet with Persona (name, title, sigil, up to three
    temperaments, voice), Loadout (skills), Mind (model with catalog stats)
    and Quests (that member's tasks);
  - a quest board of every task by application;
  - a save bar with the change summary, stale handling and a reset to Grok;
  - the chronicle (history).

  Parked members are labelled parked, and editing them activates nothing.
- **Entry points:**
  - Pantheon: a labelled utility link in the shell ("Company").
  - Frige: its settings menu item replaces the dead model dialog and opens
    `/igor/team?app=frige`.
  - Seaxneat: a utility control.
  - Igor: a header button.
- **Rules:** both repositories' root charters, and the Igor, Frige,
  Pantheon and inference charters.
- **Acceptance:**
  - choosing a model for a task changes the model sent on the next turn
    (fake and stub transports);
  - Claude ids are refused;
  - a stale save is refused;
  - parked members stay parked;
  - the screen works by keyboard and at phone width;
  - the existing suites pass;
  - browser checks pass for the command center link and the Frige menu.
- **Not in 4a:**
  - deploying (a push to stex-igor `main` needs the owner);
  - live paid turns;
  - activating specialists;
  - writing personas into parked profiles' Hermes homes;
  - new profiles.

## Wave 4 specification — proposals from a real director

Goal: an editorial conversation in Frige can end in a real proposal from
the director, through `stex.hermes.turn.v1`, which the author accepts or
rejects as a change contract. Until now only Frige's deterministic simulator
proposed anything. Decision [D-017](DECISIONS.md).

### 4b — Director proposals (local)

- **Trusted instructions.** The inference service's scope-turn adapter
  sends instructions in the system envelope, before the untrusted context.
  They give the proposal format, the rule that only offered pieces may
  change, the rule that every unchanged line is copied exactly, and the
  rule that a proposal is inert until the author accepts it. A request body
  cannot supply or alter them.
- **Reading the reply.** The adapter reads one `stex-proposal` block into
  `changes` or `layout`, and removes it from the prose. It sets aside, with a
  sentence in the reply:
  - pieces the turn did not offer;
  - empty or repeated changes;
  - more than 40 changes;
  - a layout change in a whole-book conversation;
  - any setting that is not an override setting.

  An unreadable block proposes nothing, and the reply says why. Frige
  validates everything again, as for the simulator.
  A reply cut short at its output limit proposes nothing, and neither does
  a simulated reply.
- **Usage records.** A remote reply's `meta.model` is the model the turn
  requested, which is the task's configured model, and `meta.taskId` is
  that task. Frige's contract `origin` and its turn record therefore name
  the model asked to propose. A simulated reply keeps its simulated label.
- **Acceptance:**
  - stub-Hermes tests show a proposal becoming a contract with the model
    recorded, and the accepted text written byte-exact;
  - unoffered pieces and book-level layout changes are refused;
  - unreadable replies are reported;
  - generic Igor turns never carry the Frige instructions;
  - existing suites pass.
- **Not in 4b:**
  - a live paid turn: the owner approves one, with a budget;
  - release of the stex-igor branch;
  - widening the 20,000-character output budget, which limits a proposal
    to short pieces (see the evidence's limits). The turn time was widened
    to 120 seconds after the live turn ([D-018](DECISIONS.md));
  - specialist investigation (specialists stay parked).

## Wave F specification — first increment (F-A and F-B together)

The brief recommends the editorial workstation and long-form editing as the
first coordinated release. This increment covers their core.

- **Anchored edits (F-B1, F-B2).** As decided in [D-020](DECISIONS.md).
  Several pieces' edits in one contract use the existing all-or-nothing
  acceptance (Wave 3d).
- **Inference compatibility (F-B5).** The stex-igor adapter reads `edits`
  from the `stex-proposal` block, checks only their shape and never clips
  them. Its trusted instructions prefer edits, keeping the whole-piece form
  for short rewrites. This is a local branch: releasing it is a push to
  stex-igor `main`, which needs the owner.
- **Review (F-A3, part).** The proposal card heads each changed passage with
  its lines (`Lines 598–602, becoming 598–603`) and says how many passages
  would change. The diff matches unchanged lines at the start and end
  first, so a one-line edit to a 3,000-line piece shows that line rather
  than the whole piece removed and re-added.
- **Acceptance:**
  - a synthetic piece longer than the 20,000-character output budget is
    revised by a reply that does not repeat it;
  - text outside the edited spans is byte-identical, including a byte-order
    mark, Unicode, indentation and mixed line endings;
  - missing, ambiguous, overlapping and malformed edits create no contract,
    write nothing and are explained;
  - staleness and rollback behave as before;
  - the workstation shows the headed passage, accepts it and rolls it back
    (`verify:frige`);
  - stub Hermes → inference → Frige passes end to end.
- **Not in this increment:**
  - long-form context selection (B3) and named editorial operations (B4);
  - navigator, editor and keyboard work (A1, A2, A4);
  - typography (F-C), proofing (F-D) and the integration wave (F-E);
  - a live paid turn and the stex-igor release.

## Standards

All code is structured to each language's professional conventions and
annotated for tooling and for readers: typed Python, JSDoc-typed JavaScript,
real TypeScript types, JSON Schema for contracts, and comments that explain
intent, invariants and failure behaviour ([D-002](DECISIONS.md)).
