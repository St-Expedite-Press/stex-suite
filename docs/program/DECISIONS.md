# Program decisions

Architectural and scope decisions for the program in
[the master plan](MASTER-PLAN.md). Each entry states who decided, the
alternatives weighed, and what it affects. Decisions marked **Proposed** are
the coordinating agent's defaults and stand until the owner says otherwise.

## D-001 — The Press website is out of scope

- **Decided by:** owner, 2026-11-13.
- **Decision:** the program covers `stex-suite` and `stex-igor` only. No Press
  work package or acceptance journey is planned.
- **Affects:** Wave 6 no longer includes Press integration.

## D-002 — Code standards and annotation

- **Decided by:** owner, 2026-11-12.
- **Decision:** all code, in every language, follows professional structure
  and is annotated for machines and for people.
- **Applied as:** typed Python (mypy strict), JSDoc types on plain JavaScript,
  TypeScript types rather than `any`, JSON Schema for contracts, module
  headers and comments that explain intent and failure behaviour.
- **Boundary (proposed):** applies to new and modified code. Untouched files
  are not reformatted as a side effect, under the charter's rule against
  unrelated churn.

## D-003 — The change contract extends the existing change set

- **Status:** Proposed; implemented in Wave 2.
- **Decision:** Frige's change set becomes the change contract
  (`stex.frige.change-contract.v1`, record schema 3). One record per contract
  is kept in `.texgraph/contracts/`; the per-scope proposal file becomes a
  pointer to the current contract. Schema-2 records remain readable and are
  journaled on their next decision.
- **Alternatives:** a separate contract store beside change sets (two
  proposal systems to keep consistent); storing a patch instead of full
  before and after text (cannot prove exact restoration).
- **Affects:** `apps/frige`, [`protocol/frige`](../../protocol/frige/README.md)
  (additive routes and fields under `stex.frige.publishing.v1`).

## D-004 — A source save must carry its base hash

- **Status:** Proposed; implemented in Wave 2. **Owner may veto.**
- **Decision:** `PUT /nodes/<id>` without `baseHash` is refused with `400
  BASE_HASH_REQUIRED`. Previously the stale check was skipped when the hash
  was absent, which contradicts Frige invariant 6.
- **Why it is not treated as a breaking change:** the publishing contract
  already documents the save body as `{source, baseHash}`, and every known
  caller sends it. A client relying on the omission was relying on a defect.
- **Not changed:** the legacy one-page store keeps its behaviour.

## D-005 — Multi-piece acceptance stays per piece until Wave 3

- **Status:** Superseded by Wave 3d (2026-11-17): accepting several pieces
  together is now all-or-nothing, with recovery after an interrupted
  acceptance. The original decision is kept below for the record.
- **Decision:** "Accept all" continues to decide each piece independently, so
  a set can end partly accepted and partly stale. This is existing, tested
  behaviour. All-or-nothing application belongs with section and book scopes
  in Wave 3, where it needs a defined recovery model.
- **Affects:** element-scope contracts are unaffected; they touch one piece
  and one atomic write.

## D-006 — Frige keeps calling the inference service directly

- **Status:** Proposed.
- **Decision:** Wave 2 keeps the existing path (Frige → inference → Hermes).
  Proposals from a real director arrive in Wave 4 by extending the inference
  adapter. Routing Frige turns through the Igor application is deferred: the
  hosted Igor cannot reach a local Frige, and it would put canonical-change
  requests behind a conversation service that owns no manuscript state.
- **Alternatives:** Frige as an Igor client (needs a service-to-service
  contract and identity that do not exist).

## D-007 — The deterministic simulator can propose a labelled change

- **Status:** Proposed; implemented in Wave 2.
- **Decision:** in fake mode, a message beginning `Simulate change:` yields
  one labelled change that appends the given line to the first offered
  source. Without it, no path from conversation to change can be exercised
  locally except through a test-only stub.
- **Boundary:** only in the fake transport, labelled as simulated in the
  reply, the contract and the model field. It is inert until accepted, like
  any proposal.

## D-008 — Private operational detail stays out of this repository

