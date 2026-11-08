# STEX Pantheon — platform architecture

STEX Pantheon is a unified, extensible creative computing platform. Its common
web environment composes specialized capability engines. Igor is the
Hermes-derived intelligence layer; its Director coordinates reasoning and,
when authorized and technically isolated, tools. The knowledge architecture
is intended to join source/artifact retrieval with a persistent User Graph
functioning as a digital twin and second brain.

This definition describes the destination. The [transition plan](PLATFORM-TRANSITION.md)
sets delivery order and acceptance gates; [STATUS.md](STATUS.md) distinguishes
implemented and tested behavior from specified or planned work.

## One platform, modular engines

Pantheon owns common presentation, navigation, workspace composition, and the
display of engine results. The first composed workspace is Seaxneat's website
development surface, implemented in Pantheon and backed by a versioned engine
API. Frige's existing library and mature manuscript workstation also live in
Pantheon and use an additive publishing v1 engine boundary. Igor's conversation
surface is composed in the common shell through a versioned descriptor served
by the private Igor application; its renderer and records remain owned there.

Frige owns manuscripts, source revisions, editorial acceptance, typography,
LuaLaTeX proofs, and preflight. Seaxneat owns website workspaces, Git history,
bounded proposals, validated revisions, builds, and preview lifecycle. A
failed build cannot advance the last validated revision. Pantheon owns no
second project store and never reads an engine's files; even its historical
book API now proxies a Frige-owned compatibility boundary.

The engines need not become separate deployed microservices. Process and
deployment boundaries follow dependency, security, or scaling requirements.
Deterministic operations run directly through engine APIs without Igor.
Application capabilities are operations; agent skills describe how reasoning
can use those operations. Their contracts and authorities remain distinct.

## Igor: runtime, Director, conversation surface

Igor has three meanings that must stay explicit: the Hermes-derived runtime,
the existing Pantheon Director role/profile, and the conversation surface.
The implementation adapts a pinned upstream Hermes checkout with STEX
configuration; it does not maintain a separately verified source fork.
Internal Hermes identifiers and the stable turn contract retain their names.

The Igor application owns conversation records and pending/failure state.
Pantheon's home composer hands off to that service and stores no conversation
identity or inference secret. Frige retains its scoped editorial threads.
Project links now open explicit source selection in Igor. Users preview exact
source text, identities and revisions before approval. Igor retains the
accepted snapshots as conversation consent/provenance, not canonical engine
state. Each conversation is bound to one project. A selection change or
withdrawal creates a fresh reasoning epoch and excludes earlier-epoch history
from future turns; queued and retried turns retain their accepted snapshot,
and retries after withdrawal are refused. Earlier transmitted records are
not erased by withdrawal.

The only application-facing runtime path is server → inference → Hermes.
Provider keys stay in the runtime environment. Request/reply validation,
context bounds, time/output limits, cancellation and failure classification
remain enforced at their owning boundaries. The normal local stack uses fake
inference. Earlier I1/I2 evidence records provider-backed Igor verification
and hosting; it does not prove Frige remote exchanges or general tool safety.
An operator acknowledgement or empty tool request is not OS isolation.

Local Pantheon entry creates no authenticated session. Hosted Igor has its own
password sign-in; its deployment is distinct from the local platform.
Platform-wide identity and permissions remain future work.

## Knowledge: coordinated projections

The Pantheon knowledge base organizes sources, artifacts, extracted content,
retrieval representations and evidence. The User Graph organizes the user's
explicit concepts, preferences, commitments, projects, relationships and
revisable inferred context. Both reference canonical entities and revisions;
neither duplicates or overrides engine state.

They are **co-extensional** in relevant scope without requiring duplicate
assets, **interoperable** through compatible identities and provenance, and
**co-evolutionary** through deliberate accepted changes and derived context.
Every inference needs supporting evidence, confidence, and correction or
rejection. An agent's suggestion is not a fact or permission grant.

The implemented P4 foundation is optional and local: accepted engine revision
events update a metadata source/provenance view and a user-context view through
one durable, reconstructible journal. Assertions stay distinct from inferred
relationships, which require evidence and confidence and can be corrected or
rejected. Replay, revision ordering, withdrawal, export and erasure have
explicit semantics. Source text remains at the engine; current access and
revision checks gate use of stored references. Accepted relationships can be
previewed and deliberately sent to Igor as a new user message.

This is a bounded knowledge foundation, not a complete digital twin. There
are no embeddings, multimodal retrieval, automatic transcript mining, or
implicit engine writes. The separate portable Obsidian vault remains
optional and unexposed to the browser, never an execution queue, credential
store, or second canonical application database. See the
[knowledge contract](../protocol/knowledge/README.md).

## Extensibility and limits

Versioned contracts express ownership, validation, authority, errors, bounds,
and migration. The registry supplies navigation identities only. Existing
projects, conversations, and inference contracts keep their meanings;
new engine APIs are additive. References never bypass engine authorization.
Generated previews are sandboxed and engine APIs refuse foreign/opaque browser
origins. Read-only generated resources remain available to their opaque
preview frame; authored content stays outside trusted platform presentation.

Development concentrates on Frige, Seaxneat, and Igor. Eostre and Woden remain
honestly deferred. No speculative scheduler, universal database, agent swarm,
or third-party plug-in runtime is needed to make the existing tools coherent.
See the [protocol overview](../protocol/README.md) and
[acceptance report](verification/platform-transition-p1.md).
