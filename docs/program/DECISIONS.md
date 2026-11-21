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

## Open decisions for the owner

See [the handoff](HANDOFF.md#decisions-waiting-on-the-owner).