- **Status:** Proposed.
- **Decision:** `stex-suite` is public. Program records here name hosted
  risks by category and point to the private `stex-igor` reports; they do not
  repeat credentials, hostnames, expiry dates or unpatched weaknesses.

## D-009 — A file that is not valid UTF-8 is never overwritten

- **Status:** Proposed; implemented in Wave 2 after independent review.
  **Owner may veto.**
- **Decision:** a save, acceptance or rollback of a manuscript file whose
  bytes do not round-trip through UTF-8 is refused with `SOURCE_NOT_UTF8`.
- **Why:** Frige reads and hashes decoded text. Bytes that are not UTF-8
  decode to a replacement character, so the first write destroyed them and no
  rollback could restore them, while the hashes still matched.
- **Effect on existing behaviour:** previously such a file could be saved,
  silently replacing the invalid bytes. Now it must be converted to UTF-8
  first. Valid UTF-8, including a byte-order mark, is unaffected.

## D-010 — A contract keeps its strongest proof

- **Status:** Proposed; implemented in Wave 2 after independent review.
- **Decision:** a successful build is recorded on a contract only if it is
  stronger than the proof already recorded: a compiler-verified page map
  outranks an unverified one, and a book-order proof outranks a piece typeset
  alone. An equally strong build replaces it only when it was typeset under a
  different publication profile. Accepting another change of the contract,
  or rolling one back, clears the proof.
- **Alternatives:** always record the latest build (rewrote every proved
  contract on every build, and let a weaker build replace a stronger proof).

## D-011 — Layout changes extend the contract while it is unpublished

- **Status:** Applied in Wave 3b (2026-11-17). The contract was still
  unpushed with no consumer outside Frige, so `set-layout` was added to v1
  and its schema.
- **Decision:** `stex.frige.change-contract.v1` is consumed only by Frige and
  its own workstation, and has not been pushed. If that is still true when
  layout contracts (Wave 3b) land, they add a `set-layout` change kind to v1
  and its schema. If v1 has been pushed or has another consumer by then,
  Wave 3b introduces v2 and Frige keeps reading v1 records.
- **Why:** the charter forbids changing a contract another product relies
  on. Nothing relies on this one yet, and a second version for an unreleased
  record would add a reader with no caller.

## D-012 — Physical page settings stay book-wide

- **Status:** Proposed; part of the Wave 3 specification.
- **Decision:** trim, margins, body font, folios and running heads have one
  value per book. Body size, leading and recto openings may be overridden by
  section and by piece. The recto running-head text may be overridden by
  section.
- **Why:** a printed book has one page size and one apparatus. Allowing
  overrides there would invite layouts the press cannot produce, for no
  current request.

## D-013 — Wave 3d and 3e before 3c

- **Status:** Proposed (2026-11-17).
- **Decision:** build all-or-nothing application (3d) and stable section
  identity (3e) before hierarchical context (3c).
- **Why:** the stex-igor inference adapter forwards only `scope`, `page`,
  `scopeSources` and `withheldNodes` to Hermes
  (`stex-igor/services/inference/src/texgraph-adapter.mjs`). New context
  fields from Frige would be dropped before the director sees them, so 3c
  needs an adapter change in stex-igor, which waits on the owner's
  authorization of a stex-igor branch. 3d and 3e are entirely inside Frige
  and strengthen manuscript integrity, which the directive ranks highly.
- **Affects:** the order of Wave 3 increments only.

## D-014 — A local stex-igor branch for the inference adapter

- **Decided by:** owner, 2026-11-17 ("sure", in answer to the request for a
  local stex-igor branch for the Wave 3c and Wave 4 adapter work).
- **Scope:** creating and committing to a local branch in the `stex-igor`
  submodule. **Not** pushing it, merging it, moving the suite's submodule
  pointer to an unpushed commit in a pushed suite branch, or any
  deployment. A push to stex-igor `main` deploys to production and needs its
  own approval.
- **Affects:** `stex-igor/services/inference` (the scope-turn adapter) and
  its tests.

## D-015 — Owner defaults accepted, 2026-11-18

- **Decided by:** owner, 2026-11-18 ("the rest of that sounds good, do it",
  in answer to the summary of open decisions and their recommended defaults).
