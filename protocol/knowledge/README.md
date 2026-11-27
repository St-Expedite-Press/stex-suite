# Knowledge projections v1

## Local HTTP host

Pantheon hosts this service at `/api/knowledge/v1`, opt-in through
`STEX_KNOWLEDGE_DATA_DIR` (use ignored `services/knowledge/.local-data/`).
Disabled reads return `{enabled:false}` and perform no engine access.
Loopback Host, same browser Origin, JSON mutations and a 16,384-byte body
limit protect the host. Engine requests use configured loopback origins,
fixed context-export paths, no redirects, five-second call timeouts and a
65,536-byte response cap. Browser event payloads are never accepted directly.

The platform API host (`STEX_KNOWLEDGE_SERVICE=platform`) applies the same
admission before any route: `Host` must be a loopback name or a service name
listed in `STEX_INTERNAL_HOSTS`; a `Sec-Fetch-Site: cross-site` request or an
`Origin` naming any other host is refused with `403`. A storage failure
(for example a full disk) answers `503 KNOWLEDGE_UNAVAILABLE`; writes replace
files atomically, so the earlier state stands. `contributions/resolve`
re-checks the contribution after reading the source, so a withdrawal or
erasure committed during that read wins.

### Personal journals (hosted)

Hosted, the journal is chosen from the signed-in user the host admitted, never
from a header or body. It lives in
`<STEX_KNOWLEDGE_DATA_DIR>/people/<username digest>/knowledge.v1.json`.
The directory name is the first 32 lowercase hex digits of SHA-256 over the
username's UTF-8 bytes. For usernames containing unpaired UTF-16 surrogates,
the input is byte `0xff` followed by the UTF-8 bytes of the JSON-encoded
username. One person cannot read, export, revise
or erase another's journal. Without a signed-in user the host answers `401`.
A journal that cannot open answers `503` for that person only. A journal
already at the root of the data directory is never moved, rewritten or
deleted; `STEX_KNOWLEDGE_LEGACY_OWNER` names the one username that uses it.
While it exists and no owner is named, `GET /` adds the additive field
`legacyJournal: "unassigned"` (presence only, no contents). Local mode (no
signed-in user) uses the configured directory unchanged. When the host holds
`STEX_PLATFORM_ACTOR_SECRET`, its engine fetches carry the
[platform actor](../platform/README.md#platform-actor-v1) headers.

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

## Schemas and OpenAPI

Payloads are published as JSON Schema 2020-12 definitions:
[`api.v1.schema.json`](api.v1.schema.json) (v1 host requests, view, export,
disabled and error shapes), [`contributions.v1.schema.json`](contributions.v1.schema.json),
[`notes.v1.schema.json`](notes.v1.schema.json), and Frige's
[`passages.v1.schema.json`](../frige/passages.v1.schema.json). The platform
API registers every route in the tables of this file as an OpenAPI operation
whose payloads reference those definitions
([`openapi.v1.json`](../platform/openapi.v1.json)); a test fails if the
tables, the route list, the schema files and the committed OpenAPI disagree.

## Platform host (separation milestone 1, local candidate)

With `STEX_KNOWLEDGE_SERVICE=platform`, Pantheon opens no journal: it checks
the browser origin, then relays the method, path, query, a bounded JSON body
and, when hosted, the admitted actor plus `x-stex-actor-journal` (the
person's 32-hex journal directory name) to the Python platform API
(`backend/stex/knowledge`). Routes, bodies, limits, error codes, journal
bytes, version tokens and fingerprints are identical to the Node host; a
parity test replays each runtime's journal in the other. The platform API
accepts hosted requests only with a verified actor (`STEX_KNOWLEDGE_HOSTED=1`
requires `STEX_PLATFORM_ACTOR_SECRET`). Rollback is configuration only:
unset `STEX_KNOWLEDGE_SERVICE` and give Pantheon the same
`STEX_KNOWLEDGE_DATA_DIR`; never run both against one directory.

## Contributions v1 (`stex.knowledge.contributions.v1`)

A contribution records that one person approved one exact Frige passage
revision (`stex.frige.passages.v1` citation) for use with Igor. It is stored
in that person's journal directory as `contributions.v1.json` (metadata
only, never passage text), so `knowledge.v1.json` stays Node-compatible.
Audience is always the contributor. A contribution grants no access to the
Frige source, which Frige checks on every read.

| Route under `/api/knowledge/v1` | Behavior |
| --- | --- |
| `GET /passages/search?project=&q=` | Frige's search, with `contribution` set only for the caller's own active approval |
| `GET /passages/read?project=&attachment=&excerpt=&start=&end=&passage=` | Exact cited text, re-verified by Frige |
| `GET /contributions` | The caller's contributions with `state`: `current`, `stale`, `unavailable` or `withdrawn` (bounded checks, no text) |
| `POST /contributions` | `{idempotencyKey,expectedVersion,citation}`; Frige re-verifies first; `409 ALREADY_CONTRIBUTED` for a duplicate |
| `POST /contributions/withdraw` | `{idempotencyKey,expectedVersion,id}` |
| `POST /contributions/resolve` | `{reference}` → `{schemaVersion:"stex.knowledge.contribution.v1",reference,citation,text,trust:"untrusted-source"}`; `404` unknown or another person's, `410 CONTRIBUTION_WITHDRAWN`, `409 STALE_PASSAGE` |

References are `stex://knowledge/contribution/ctb-<16 hex>`. Igor calls
`/contributions/resolve` before each turn that names a contribution, with
its own secret (`x-stex-knowledge-token`, `STEX_KNOWLEDGE_IGOR_SECRET`) and
the owner's actor id and journal digest; that secret opens no other route.
Withdrawal stops every future read and resolve. It does not erase turns
that already used the passage or provider-retained records. Replaying an
earlier approval key never revives a withdrawn contribution. `POST /erase`
also deletes the caller's contributions.

## Notes v1 (`stex.knowledge.notes.v1`, read-only Obsidian import)

Local mode only, with an explicitly selected vault (`STEX_KNOWLEDGE_VAULT_DIR`);
hosted requests answer `403 VAULT_LOCAL_ONLY`.

| Route under `/api/knowledge/v1` | Behavior |
| --- | --- |
| `GET /notes` | Imported notes, each `current`, `changed` or `missing` |
| `POST /notes/import` | `{idempotencyKey,expectedVersion,path}`: records one note's vault-relative path, SHA-256, size, title, property names and wikilinks with their resolved targets in `notes.v1.json`, never its text |
| `GET /notes/search?q=` | Rereads imported notes, skips any whose bytes changed, and returns at most 10 snippets of at most 240 characters (16 KB total) | The vault is never
written; symlinks, junctions, traversal, drive letters, streams, reserved
device names and segments ending in a dot or space are refused. This is not
synchronization and does not complete the Obsidian gate.
