# STEX resource and knowledge model

Wave B architecture, 2026-11-25. Existing authority comes from
[D-023, D-027, D-028 and D-029](../program/DECISIONS.md) and the
[versioned interfaces](../../protocol/README.md). This model assigns
owners and specifies the proposed protocol shapes. Each new runtime
surface needs implementation and acceptance evidence.

## Resource authority

Use the owning application's stable reference and opaque native ID.
Keep existing `stex://` references and their versioned resolvers.
Cross-application consumers need the owner, kind, and reference, plus
an owner-issued revision for any pinned evidence. Names and paths are
display data. A reference grants no access. A canonical record carries
its owner, appropriate actor and scope, creation and update times,
revision, provenance, and retirement status where the lifecycle needs it.
Project summaries, search hits, and graph edges are rebuildable views.
Shared vocabulary gives the same resource kind the same meaning across
products while each owner validates its own fields and writes.

| Kind | Authoritative owner | Shared projection or lifecycle |
| --- | --- | --- |
| Account | Igor for current hosted accounts | Pantheon admits the authenticated user. D-028 is attribution, with local mode remaining single-user. A durable account ID is a later identity decision. |
| Organization | Future platform identity boundary | Introduce when an approved shared-workspace workflow needs one. Press keeps separate commercial identity. |
| Membership | Future platform identity boundary | Current membership and role determine access to an organization. Personal data has independent access rules. |
| Workspace | Seaxneat for website workspaces. Future platform ownership for general collaborative workspaces. | Separate workspace types and per-owner access. The shell composes navigation over references. |
| Project | The creating studio | Reuse `stex.projects.summary.v1` and retain each studio's project state. |
| Session | Igor for chats and working sessions, Frige for editorial conversations, later engines for their own sessions | Share D-027 semantics. Use existing source-bound summary revisions for continuation and explicit contributions. |
| Document | Frige for manuscripts and its uploaded originals. A connector's origin owns its source unless the user explicitly imports a copy. | The authorized catalog can project metadata and extraction state. Preserve the exact source revision and consent. |
| Revision | The resource's owner | Opaque revision or digest. Frige owns editorial bases and attachment bytes, Seaxneat owns Git revisions, Igor owns summary revisions. |
| Passage | Owner of the document extraction or manuscript revision | Cite the document and revision plus a locator that can be verified against that revision. Re-segmentation creates a new index generation and preserves citation resolution where the source is retained. |
| Artifact | Engine or job owner that produced or imported it | Export read models carry provenance, media kind, revision, and access decisions. A Frige proof remains distinct from its source manuscript. |
| Entity | Knowledge service for user or project knowledge | An entity may reference canonical resources. Merges require approved identity evidence and preserve provenance. |
| Claim | Knowledge service for reviewed knowledge, with source references resolved by their owners | Preserve assertions, provisional inferences, review decisions, contradictions, and supersession. |
| Relationship | Knowledge service for knowledge edges, engine for operational relations | Graph projection checks both endpoints and edge scope before disclosure. |
| Decision | Engine for operational decisions, knowledge service for explicitly accepted intellectual decisions | A Frige editorial decision remains Frige's record. A contribution can cite it without importing authority. |
| Preference | Current application for its settings. A future platform preference service for explicitly shared conventions. | Provide personal, workspace, project, and resource scopes only where the owner defines precedence and effective-setting provenance. |
| Agent run | The service that accepted and executes the work | Record objectives, inputs, grants, version, limits, state, outcomes and cancellation. Igor and inference retain their distinct responsibilities. |
| Capability grant | Service that owns the protected operation | Carry actor, allowed operation, scope, expiration, and revocation. Delegation narrows the original grant. |
| Connector | Future user-authorized platform knowledge boundary | Connector adapter owns external cursors and identity mappings. The source remains under its original authority until explicit import. |

## Knowledge and evidence

