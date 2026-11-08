# Knowledge projections v1

## Local HTTP host

Pantheon hosts this service at `/api/knowledge/v1`, opt-in through
`STEX_KNOWLEDGE_DATA_DIR` (use ignored `services/knowledge/.local-data/`).
Disabled reads return `{enabled:false}` and perform no engine access.
Loopback Host, same browser Origin, JSON mutations and a 16,384-byte body
limit protect the host. Engine requests use configured loopback origins,
fixed context-export paths, no redirects, five-second call timeouts and a
65,536-byte response cap. Browser event payloads are never accepted directly.

| Method / suffix | Behavior |
| --- | --- |
| `GET /` | Both views, with current owner access labels |
| `GET /sources?project=<ref>&offset=0` | Owner source catalog, 50 per page |
| `POST /accept` | `{expectedVersion,idempotencyKey,project,sources:[{id,revision}]}`; owner revalidates exact revisions and emits observation before journal acceptance |
| `POST /revoke` | `{expectedVersion,idempotencyKey,project}` |
| `POST /relation` | `{expectedVersion,idempotencyKey,relation}`; requires current accepted revision evidence |
| `POST /revise` | `{expectedVersion,idempotencyKey,id,status,object?}` |
| `GET /export` | Detached provenance journal and views; no raw engine source |
| `POST /erase` | `{expectedVersion,confirmation:"delete-knowledge"}` |

Owner observations persist one current checkpoint per project. Identical
metadata selections reuse their event identity/sequence; a different observed
accepted selection/revision advances the sequence. Failed/stale source reads
never advance it. This is an explicit observation workflow, not an automatic
stream of every editor change. Checkpoints live in Frige `.texgraph/` and
Seaxneat's ignored project directory. They are not canonical creative source.

Current access checks examine at most 40 accepted sources, four concurrently,
within one six-second deadline. Unchecked, changed, deleted, restricted or
unreachable sources are labelled unavailable; relationships inherit unavailable
evidence. Graph's optional preview handoff offers only accepted relationships
with current evidence, rechecks access, then creates a fresh Igor conversation
with the exact visible text. Knowledge itself grants no model or tool authority.

`stex.knowledge.projections.v1` defines explicitly accepted, reconstructible
knowledge metadata. The implementation is
[`services/knowledge/src/projections.mjs`](../../services/knowledge/src/projections.mjs).
The engine event shape is [`revision.v1.schema.json`](revision.v1.schema.json).

This boundary grants no engine filesystem, mutation, provider, vault, identity,
or runtime tool authority. Frige and Seaxneat remain canonical owners. A source
reference is a locator, never permission to read it. Source text is fetched
from the owner under `stex.project.context.v1`; it is not stored in this
projection journal. There are no embeddings or semantic retrieval claims.

## Acceptance and ordering

The owner emits `{id, sequence, occurredAt, project, sources}`. `project`
contains the canonical application, id, `stex://` reference, and title.
`sources` contains exact source identities, SHA-256 content revisions, titles,
media types, byte counts, and optional validated Git origin revisions. A
revision event is a complete replacement of the explicitly accepted source
set for that project, including removals. At most 50 sources are accepted in
one event. Raw `source` content, if present in an owner reply, is discarded.

An engine maintains an increasing positive `sequence` per project. Its event
identity must remain stable when the same revision event is retried. It must
not fabricate a new sequence for an unvalidated or failed edit. The consumer
must verify the event against the owner immediately before explicit user
acceptance. Arbitrary browser-supplied event payloads are not trusted exports.

The library does not make HTTP calls. Its host must use configured owner
origins, check all identities and revisions, and recheck access before
displaying or offering any stored source. Missing, deleted, restricted,
unavailable, or changed source revisions must be labelled unavailable and
excluded from retrieval/context. An old revision hash alone cannot establish
chronological order or prove current access.

`accept({idempotencyKey, expectedVersion, event})` changes both projections in
one atomic journal write. `expectedVersion` is the current opaque
`<generation UUID>:<journal count>` token. A mismatched token returns
`STALE_KNOWLEDGE` (409). An event sequence at or below the accepted project
sequence returns `STALE_EVENT` (409); an already recorded event id under a new
key returns `EVENT_CONFLICT` (409), except for explicit consent renewal of the
exact current withdrawn checkpoint described below. Retrying the identical operation under its
original idempotency key returns the current view with `replayed: true`,
without reapplying the event. Reusing a key for changed input returns
`KEY_CONFLICT` (409). Replays therefore cannot undo a later withdrawal.

