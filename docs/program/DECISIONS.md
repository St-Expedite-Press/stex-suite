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

- **Status:** Proposed.
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

## Open decisions for the owner

See [the handoff](HANDOFF.md#decisions-waiting-on-the-owner).
