# Frige publishing and compatibility boundaries

## Publishing v1

`stex.frige.publishing.v1` is the additive engine API used by Pantheon's
publishing library and mature manuscript workstation. The engine prefix is
`/api/stex/publishing/v1`, mounted through Pantheon at
`/frige/api/stex/publishing/v1`. Successful responses carry
`X-STEX-Contract: stex.frige.publishing.v1`; the version is in the URL, and
existing operation response bodies are preserved. Pantheon owns presentation
only. Frige owns source, hashes, proposals, builds, attachments and preflight.

| Method | Suffix after the version prefix | Operation |
| --- | --- | --- |
| GET / POST | `/books` | List eligible books / create a new title-author scaffold |
| GET | `/project/graph`, `/project/artifacts`, `/project/reference-map`, `/project/page-map` | Read the selected book's graph and derived artifacts/maps |
| POST | `/project/refresh` | Refresh the selected book's derived graph |
| GET / PUT | `/nodes/<id>` | Read a source node / explicitly save `{source,baseHash}` |
| GET / PUT | `/project/design` | Read or validate/save the publication profile |
| GET / POST | `/project/build` | Read build state / compile `{scopeId,mode}` with LuaLaTeX |
| GET | `/project/preview`, `/project/preflight` | Read the existing PDF / diagnostic preflight |
| GET / POST | `/project/live-build` | Read staging state / explicitly stage a current verified book-order proof |
| GET / POST | `/project/attachments` | Read source manifest / upload bounded source documents |
| POST | `/project/attachments/<id>/approve` | Explicitly approve an available extraction |
| GET | `/artifacts/<id>` or `/artifacts/<id>/content` | Read artifact metadata / inert content, optionally `?download=1` |
| GET | `/scopes/<id>/turns`, `/scopes/<id>/changes` | Read that scope's editorial thread / proposal |
| POST | `/scopes/<id>/turn` | Offer selected sources and a message or validated answer to inference |
| POST | `/scopes/<id>/changes/decide` | Explicit `{changeSetId,nodeId,decision}` acceptance/rejection |
| GET | `/inference/health` | Read the labelled inference availability |
| GET / PUT | `/settings/models` | Read/save existing server-side role/model settings |
| GET | `/settings/model-catalog` | Read the gateway's model catalog |

Book selection is explicit in `?book=<id>`. Stable node ids, source hashes,
compiler-derived page maps and profile hashes keep their existing semantics.
Frige validates selections and paths, serializes accepted source writes, and
rejects stale saves/proposals with `409`. A response is not a press-readiness
claim. Source lineation, stanza/indentation, Unicode, provenance and review
authority are independent of Pantheon layout or typography.

The facade also exposes the existing local one-page compatibility operations
(`/health`, `/book`, `/pages`, `/pages/<id>` and their preview/turns/proposal/
build/turn/proposal-accept-or-reject actions) over the same validators. The
current platform library opens manuscript books, not a second book store.
PDF.js files remain static resources at `/frige/vendor/pdfjs/…`.

Unknown facade routes fail `404`, unsupported methods `405` with Allow, invalid
input `400`, stale source/proposals or duplicate answered prompts `409`, and
unavailable inference `503`. Failed compilation returns `422` and preserves
the last successful PDF. Requests retain the 12,000,000-character bound;
editorial messages are at most 12,000 characters, recent inference context is
bounded by the existing scope/turn contract, LuaLaTeX has a 30-second timeout
with shell escape disabled, and editorial inference waits at most 300 seconds.
Existing store/contract limits on sources, attachments and reply parts remain
authoritative; the facade adds no automatic retries or authority.

This remains local single-user access with the same Host/Origin checks as the
legacy boundary below. Pantheon holds no inference secret and never opens
engine files. The old unversioned APIs stay available for compatibility, with
no meaning changed in place. Engine UI entries redirect to the configured
loopback Pantheon `/frige/`, preserving project queries. A breaking publishing
API change requires a parallel v2 and consumer migration.

## Legacy books compatibility v1

Frige owns `/api/stex/legacy-books/v1`; Pantheon preserves `/api/books…` as a
streaming compatibility proxy to that engine prefix. The implementation moved
from Pantheon without changing the historical successful payload shapes.
Pantheon has no books-directory setting or filesystem access. The existing
Frige `/api/books` simple scaffold API is a separate, unchanged operation.

| Method | Suffix after the version prefix | Behavior |
| --- | --- | --- |
| GET | Empty | Historical book summaries |
| POST | Empty | Accept an interview `ticket` and optional `transcript`; create a new scaffold |
| GET | `/<book>/documents` | Historical source-document manifest |
| POST | `/<book>/documents` | Upload one to ten source documents |
| POST | `/<book>/documents/<document>/review` | Explicitly approve or reject an extraction using `approved` |

Success returns the original array/object directly (`200`, or `201` for
creation/upload); the version is in the URL rather than a new payload wrapper.
Invalid input returns `400 {error}`, unknown compatibility routes `404`, and
an unavailable engine returns Pantheon `502`. No fallback reads local storage.

The owner remains Frige: accepted settings, interview records, source uploads,
extractions and review records live in the book workspace. Only newly created
scaffolds get manuscript files. Listing existing books does not rewrite them;
uploads stay under `sources/` and extraction state under `.texgraph/`.
Book ids follow `[a-z0-9][a-z0-9-]{0,62}`; document ids are 16 lowercase hex
characters; upload names must be plain basenames with an allowed extension.
There are at most ten uploads of 8 MB each, within the historical 12,000,000
character request bound. Readable extraction is capped at 200,000 characters.
Interview transcripts retain at most 40 bounded turns. Review is explicit;
uploading never implicitly approves context or changes manuscript text.

The loopback engine admits its own browser origin or configured loopback
`STEX_PANTHEON_URL`, rejects opaque/foreign origins, cross-site browser requests
and non-loopback Host values, and retains local Origin-absent CLI access.
This protects browser requests without introducing platform authentication.
The API preserves historical last-writer behavior for document manifests; it
does not claim new transactional upload or concurrent-review guarantees.
Do not expand it as the publishing API. The separate publishing v1 boundary
above is the platform workstation's contract.

Frige resolves books-directory settings in this order: `STEX_FRIGE_BOOKS_DIR`,
`TEXGRAPH_BOOKS_DIR`, legacy `STEX_BOOKS_DIR`, its default books folder.
Pantheon ignores all such paths. Existing compatibility clients need no body
changes; new workspace code should not adopt this historical API.