Missed events can be recovered by fetching a complete latest owner event and
accepting it deliberately. Intermediate sequences need not be present.
Changes in knowledge never write back to an engine or advance its validated
revision. The engines operate normally while this integration is disabled.

## Coordinated views

`view()` returns `{enabled, version, knowledge, graph}`. The knowledge view
contains `sources` with canonical source/project references, revisions, event
identity, and owner occurrence time. The graph view contains `projects` with
accepted sequence, consent state, source count, and the same references, plus
`relations`. These are two projections from one journal, not two independently
synchronized databases.

`relation({idempotencyKey, expectedVersion, relation})` accepts a relationship
with an 8–80 character safe id, `kind`, `subject`, `predicate`, `object`, and
an evidence list. The subject is a Frige/Seaxneat project reference or an
explicit `stex://knowledge/concept|preference|commitment/<id>` reference.
Predicates are 1–120 characters; objects are 1–1,000 characters. All text
rejects control characters. At most ten evidence records identify exact
accepted source revisions. Unsupported references and stale evidence fail.

- `assertion` means the user explicitly states the relationship. Its initial
  status is `accepted`; evidence may be empty.
- `inference` means a hypothesis offered for review. It requires at least one
  evidence record and a finite confidence between 0 and 1. Its initial status
  is `proposed`. No inference is automatically generated from conversation.

`revise({idempotencyKey, expectedVersion, id, status, object})` accepts,
rejects, or corrects the object of an existing relationship. Status is
`accepted` or `rejected`. `object` is optional; omitting it preserves the
existing object for an acceptance/rejection-only action. The original kind and evidence remain preserved;
acceptance does not turn an inference into an asserted fact. A corrected
object sets `corrected: true`. To change a predicate or subject, reject the
old relationship and add an explicit new one under a new id.

Relations expose `evidenceState: current|unavailable`, where *current* means
the evidence matches the locally accepted projection. It is not proof of
present owner access. New accepted source revisions or consent withdrawal
make previous evidence unavailable until explicitly corrected/replaced.

## Consent, retention, export and deletion

`revoke({idempotencyKey, expectedVersion, project})` withdraws current source
consent, empties the project's projected source set, and marks dependent
evidence unavailable. A tombstone retains project identity and last sequence,
preventing old events from replacing newer knowledge. Prior provenance and
assertions remain in the journal, visibly distinct from available sources.
New source acceptance after withdrawal requires an explicit action and the
current version token. A newer owner event follows normal sequence ordering.
The exact currently withdrawn checkpoint can also be accepted again under a
new idempotency key after fresh owner access/revision checks: its event id,
sequence, and complete normalized metadata digest must match the previously
accepted checkpoint. Changed or older events cannot use this exception.
Original-key replay never renews consent.

`export()` returns a detached view plus its metadata journal. It contains
user assertions and source titles/references and must be treated as user
data. Export does not fetch canonical assets or include manuscript text,
provider traces, credentials, or transcripts.

`erase({expectedVersion, confirmation: 'delete-knowledge'})` atomically
replaces the journal with an empty one and a new generation UUID. It deletes
this service's stored project metadata, assertions, inferences, event
history, and idempotency keys. Old operation versions are invalid after
erasure and cannot repopulate it through replay. This does not erase engine
sources, conversation records, user exports, filesystem snapshots/backups,
or provider-retained records. Erasure is not a forensic disk wipe.

## Durability and limits

`openKnowledge({directory})` is disabled without an explicitly selected
directory. The host chooses ignored local state, never the Obsidian vault.
The enabled service uses one writer process, an advisory process lock, a
serialized queue, and flushed temporary-file/atomic rename writes.
`close()` releases the lock after accepted writes finish. An active or
unreadable lock fails closed; a lock from a dead process can be recovered on
startup. Orphan temporary files are not read as journals.

Dead-lock recovery is serialized by an exclusive `knowledge.recovery` claim.
An interrupted recovery fails closed if that claim remains: an operator must
verify no writer is active before removing the claim. The service never
guesses that an unreadable lock or a reused live process id is safe to steal.

The only persisted database is `knowledge.v1.json`: an ordered journal of
revision acceptance, revocation, assertions, and corrections. Both views are
reconstructed from it on startup. Malformed journals are preserved and cause
startup failure. A failed write does not change the in-memory projection.
The journal allows 10,000 accepted operations and 8 MB of UTF-8 JSON. The
consumer must export/erase deliberately when the limit is reached; it must
never silently discard old records. Local writer data is trusted local state;
the host is responsible for filesystem access restrictions and backups.
