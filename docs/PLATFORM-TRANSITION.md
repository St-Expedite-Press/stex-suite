# Pantheon platform transition

## Decision and scope

The 2026-11-07 architecture brief establishes the destination: **one platform,
modular capability engines, shared Igor intelligence, and persistent user
knowledge**. Development concentrates on the existing Frige, Seaxneat, and
Igor implementations. Ēostre and Woden remain deferred. Extensibility means
clear contracts and ownership, not implementing unused plug-in infrastructure.

Pantheon owns the common web environment and progressively composes working
surfaces from engine APIs. Engines retain canonical state and deterministic
operations; a user must be able to publish or develop without involving a
model. Process and deployment separation follow an actual isolation or
dependency need, not the number of capabilities.

This is a migration of the implemented system, not a rewrite or a claim that
the destination already exists. [STATUS.md](STATUS.md) records implementation;
dated [verification reports](verification/README.md) record evidence.

## Ownership at the destination

| Layer | Owns | Does not own |
| --- | --- | --- |
| Pantheon | Navigation, shared presentation, workspace composition, selected project context, display of engine results | Manuscripts, website Git history, engine operation state, provider credentials |
| Frige engine | Manuscripts, editorial revision authority, typography, builds, proofs, preflight | Platform identity or other engines' storage |
| Seaxneat engine | Website workspaces, validated revisions, proposals, builds, preview lifecycle | Platform identity or conversation records |
| Igor runtime | Hermes-derived reasoning and, when separately secured, authorized tools | Product canonical state, rendering, knowledge truth |
| Igor Director | The existing `pantheon-director` role and `igor` runtime profile | A second runtime or a new platform database |
| Igor conversation service | Conversation records, pending/failure state, inference boundary and hosted session checks | Manuscripts, website files, implicit authority to execute tools |
| Knowledge architecture | Source/artifact and user-context projections with provenance | A second copy of canonical engine state, credentials, queues or locks |

Igor names the intelligence layer and its Director in product language. The
current implementation adapts a **pinned upstream Hermes checkout**; it is
not evidence of a separately maintained source fork. Internal Hermes paths
and `stex.hermes.turn.v1` keep their names. The hosted chat is one working
Igor surface. P3 now establishes explicit project context locally; hosted
deployment and runtime tool execution remain separately gated.

## Migration rules

1. Keep a working engine and its state while migrating one presentation slice.
   Compatibility routes remain explicit; never share an engine's private
   modules or storage with Pantheon.
2. Give each new cross-boundary API a versioned contract covering validation,
   authority, errors, concurrency, bounds, and migration. Existing v1/v2
   contracts keep their meaning. The application registry remains navigation
   metadata, not an engine permission grant.
3. Treat browser selection as a reference, never authority. Engine servers
   validate every operation. Save/accept/build/restore retain their existing
   confirmation, stale-write, and failure semantics.
4. Keep local single-user entry distinct from hosted Igor password sign-in.
   Unified accounts and permissions require a separate identity design and
   acceptance gate; frontend composition does not silently introduce either.
5. Keep authored previews and artifacts outside the trusted platform document.
   A sandboxed preview must not gain same-origin access to Igor or Pantheon.
6. Use fake/stub inference for verification. This transition requires no paid
   calls, new cloud resources, enabled runtime tools, or production release.

## Ordered delivery plan

### P0 — architecture and documentation foundation

Reconcile the charter, architecture, manuals, protocol overview, active
application documentation, knowledge documentation, and evidence index.
Distinguish IMPLEMENTED/TESTED from SPECIFIED/PLANNED. Preserve historical
reports and protected source. Correct obsolete conversation ownership,
remote-verification, hosted sign-in, and rollback claims.

Acceptance: review the actual implementation; audit documentation links and
commands; obtain an independent review of the final diff and evidence.

### P1 — first working platform composition

Make Pantheon a pure platform boundary by moving its legacy book operations
behind a Frige-owned compatibility API. Preserve the legacy response shapes
without retaining a second book store or duplicating mutation logic.

Compose the existing Seaxneat development workflow as a Pantheon-owned
workspace: create/select a project, prepare/review/apply a bounded edit,
inspect a diff, restore a validated revision, and build/open a preview. Reuse
the Seaxneat store; introduce a versioned workspace HTTP boundary. Keep the
standalone route as a compatibility surface. Use the common platform shell
and design tokens, with honest unavailable and failed states.

Acceptance: failing regression tests for routing and API behavior; owning
suites and full deterministic suite; TypeScript/production build; disposable
browser create/edit/diff/restore/preview workflow; failed-build and stale
proposal evidence; sandbox negative check; no protected manuscript changes.

