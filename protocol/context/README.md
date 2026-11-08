# Explicit project context v1

`stex.project.context.v1` is an engine-owned, read-only source export.
`stex.igor.context.v1` records explicit conversation consent. These additive
boundaries grant no mutation, filesystem, runtime tool, vault or provider
authority. Existing publishing, workspace, conversations and Hermes contracts
retain their meanings.

## Engine export

At `/frige` or `/seaxneat`:

| Method and path | Response |
| --- | --- |
| `GET /api/stex/context/v1/projects/:id?offset=0` | `{schemaVersion,project,sources,nextOffset}` metadata, 50 per page |
| `GET /api/stex/context/v1/projects/:id/sources/:sourceId?revision=<sha256>` | `{schemaVersion,project,source}` exact current text |
| `POST /api/stex/context/v1/projects/:id/observation` | Body `{sources:[{id,revision}]}`; metadata-only [knowledge event](../knowledge/README.md) |

Project fields are `application,id,title,reference`, with
`stex://frige|seaxneat/project/<id>`. Source fields are `id,title,reference,
revision,mediaType,bytes,available`; snapshots add `source`. References append
`#source=<id>`. Revisions hash exact UTF-8 text, preserving BOM, Unicode, CRLF,
indentation and lineation. Sources over 12,000 bytes are unavailable.
Seaxneat exports three allowlisted files from the last validated Git commit,
adds `originRevision`, and excludes working drafts. Oversized Seaxneat sources
have a null content revision. Frige checks tree containment and rejects links
before graph refresh. Neither export changes canonical source.

Loopback Host and browser-origin checks protect reads and writes. Unknown
identities return 404, stale revisions 409, excessive size 413, unsafe paths
403, unavailable engines 503; failures carry `code,error` without private
paths. Arbitrary URLs and filesystem paths are refused.

## Igor selection

Existing Igor Host, origin and hosted sign-in guards apply to every route:

| Route under `/igor/api/context/v1` | Behavior |
| --- | --- |
| `GET /projects?application=<engine>` | Project-summary metadata for Frige or Seaxneat |
| `GET /sources?project=<reference>&offset=0` | Source catalog |
| `POST /preview` | `{project,sources:[{id,revision}]}` → exact `snapshot,digest,bytes` |
| `POST /conversations` | `{idempotencyKey,message?,selection:{project,sources,digest}}` creates approved context |
| `POST /conversations/:id/selection` | `{epoch,selection:<approved selection>|null}` changes or withdraws context |

At most four unique sources and 12,000 UTF-8 JSON bytes including provenance
are offered. Preview makes no inference call. Approval re-fetches revisions
and checks the SHA-256 digest of normalized snapshot JSON. Changed material
fails before acceptance. Engine origins are configured loopback HTTP only,
redirects are refused, calls time out after three seconds, and responses are
capped at 65,536 bytes.

A conversation binds to one project. Switching projects requires a new one.
Each selection change/withdrawal advances an optimistic epoch (maximum 64),
uses a fresh upstream identity `<id>_ctx<epoch>`, and excludes earlier-epoch
history from later requests. Queued/retried turns retain immutable snapshots.
Pending replies prevent selection changes. Retries after selection changes
fail with 409. Later engine edits need refresh, preview and approval.

Context-aware idempotency fingerprints include selection/epoch; changed input
under the same key fails. Identical creation replay needs no engine access.
Snapshots survive restart; interrupted turns fail without automatic replay.
Public records expose current `{context:{epoch,project,snapshot}}`, omitting
the historical snapshot ledger. Normal context-free v1 behavior remains.

The conversation/operation/context envelope is bounded to 24,000 actual UTF-8
JSON bytes; history is trimmed oldest first (20 messages, 20,000 bytes),
preserving the trigger. Oversize fails before message mutation. Withdrawal
prevents future use; it does not erase historical transcripts, local consent
snapshots or already transmitted provider records. Conversation deletion
removes the local record; provider retention is outside this contract.