Preserve D-029's storage decision. Current metadata journals and engine
stores keep their authority. M3 targets PostgreSQL for durable knowledge
and ingestion metadata after a workflow establishes need. Relational
tables can represent owner-scoped resources, links, dependencies, and
transactional approval. Rebuild search and graph views from those records.
Examples of workload tests include per-account lexical retrieval,
revision lookup, bounded graph expansion, contention during approval,
and deletion with dependent views. Consider pgvector after measuring the
lexical baseline. Consider a dedicated graph store only if measured
traversal needs exceed relational projections and the replacement can
preserve access and deletion parity. [D-029](../program/DECISIONS.md#d-029--no-shared-database-yet-postgresql-stays-the-m3-destination) ·
[PostgreSQL text search](https://www.postgresql.org/docs/current/textsearch-intro.html)

Keep original bytes, extraction, authored note, agent proposal, verified
claim, provisional inference, approved decision, and current task context
as distinct records or views with explicit provenance. Review and evidence
change claim status. A model output enters as a proposal. Record the source
revision, passage locator or stable reference, origin actor, method, and
review outcome so evidence can be traced and withdrawn. A contradiction
can coexist with the claim it challenges.

Initial relationship vocabulary is directional and independently reviewable.
Examples are `references`, `derived_from`, `supports`, `contradicts`,
`belongs_to`, `authored_by`, `supersedes`, `discusses`, `depends_on`,
and `produced_by`. A relationship record includes typed endpoints, owner,
audience, evidence, revision, and review status. Domain-specific operational
relations can be projected under versioned contracts.

### Permission and failure behavior

Use admitted identity, current owner permissions, the record's audience,
and specific consent or delegated capability at the point of use.
Membership may grant access to a shared resource and leaves personal
permissions with their owner. Reserve audience changes for an explicit
user decision. Project association, context offers, and host actor headers
are insufficient to widen access.

Apply the same rule to metadata, search results and counts, backlinks,
each graph expansion, embeddings, export and context hydration. Verify a
source or passage's revision before supplying content. On denial or
unavailable authority, omit private records and any counts or edges that
would reveal them. Stale approvals fail without mutating the base.
Withdrawal first removes the record from future reads. Reconcile indexes,
caches, and dependent views through durable, replayable cleanup. Record
cleanup failures and keep affected entries suppressed until resolved.
Backend policy remains authoritative. Where PostgreSQL row security is
used, a least-privileged query role and cross-account tests are required.
[PostgreSQL row security](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)

## Protocol work

Extend the owning contracts additively. The following describes what
callers and failure tests must establish before a new version is published.

| Boundary | Proposed envelope and checks |
| --- | --- |
| Knowledge reference | Resource kind, owning application, stable reference, optional pinned revision and locator. Validate with the owner when resolving. Distinguish stale revision and unavailable service inside the trusted boundary. Preserve private existence at the public boundary. |
| Knowledge contribution | Source revision, bounded selection, target audience, origin and reason, base knowledge revision and idempotency key. Separate propose, authorize, accept, and withdraw. Review approved conclusions without copying the whole transcript. |
| Retrieval | Approved project and actor scope, query, source filters, result and byte limits. Return accessible reference and revision, citation locator, and bounded snippets. Hydrate the selected passages after rechecking access. |
| Connector | Owner-admitted selected root, operation, opaque external ID and revision, cursor, provenance, change plan and idempotency key. Preview before import or export. Record conflicts without overwriting competing edits. No direct app-database access. |
| Execution | Objective, selected inputs, capabilities, deterministic gates, iteration and cost limits, deadline, cancellation, stop and escalation, and recorded outcome. A worker receives only the scoped input and attenuated grant. |

### Markdown and connectors

Export user-readable source records, topic and entity pages, project and
research notes, decisions, session summaries and reference collections with
stable references and revision metadata. An engine-owned record keeps its
authoritative source. A user-authored Markdown note keeps its bytes and
unknown frontmatter unless its owner chooses a reviewed change. Resolve
links by stable identity and scoped path. Report ambiguous links, moves,
and conflicting revisions for review. Begin Obsidian integration with
one-way operations and explicit scope. Keep future Drive, Zotero, Git,
Notion and mail adapters behind the same boundary.

## First implementation and acceptance order

1. Extend the authorized Frige upload path with an original-byte hash and
   same-book duplicate detection. Keep existing IDs, original paths, and
   excerpt review authority. Check concurrent and repeated uploads and
   material without a stored digest. Treat conversion output separately.
2. Establish stable document and passage records and an authorized lexical
   retrieval baseline on a synthetic corpus. Include two actors, a
   private edge to a shared project, a stale revision, a withdrawn source,
   and exact expected citations. Measure ranking and latency before
   adding semantic indexing.
3. Add approval, maintenance, reprocessing and deletion one owner at a
   time. Establish migration, export parity, rollback, quotas and
   cancellation before committing to the M3 store or a hosted scheduler.
4. Integrate approved retrieval and session contributions with Igor and
   Frige. Verify responsive navigation, document context, session actions,
   approval and recovery with real browser interactions. Keep the shared
   interface anchored to Pantheon's approved design.
5. Gate Obsidian import/export on a user-selected scope and synthetic
   conflict, link, path, and withdrawal cases. Gate hosted Seaxneat on
   executable build-isolation tests. Its existing product scope is
   website project editing, validated builds, and revision previews.

### Selective passages

The first retrieval increment should expose read-only passage previews
through Frige for a book the current actor may open. A locator needs the
owner-issued document ID, original digest where available, recorded
extraction revision, and a bounded segment range. Keep revision changes
visible. Preserve exact text and any proven page or structure locator
from conversion. The author approves chosen passages against their
extraction revision and segment bytes. The old prefix approval keeps the
scope it was granted for.

The retrieval test comes before a model caller. Exercise known queries,
expected passage IDs and exact citation text for two actors, including
stale, revoked, corrupt and denied cases. A preview or index match may
lead to explicit approval. The approved context path checks the actor,
revision and byte budget again before sending text to Igor.

See the [Second Brain OS assessment](second-brain-reference.md) for the
reference patterns and the [user-facing status](../STATUS.md) for current
implementation.