P0 and P1 are accepted increments, not the endpoint of the owner's goal.
Continue through P2, P3 and the bounded P4 knowledge foundation, updating
acceptance evidence as each stage works. The active applications remain Frige,
Seaxneat and Igor; Ēostre/Woden and speculative plug-in infrastructure stay
deferred. The full goal is incomplete while required transition stages remain
planned or unverified.

### P2 — publishing presentation

Implemented and tested: [P2 evidence](verification/platform-transition-p2.md).

Migrate Frige's existing library and manuscript workstation into Pantheon
presentation ownership through a versioned publishing API. Keep the current
source model, editor semantics, PDF viewer, profile/preflight behavior,
scoped conversations, and proposal acceptance. Retire duplicate mastheads as
each screen moves. Do not replace the mature editor with a shallow new one.

Acceptance: disposable create/select/save/stale-save/propose/accept workflow;
LuaLaTeX proof and compiler-derived page map; design/preflight freshness;
desktop/tablet/phone and keyboard checks; protected manuscript hashes stable.

### P3 — contextual Igor surfaces

Implemented and tested locally: [P3/P4 evidence](verification/platform-transition-p3-p4.md).
The private renderer is composed over `stex.igor.interface.v1`; explicit
source preview/approval/withdrawal uses [context v1](../protocol/context/README.md).

Compose conversation presentation within the common environment while keeping
the existing conversation service as record owner and inference client.
Introduce explicit project/reference and bounded context selection in a new
contract when existing semantics are insufficient. A user can inspect which
sources are offered and withdraw them. Switching projects must not silently
share a conversation, provider session, or engine authority.

Acceptance: fake/stub continuity, context selection, cross-project/session
isolation, cancellation, retry, duplicate-submit behavior, hosted auth
regressions, and no browser inference secret. Runtime engine tools remain
separately gated on executable isolation and authorization tests.

### P4 — knowledge projections

The bounded metadata foundation is implemented and tested locally:
[P3/P4 evidence](verification/platform-transition-p3-p4.md),
[knowledge contract](../protocol/knowledge/README.md). It is opt-in, retains
references rather than source text, and never mines transcripts. Engines
emit monotonic accepted-source observations on explicit user selection;
the host checks access on display and on an explicit knowledge-to-Igor handoff.
Broader semantic/multimodal retrieval and vault integration remain future work.

Implement one engine event and one reconstructible projection before adding
semantic retrieval. Start from an explicitly accepted revision and reference
its canonical engine identity and revision. Do not infer a user's psychology
from a transcript or add two databases that continuously overwrite each other.

The two coordinated projections have distinct purposes:

- The **Pantheon knowledge base** organizes source material, artifacts,
  extracted content, and retrieval representations with source locators.
- The **User Graph** models user-asserted concepts, preferences, projects,
  commitments, and relationships; inferred relationships remain proposals
  with evidence, confidence, and correction/rejection controls.

Co-extensional means the projections can describe the same relevant entities
and relationships without duplicating assets. Interoperable means stable
identities, revision references, provenance, and compatible query/export
representations. Co-evolutionary means accepted changes can update derived
context in either direction through deliberate, authorized operations. A graph
inference can never rewrite an engine's canonical artifact.

Before implementation, specify entity/revision/event schemas, explicit consent,
assertion/inference distinctions, source access checks, retention/export/
deletion, replay and deduplication, out-of-order and missed events, correction,
and rebuild after a crash. Keep application operation journals in engines.
The optional Obsidian vault remains a portable knowledge adapter, not a
database requirement. Harden symlink/junction and Windows alias handling
before exposing its current local reader to a browser.

Acceptance: an accepted synthetic revision updates both projections once;
replay is idempotent; missing/deleted/restricted sources stay unavailable;
stale events cannot replace newer context; inferred links can be rejected;
restart/rebuild and export/deletion work. No embeddings or multimodal search
claim without actual retrieval evidence. The applications still work when
knowledge integration is disabled.

## Risks and publication

The main risks are canonical state duplication, presentation migration
regressions, generated content crossing the trust boundary, mistaken authority
from references, and undocumented partial transitions. Each stage must have
failure tests and an independent review before acceptance.

The owner authorized GitHub publication for this goal. Publish review branches
in both repositories where needed, pushing the submodule branch before the
suite pointer. `stex-igor/main` automatically deploys; production deployment,
credentials, permissions, paid calls, and remote runtime workloads remain
outside this increment. Record exact revisions and verification limits in
[the acceptance report](verification/platform-transition-p1.md).
