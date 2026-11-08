# Pantheon platform transition

## Decision and scope

The 2026-11-07 architecture brief establishes the destination: **one platform,
modular capability engines, shared Igor intelligence, and persistent user
knowledge**. Development concentrates on the existing Frige, Seaxneat, and
Igor implementations. Ēostre and Woden remain deferred. Extensibility means
clear contracts and ownership, not implementing unused plug-in infrastructure.

The release directive adds two binding destinations: Python/FastAPI with
typed contracts for STEX-owned backend application logic, and Obsidian as the
direct human-facing knowledge integration. The plans below govern future
increments; neither migration is implemented during this merge/release.

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

Codex development subagents do not belong to the Igor/Hermes runtime roster.
Development instructions, permissions, budgets, tools and skills remain
separate from runtime policy and execution environments.

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
6. Use fake/stub inference for verification. The current release authorizes
   reviewed merges and the automatic Igor deployment only after release
   gates pass. It does not authorize paid calls, new cloud resources, runtime
   tools, Python backend rewrites or Obsidian synchronization.

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
The current opt-in vault adapter remains unexposed. Obsidian is the intended
direct human-facing knowledge integration, governed by the separate future
gate below. Harden symlink/junction and Windows alias handling before any
vault source is exposed; the vault never becomes an engine operational store.

Acceptance: an accepted synthetic revision updates both projections once;
replay is idempotent; missing/deleted/restricted sources stay unavailable;
stale events cannot replace newer context; inferred links can be rejected;
restart/rebuild and export/deletion work. No embeddings or multimodal search
claim without actual retrieval evidence. The applications still work when
knowledge integration is disabled.

## Python backend migration

**Approved architectural plan; implementation remains a required future
milestone.** Python is the target for STEX-owned application-backend logic,
using FastAPI and typed Python contracts. React/TypeScript presentation stays
in Pantheon; Node may remain for frontend builds, existing compatibility
boundaries and specialized external tooling. The current Node backends are
transitional implementations, not code to replace during this release.

Future backend changes must be scoped against this plan. Bounded fixes for
current compatibility, security, correctness and release parity may continue
in existing Node modules; they must preserve engine ownership and must not
establish a new general Node application-service architecture.

1. Inventory one candidate service's callers, versioned contracts, canonical
   storage, validation, authorization, failure behavior, cancellation and
   concurrency. Record the existing synthetic fixtures and acceptance checks.
2. Obtain authorization for one bounded migration slice with its owning paths,
   typed Python interface, storage strategy, dependencies and rollback. Select
   the Python toolchain and dependency versions from verified requirements at
   that milestone; this release introduces none.
3. Implement a compatible Python/FastAPI slice behind the existing versioned
   boundary. Preserve request/reply shapes and errors, explicit acceptance,
   stale-write safeguards, byte fidelity, idempotency and isolation. A language
   change alone does not justify a breaking contract or a shared engine store.
4. Prove parity with differential contract/negative tests, disposable storage
   and real owning workflows. Include LuaLaTeX/PDF or Next build evidence when
   the migrated slice claims those capabilities. Keep approved UI and assets
   unchanged and test rollback to the working compatibility implementation.
5. Switch routing only after owning/full suites, browser workflows and an
   independent review pass. Retire a Node application slice only when no
   caller depends on it and recovery is verified. Repeat incrementally.

No step may rewrite protected manuscripts, conversations, user-authored vault
notes or validated workspace history. No application may import another
engine's private implementation as a migration shortcut. Upstream Hermes
source and its Python environment remain separately owned runtime tooling;
this plan is not an upstream rewrite or runtime upgrade.

## Direct Obsidian integration

**Required future milestone; no synchronization implementation in this
release.** Obsidian is the direct human-facing knowledge integration, not
merely an interchangeable Markdown folder. The existing metadata journal,
portable vault scaffold and unexposed read-only adapter are foundations.
The target must work with an actual user-selected Obsidian vault while
preserving user control, portability, provenance and privacy.

Before implementation, specify a versioned reconciliation boundary covering
ownership of human-authored versus projected fields, stable identities,
frontmatter and wikilinks, source locators, consent, authorized events, and
explicit diff/conflict review. Preserve unknown note metadata and intentional
content. Human edits and engine revisions must not silently overwrite each
other. Define deletion/revocation, tombstones, ordering, replay, export,
retention and correction before enabling write-back.

Acceptance requires a disposable actual vault exercised through Obsidian,
not just Markdown enumeration: create/edit in the human interface, approved
reconciliation in both relevant directions, competing-edit conflict handling,
source/revision provenance, withdrawn access, restart/replay, deletion/export
and recovery. Include executable symlink/junction and Windows alias negative
tests before exposing vault reads. Keep private notes, attachment content,
transcripts and credentials out of engineering evidence.

The knowledge base and User Graph remain coordinated projections over shared
canonical references. A vault is never an engine database, queue, lock,
credential store or source of implicit execution authority. Applications must
remain usable when knowledge integration is disabled. Full multimodal
retrieval, shared identity and Igor runtime tools have separate acceptance
and security gates; none follows automatically from Obsidian integration.

## Risks and publication

The main risks are canonical state duplication, presentation migration
regressions, generated content crossing the trust boundary, mistaken authority
from references, and undocumented partial transitions. Each stage must have
failure tests and an independent review before acceptance.

P0–P4 were published as reviewed branches with local acceptance evidence.
The current release directive authorizes reviewed merges, associated pushes
and automatic Igor deployment conditionally on verification and production
safety gates. Reconcile instructions and restore effective CI first; merge
Igor, verify its active release, authentication, preserved records and rollback,
then pin that merged revision in the suite and merge the suite after its gates.
Do not treat a skipped test job or a planned deployment as completed evidence.

The release is in progress. Exact merge revisions, CI results, production
checks and final repository state belong in
[the release report](verification/platform-release.md) and [STATUS.md](STATUS.md).
Earlier acceptance reports remain historical. No credential/permission change,
billable runtime workload, runtime tool enablement, Python rewrite or Obsidian
sync service is implied by this release authorization.
