# Frige legacy books compatibility v1

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
Do not expand it as the future publishing API. P2 specifies a separate bounded
publishing contract before migrating the manuscript workstation.

Frige resolves books-directory settings in this order: `STEX_FRIGE_BOOKS_DIR`,
`TEXGRAPH_BOOKS_DIR`, legacy `STEX_BOOKS_DIR`, its default books folder.
Pantheon ignores all such paths. Existing compatibility clients need no body
changes; new workspace code should not adopt this historical API.