- **Decisions:** keep D-004 and D-009; ignore the untracked author files
  under `apps/texgraph/` (they stay on disk, untouched); merge suite PR 5
  first, then publish `feat/frige-change-contracts` so CI runs it.
- **Not covered:** renewing the hosted provider credential (only the owner
  can), releasing the stex-igor branch (a push to its `main` deploys), and
  paid provider calls.

## D-016 — Grok model stack and a shared agent configuration

- **Decided by:** owner, 2026-11-18 ("Build the model stack out of grok";
  "you need to add a whole model selection apparatus and screen"; "Grok
  defaults from now but there should be an elaborate agent config module
  also where a user may change what models are used for each task from
  openrouter availabilities"; "a global setting from the command center but
  also a menu item in each app"; hosted on the VM as part of Pantheon).
- **Decision:** every runtime model defaults to an xAI Grok model through
  OpenRouter. A shared agent-configuration capability, owned by a service on
  the hosted VM, lets the user choose the model for each task from
  OpenRouter's live catalog. Pantheon's command center shows it as a global
  setting, and each application opens it from its own menu, scoped to its
  tasks. Claude models are never offered at runtime.
- **Affects:** `stex-igor` (inference service, Igor application, Hermes
  configuration), `protocol/`, Pantheon, Frige, Seaxneat and both
  repositories' charters. Specified as program Wave 4a.

## D-017 — How the director proposes Frige changes

- **Decided by:** principal agent, 2026-11-19, under the program directive
  (Wave 4's local work proceeds before authorization). Open to owner review.
- **Decision:** the director writes its proposal as one fenced
  `stex-proposal` block of JSON at the end of an ordinary prose reply. The
  inference service's scope-turn adapter tells the director the format in
  trusted instructions and reads the block into the existing
  `stex.texgraph.scope-turn.v3` reply fields `changes` and `layout`. No new
  cross-application contract is added: Frige already validates those
  fields.
- **Why not structured output:** a JSON-schema `response_format` would
  depend on Hermes passing it through and on each model supporting it.
  The user may choose any catalog model for a task (D-016). A fenced block
  works with any chat model. It is read with bounded rules, and a reply
  without one is still a useful conversation.
- **Affects:** `stex-igor/services/inference` (the adapter and the Hermes
  client's system envelope), and comments in Frige. Frige's behaviour is
  unchanged.

## D-018 — A director turn's time budget is two minutes

- **Decided by:** the owner, 2026-11-20 ("we can move the reasoning time
  limit out"), after the one live turn (W4-c).
- **Decision:** each Frige director turn asks for 120 seconds, and the
  inference service's default cap on any turn rises from 60 to 120 seconds
  (`STEX_HERMES_MAX_TIMEOUT_SECONDS`). Frige's page turn waits 150 seconds,
  so the inference service's classified timeout arrives first. A turn that
  names no budget still gets 30 seconds, and Igor's own chat turns keep 60.
- **Why:** Grok 4.7 spent about 30 seconds reasoning over a six-line poem, so
  the 30-second budget discarded a correct proposal that had already been
  paid for.
- **Affects:** `stex-igor/services/inference` (the TexGraph adapter, the
  Hermes client's default cap, the server's setting) and Frige's page-turn
  wait. No contract changes: `stex.hermes.turn.v1` already carries
  `budget.timeoutMs`.

## D-019 — Abandoned turns stop; live turns are limited per product

- **Decided by:** the owner, 2026-11-20 ("fix these problems and push"),
  on the two problems reported after D-018: a timed-out turn was still
  billed, and a long Frige turn held the service's only turn slot.
- **Decision:**
  - remote Chat Completions turns stream from Hermes, so a timeout, a
    cancellation or an oversized answer closes the stream and the pinned
    Hermes interrupts the agent;
  - the inference service keeps request-id idempotency itself, because
    Hermes ignores `Idempotency-Key` on streaming requests;
  - `STEX_HERMES_MAX_CONCURRENT_TURNS` now limits live turns per product
    (1), and the new `STEX_HERMES_MAX_TOTAL_TURNS` limits them in total (3).
    An existing setting of 1 therefore allows up to three paid turns at
    once, one per product.
- **Why:** a turn the service has given up on should not keep spending, and
  a two-minute Frige turn should not refuse Igor's conversation.
- **Limits:** Hermes notices a closed stream at its next write, within about
  ten seconds; tokens produced before then are billed. Responses-mode turns
  do not stream yet. The product name is chosen by the calling product
  server, so only the total limit is a hard bound.
- **Affects:** `stex-igor/services/inference` (`hermes-client.mjs`,
  `server.mjs`), its README and env template; the suite's `.env.example` and
  developer guide.

## D-020 — The Frige product wave, and anchored edits for long pieces

- **Decided by:** principal agent, 2026-11-20, under the owner's Frige
  Product Completion brief. Open to owner review.
- **Numbering:** the brief's increments F5-A to F5-E form **Wave F (Frige
  product completion)**. It is not renumbered into Waves 5–7: Wave 5 stays
  backend modernization through the migration gate, Wave 6 the knowledge
  slice and Wave 7 release readiness. Wave F depends on Waves 2–4 and blocks
  none of them; its increments are recorded as F-A to F-E.
- **Decision:** a director may propose a text change as anchored edits,
  `edits: [{find, replace}]` in place of `source`. Frige resolves each edit
  against the exact offered text: `find` must occur exactly once, spans may
  not overlap or end inside a CRLF, and every edit must change something.
  One unusable edit sets aside that piece's whole change. The resolved text
  becomes an ordinary `replace-node-source` change.
- **Why this shape:**
  - The model never supplies offsets or line numbers, which go stale and
    are miscounted. Text that occurs exactly once is the only anchor, and
    the base hash still decides staleness at acceptance.
  - No contract version changes. `stex.frige.change-contract.v1` records
    are unchanged, so no persisted contract is reinterpreted, and
    acceptance, all-or-nothing application, crash recovery and rollback
    are reused unchanged. Scope turn v3 gains an optional reply field,
    which older readers ignore.
  - A whole-piece reply is converted to the file's line-ending convention.
    Resolved edits are not, so a piece with mixed line endings keeps them
    outside the spans. A replacement may not hold a carriage return that
    ends no line.
- **Compatibility:** Frige sends `proposalForms: ["source", "edits"]` with
  each scope turn. The gateway teaches and forwards edits only to a caller
  that sends it. An older Frige would drop an edits-only change without a
  word, so it keeps the released whole-piece instructions unchanged, and any
  edits its director writes are set aside with a notice. The two
  repositories can therefore be released in either order.
- **Not done:** the contract does not record that a change arrived as
  edits. The diff shows the passages either way.
- **Affects:** Frige (`change-contract.mjs` `applyEdits`, the store's
  proposal path, the inference client and simulator), the workstation's diff
  card, the stex-igor scope-turn adapter and its trusted instructions (local
  branch `feat/anchored-edits`, unreleased), and `protocol/texgraph`.

## D-021 — Selected passages are checked by the engine and bound the proposal

- **Decided by:** principal agent, 2026-11-21, under the owner's Frige
  interface directive (increment 1: navigation and exact passage
  selection). Open to owner review.
- **Decision:**
  - **Coordinates.** A passage is sent in the editor's coordinates, one
    `\n` per line ending, with the piece's hash and the exact selected text.
    The engine refuses a stale hash or a mismatched text before recording
    anything, maps the range to canonical bytes, and records the resolved
    passage on the author's turn.
  - **Bounds.** For every action except `ask`, any proposal from that turn
    may change only the passage. Edit anchors are searched within it, so a
    phrase repeated elsewhere in the piece still anchors an edit to the
    passage.
  - **Gateway.** The passage reaches the gateway as its own labelled
    request field, and the gateway reports whether it forwarded it.
- **Why:**
  - The browser's selection is not authority. Offsets in the editor's
    coordinates are what a text field reports, so CRLF pieces need no
    browser-side mapping.
  - Recording the passage on the user turn, which the contract already
    names, avoids a change to `stex.frige.change-contract.v1`.
  - Bounding by the passage makes "revise this" unable to reach other text,
    whatever the model writes.
- **Not done:**
  - passages from pieces a section conversation withholds as too long;
  - inline markers for proposals in the editor (interface increment 2).
- **Affects:** Frige (`resolvePassage`, `changedOnlyWithin`, `applyEdits`
  `within`, the turn route, the inference client and simulator), the
  workstation, `protocol/frige` and `protocol/texgraph`, and the stex-igor
  adapter on branch `feat/frige-passages`, which is unreleased.

## D-022 — Free mode for Igor's sandbox; prices and descriptions in the Company screen

- **Decided by:** the owner, 2026-11-21:
  - "I want a 'free model' mode";
  - asked how far it should reach: "Only the igor conversational sandbox has
    free mode";
  - asked which conversations may use free models: "Igor conversations only";
  - "we also need to see model pricing and hovering over the name of a model
    should produce a short description of it".

  The owner also clarified that the "no Claude" rule governs Hermes's runtime
  models, not development reviewers.
- **Decision:**
  - The catalog keeps free endpoints (`:free` variants, or zero prompt and
    completion prices), marked `free`. Claude's free variants and
    `openrouter/free` stay refused.
  - The agent configuration gains `freeMode: {enabled, model}`, which applies
    only to a generic turn from the Igor product that carries no project
    sources.
  - Every other turn keeps its paid task model: Frige's scope turns, the
    legacy page and interview turns that fall back to Igor's conversation
    task, an Igor turn about a project, and other products.
  - A free model is refused for every paid task and default model.
  - Hermes's side-call pins are unchanged.
  - Each catalog model carries OpenRouter's description, reduced to plain
    text.
  - The Company screen shows prices beside every model choice and a model
    card under each quest. A model's name shows its description on hover or
    keyboard focus.
- **Why this shape:**
  - The obvious implementation, switching `igor.conversation`'s model, would
    have sent Frige manuscripts to free endpoints. Frige's legacy page and
    interview turns, and the fallback for unknown tasks, all use that task.
    Routing therefore depends on where the turn comes from, which the
    inference service knows, not only on the task.
  - Free providers may log or train on prompts, so the owner chose to keep
    manuscripts off them. Refusing free models for paid choices enforces
    that in configuration as well as in routing.
- **Contract:** additive fields in `stex.hermes.agent-config.v1`:
  - `freeMode` on the document and the update;
  - `free` and `description` on catalog models.

  The Igor server relays them unchanged, and Pantheon and Frige do not read
  them.
- **Hermes memory** (also decided by the owner, 2026-11-21, after the
  review found shared profile memory): the `igor` profile keeps no memory
  and runs no background review (`apply-igor-profile.sh`, R-15).
- **Affects:** stex-igor `services/inference` (catalog, store, turn routing),
  `apps/igor` (the Company screen) and `deploy/hermes`, on branch
  `feat/free-mode`; `protocol/hermes`.

## D-023 — Hosted Pantheon uses Igor's accounts as its sign-in

- **Decided by:** the owner, 2026-11-22:
  - asked to host "a whole copy of pantheon etc everything we are doing on
    the vm", then approved the plan: the same VM, Seaxneat deferred, the VM
    copy of the manuscripts canonical;
  - offered a Cloudflare Access gate, chose instead: "make the login across
    the board real", with a further account for a second person.
- **Decision:** hosted Pantheon has no account store of its own. Igor's
  password accounts are the one sign-in. Pantheon composes Igor at `/igor/`
  on its own origin, so Igor's sign-in page and host-only session cookie
  work there, and Pantheon asks Igor over loopback whether each request is
  signed in. This resolves the hosted part of M2b. The local splash entry
  stays credential-free, and accounts remain Igor's.
- **Accepted by the owner's choice:**
  - every Igor account (owner or member) has full use of Pantheon and
    Frige, which keep single-user state;
  - Igor's session cookie also lives on the Pantheon origin, so a script
    injection in Pantheon or Frige pages could act as the signed-in user
    in Igor.
- **Fail-closed rules:** only sign-in requests pass without a session.
  Igor in any mode other than password sign-in makes Pantheon refuse
  (503). The installer checks the gate on every install.
- **Affects:** `apps/pantheon` (hosted mode), `apps/frige` (relative
  redirect through Pantheon), `scripts/release`, and stex-igor
  `deploy/pantheon` with its runbook.
  [Evidence](../verification/hosted-pantheon.md).

## D-024 — Frige projects can have their own password

- **Decided by:** the owner, 2026-11-23: "make projects password protected",
  with a password for the hosted Lift Wind book.
- **Decision:** Frige enforces per-project passwords itself, as the owner
  of the books. Pantheon does not, because Igor's context reads and the
  legacy routes reach Frige without passing through Pantheon's pages. The
  record is a Frige-owned file outside the books (scrypt hashes, a signing
  secret). Unlocking sets a per-project, versioned, signed cookie under
  Frige's mount for twelve hours. This is a second layer: the account
  sign-in (D-023) still applies.
- **Consequences:** a protected project's title stays visible in listings.
  Igor's project context and the knowledge journal cannot read a protected
  project. Contract shapes are unchanged: the summary keeps state `ready`,
  with the label "Password protected", and the book listing gains an
  additive `locked` field.
- **Affects:** `apps/frige` (`src/project-access.mjs`, the CLI and the
  routes), the Pantheon Frige workspace (prompt and library label), and
  stex-igor `deploy/pantheon` (env template).
  [Evidence](../verification/hosted-pantheon.md#project-passwords).

## D-025 — Establish source save safety before persistent editorial history

- **Basis.** The Frige editorial systems directive puts passage review and
  reversible revision history ahead of specialized literary workspaces.
- **Decision.** Frige applies the same Unicode validity rule to source writes
  that already applies to proposals. Pantheon keeps edits typed during an
  explicit save and uses the returned source hash for their next save.
  Matched lines and one-for-one replacements keep their source line-ending
  conventions. Newly introduced breaks use the first existing convention,
  defaulting to LF.
- **Follow-on.** Source hashes continue to identify bytes. Persistent revision
  events need a separate id, predecessor and provenance. Before linking
  proposals to those events, specify how the revision record and existing
  acceptance intent recover together after an interrupted write.
  [Implementation matrix](frige-editorial-systems.md)

## D-026 — Keep single-piece revision events and decisions with Frige

- **Basis.** The approved next editorial increment requires exact restore,
  recoverable writes and author rationale for a piece.
- **Decision.** Frige keeps the canonical Markdown file, a project-local
  metadata journal and immutable snapshots keyed by exact byte hash. Save
  and restore events carry unique ids. A restore records the preceding
  event and the source event. Recovery settles a pending event from the
  source bytes and preserves an intervening outside edit.
- **Authority.** Publishing v1 remains the access boundary. The journal
  records the operation role and applies D-023 and D-024. Proposal changes
  retain their separate transaction and their existing contract provenance
  until a later milestone coordinates both.
  [Contract](../../protocol/frige/README.md#editorial-history-and-decisions)

## D-027 — Conversations and working sessions share one lifecycle

- **Decided by:** the owner, 2026-11-25. The owner authorized milestones
  A1, A2, S0 + K0, D1 and D2 of the
  [persistent workspaces program](PERSISTENT-WORKSPACES.md) ("get as much as
  you can").
- **Decision.** Igor and Frige use the same lifecycle vocabulary, and each
  keeps its own records.
  - **Kinds.** An Igor conversation is a `chat` (the default) or a
    `session`. A session is a working session with an `objective` of up to
    500 characters. A chat has no lifecycle, so casual conversation stays
    casual. A chat can be made into a session. Every Frige scope
    conversation is an editorial session.
  - **States (`lifecycle`).** `active`, `paused`, `awaiting-review`,
    `completed` and `abandoned`. The field is named `lifecycle` so it does
    not collide with Igor's existing reply `state`
    (`idle`/`pending`/`failed`).
  - **Archive.** Archive is a separate, reversible flag that hides a
    conversation in any state. Igor's existing `archived` keeps its meaning.
  - **Delete.** Deleting an Igor conversation is the existing hard delete.
    Frige conversations are never deleted, because their turns are part of
    the editorial record; they can be archived.
  - **Transitions.**
    - `active` → any other state.
    - `paused` or `awaiting-review` → `active`, `completed` or `abandoned`.
    - `completed` or `abandoned` → `active` (reopen).
    - Every transition is appended as an event: time, from, to, actor and
      optional reason.
  - **Sending.**
    - Sending to a `paused` or `awaiting-review` session resumes it, and the
      resume is recorded as a transition.
    - Sending to a `completed` or `abandoned` session is refused (`409
      SESSION_CLOSED`). The interface offers reopen or continue.
  - **Closing has no editorial effect.** Completing or abandoning never
    accepts, rejects, applies, publishes or supersedes a proposal. Pending
    Frige contracts stay pending and are listed in the summary.
  - **Summary.**
    - A structured, revisioned record: text (up to 4,000 characters),
      decisions, open questions, outstanding proposals and sources (each a
      list of up to 20 items of up to 300 characters), the last message it
      covers, author and time.
    - Saving requires the base revision, and a stale save is refused.
    - The engine prepares a draft from its own records (Frige: contracts and
      decisions from that conversation). A model-written draft is labelled
      as one.
    - Nothing becomes a summary until the user saves it.
  - **Continue.** Continuing starts a new conversation in the same scope or
    project, with `continuedFrom: {conversationId, summaryRevision}`. The
    model is offered the saved summary as labelled context, never the
    earlier transcript.
- **Compatibility.** Every new field and route is additive under
  `stex.igor.conversations.v1` and `stex.frige.publishing.v1`. Existing
  records read as `chat`, or for Frige as the scope's first conversation,
  in state `active`. No existing journal is moved or rewritten.

## D-028 — A verified actor reaches the engines

- **Decided by:** the owner, 2026-11-25 ("yes" to letting the signed-in
  user reach the applications so that state can belong to each person).
- **Decision.** Hosted Pantheon tells the engines which signed-in person
  made a request, using [`stex.platform.actor.v1`](../../protocol/platform/README.md#platform-actor-v1).
  - Pantheon removes any actor headers a client sent.
  - Pantheon adds the Igor-confirmed username and role, together with a
    shared secret that only Pantheon and the engines hold.
  - An engine trusts the actor only when that secret matches.
  - Igor's existing per-account conversations are unchanged.
- **Ownership by kind of state.**
  - **New personal state belongs to its actor**: the knowledge journal
    and, later, preferences.
  - **Shared project state stays shared** (D-023, D-024). Frige books and
    their contracts stay shared, and their conversations record who
    created them and who moved them between states.
  - Making Frige projects private to one account is a separate decision.
- **Grants nothing.** The actor is attribution and ownership of personal
  state. It does not widen access: every signed-in account still has full
  use of Pantheon and Frige.
- **Local mode** has no secret, ignores actor headers, and acts as
  `local`.
- **Existing data.**
  - An existing knowledge journal is never moved or deleted.
  - The hosted journal is assigned to the account named by
    `STEX_KNOWLEDGE_LEGACY_OWNER`. Until that is set, the journal is
    preserved and reported, and no account can reach it.

## D-029 — No shared database yet; PostgreSQL stays the M3 destination

- **Basis.** D1 of the persistent workspaces program asked for a data-model
  decision. The program's entity list was checked against the A1, A2 and
  D2 workflows.
- **Decision.**
  - **Entities.** The A1, A2 and D2 workflows need only Session (a
    lifecycle on an existing conversation), Summary, Actor and transition
    events. Each lives with its owning service.
  - **No new database.** No shared database, organization, membership,
    job or connector entity is added until a workflow needs one.
  - **Destination.** PostgreSQL with pgvector stays the destination for
    knowledge metadata, ingestion records and jobs at M3, as the transition
    plan already records. One store is preferred over separate graph,
    vector and relational databases.
  - **Before M3.** M3 needs its own authorization, and must first specify
    a JSON-to-PostgreSQL migration with export parity and rollback.
- **Organizations** extend individual ownership later: an organization
  will be a further owner kind beside a person, never a precondition for
  a single user.

## Open decisions for the owner

See [the handoff](HANDOFF.md#current-work).
