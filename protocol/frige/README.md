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
| GET / PUT | `/project/design` | Read or validate/save the publication profile, including section and piece overrides (below) |
| GET / POST | `/project/build` | Read build state / compile `{scopeId,mode}` with LuaLaTeX |
| GET | `/project/preview`, `/project/preflight` | Read the existing PDF / diagnostic preflight |
| GET / POST | `/project/live-build` | Read staging state / explicitly stage a current verified book-order proof |
| GET / POST | `/project/attachments` | Read source manifest / upload bounded source documents |
| POST | `/project/attachments/<id>/approve` | Explicitly approve an available extraction |
| GET | `/artifacts/<id>` or `/artifacts/<id>/content` | Read artifact metadata / inert content, optionally `?download=1` |
| GET | `/scopes/<id>/turns`, `/scopes/<id>/changes` | Read that scope's editorial thread / current change contract |
| POST | `/scopes/<id>/turn` | Offer selected sources and a message or validated answer to inference |
| POST | `/scopes/<id>/changes/decide` | Explicit `{changeSetId,nodeId,decision}` acceptance/rejection |
| GET | `/project/contracts` | List change contracts, newest first, without manuscript text; optional `?scope=<id>` or `?node=<id>` |
| GET | `/contracts/<id>` | Read one change contract in full |
| POST | `/contracts/<id>/revert` | Roll back the contract's accepted changes; optional `{nodeId}` |
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

### Layout overrides

The publication profile may carry overrides for a section or a piece,
additively: a profile without them is unchanged and keeps its hash.

| Field | Keys | Allowed settings |
| --- | --- | --- |
| `sections` | A section's top-level folder name (at most 255 characters), as in the graph's `book.sections[].folder` | `fontSize` with `leading`, `opensRecto`, `headText` (the recto running head: 1–120 characters on one line) |
| `nodes` | A piece's node id | `fontSize` with `leading`, `opensRecto` |

- The nearest level that sets a value wins: the piece, then its section, then
  the book.
- A section's `opensRecto` applies to the first of its pieces that prints. A
  folder that appears in separate runs of the reading order forms a separate
  section each time, and its override applies to each run.
- Trim, margins, body font, folios and running heads stay book-wide.
  Footnotes keep the book's note size whatever size their piece is set in.
- Size and leading are set together, with the book's rules: size 8–18pt,
  leading 8–30pt and not below the size. An empty value counts as not set.
  No value is LaTeX.
- A `PUT` may carry `baseHash`: the profile hash the form was filled from.
  If the profile has changed since, the save is refused with
  `409 STALE_DESIGN` and nothing is written, so an outdated form cannot undo
  an accepted layout change. `baseHash` is never stored. The workstation
  always sends it; a save without it keeps the earlier behaviour.
- On `PUT`, overrides merge by key: an object replaces that override, `null`
  or an object that sets nothing clears it, and keys left out are kept. An
  override that is new or changed must name a section folder or a piece in
  the current reading order; otherwise `400`. An override resent unchanged
  is kept even if its target has since left the reading order, and can
  always be cleared.
- A stored invalid override is dropped on read without affecting the rest
  of the profile.
- The profile hash covers overrides. Changing any override changes the
  profile, so every proof made under the previous profile is reported stale.
- Each page-map node for a piece that prints records the settings it was
  typeset with as
  `layout: {fontSize, leading, sizeFrom: "book" | "section" | "element", opensRecto}`.

## Change contracts v1

`stex.frige.change-contract.v1` is the record a proposal to change canonical
manuscript source is stored as. It is additive under publishing v1: the
`changeSet` returned by `/scopes/<id>/turn`, `/scopes/<id>/changes` and
`/scopes/<id>/changes/decide` keeps every earlier field (`id`, `scopeId`,
`status`, `commentary`, `changes[]`, `dropped`) and gains those below. Frige is
the only producer and the only writer; Pantheon displays it. The record is
described by [`change-contract.v1.schema.json`](change-contract.v1.schema.json),
which Frige's test suite checks against every state a stored contract passes
through.

| Field | Meaning |
| --- | --- |
| `contract`, `schemaVersion` | `stex.frige.change-contract.v1`, record schema `3`. A schema `2` record is a change set from before contracts and has none of the fields below |
| `scope` | `{id, kind, title}` of the conversation that proposed it: `book`, a section, or a `node` |
| `request` | The proposed action in the author's words (at most 12,000 characters) |
| `commentary` | The director's reason |
| `origin` | `{userTurnId, model, transport}` of the turn that produced it, each a short string or `null`. `model` and `transport` are recorded as the gateway reported them (for example `fake` or `remote`) and are not interpreted |
| `context.offered[]` | `{nodeId, relativePath, hash, category: "canonical-source"}` for every source the director was shown |
| `context.references[]` | `{id, name, category: "approved-reference"}` for author-approved excerpts shown |
| `context.withheld[]` | `{nodeId, title}` for pieces in scope that were too long to show |
| `context.designHash` | Publication profile in force when proposed |
| `changes[]` | `{kind: "replace-node-source", nodeId, relativePath, title, baseHash, afterHash, before, source, summary, lines, status}`. `before` and `source` are the exact texts; `lines` is `{before, after, added, removed}` |
| `effects[]` | `{code, message}`; currently `proof-stale` |
| `conflicts[]` | `{contractId, scopeId, nodeId}` for undecided changes to the same piece in another conversation, as found when this contract was proposed. It is not updated afterwards |
| `approval` | `{required: "author", granularity: "per-change"}` |
| `rollback` | `{strategy: "restore-before", requires: "current-hash-equals-after-hash"}` |
| `proof` | `null`, or `{completedAt, scopeId, mode, paginationVerified, designHash, sourceHashes}` for the strongest successful build that typeset every accepted change at its accepted text. `sourceHashes` names exactly the pieces it covers |

Context categories are recorded separately and are never merged: a reference
or a generated proposal does not become canonical source by being offered.

**Layout changes.** A contract may instead hold exactly one layout change:
setting or clearing the [override](#layout-overrides) of the conversation's
own section or piece. A whole-book conversation cannot propose one; the
book's settings are changed in the Design panel. Its change entry is
`{kind: "set-layout", level: "section" | "node", target, nodeId, title, before, after, baseHash, afterHash, pieces, inherited, summary, status}`:

- `target` is the section folder or node id, and `nodeId` is the piece, or
  `null` for a section. A section's settings apply to every run of its folder
  in the reading order.
- `before` and `after` are the target's own override, or `null` for none.
- `baseHash` and `afterHash` are hashes of the whole publication profile.
- `pieces` lists the pieces the override applied to when proposed.
- `inherited` is `{fontSize, leading, sizeFrom, opensRecto, headText}`: what
  applies to the target without its own override (`headText` is `null` for
  a piece). The recto value assumes the section's first piece prints.

Acceptance writes the profile only if its hash still equals `baseHash` and
the target is still in the table of contents. A rollback restores `before`
only if the hash still equals `afterHash`. Otherwise the change is `stale`,
or the rollback is refused with `409 STALE_SOURCE`, and nothing is written.
A build proves a layout change only if it typeset every one of its `pieces`
that is still in the reading order, under exactly the profile the change
produced. Pieces added to the target after the proposal are not required.
For a section filed in several places, the conversation's own automatic
proof may not cover the other places; a whole-book proof does. Conflicts name other
undecided changes to the same layout target. The record's shape is in
[the schema](change-contract.v1.schema.json); the settings inside `before`
and `after` are validated by the publication profile's rules.

A layout proposal reaches Frige as the optional scope-turn reply field
`layout` (`{set: {...}}` merges into the target's override, a `null` value
removes that key; `{clear: true}` removes the override), from the
deterministic simulator or a gateway that sends it. In a gateway reply, a
`set` of more than eight keys is malformed: the field is ignored and no
reason is shown. Frige validates every value with the
profile rules; an invalid proposal, or one that would change nothing, is set
aside with its reason (at most 1,000 characters). A reply that proposes both text and layout keeps the text changes
and sets the layout change aside.

Change `status` is `pending`, `accepted`, `rejected`, `stale` (the piece
changed after the proposal; not written), `failed` (the write failed),
`superseded` (a newer proposal in the same conversation replaced it before a
decision) or `reverted`. A contract is `pending` while any change is pending,
otherwise `resolved`. Contracts are kept after they are decided.

Rules the engine enforces:

- A proposal writes nothing. Only an explicit decision or rollback writes.
- A change is kept only for a node whose exact text was offered in that turn.
- Acceptance writes through the base hash; a piece edited since is `stale`.
  Accepting several pieces together (no `nodeId`) is all-or-nothing: every
  piece is checked first, and if any has changed it is marked `stale`,
  nothing is written, and the others stay `pending` to decide again. If a
  write fails part-way, every piece that holds the proposed text is restored,
  and each change's status then follows what its piece holds: `failed` if
  it holds its earlier text, `accepted` (with the reason) in the rare case a
  restore did not take effect, so a rollback can still undo it. Outcomes are
  read from the files, because a write can reach the file and still report
  an error. A change is `accepted` only when its
  own decision wrote it: if the piece already holds the proposed text
  because something else wrote it, the change is `stale` and cannot be
  rolled back, so its `before` can never undo another write.
- Before writing, an acceptance records the pieces it is applying as
  `applying` on the contract and removes it when done, including when it
  fails. It is left in place only if the engine stopped, or a piece could not
  be read to settle its outcome. A contract still carrying `applying` is
  settled before anything else acts on it: the first time the book is used
  after the engine starts, and before any decision, rollback or newer
  proposal touches that contract. Each listed piece holding the proposed text
  is restored to `before`, a piece holding anything else is left as it is,
  and those changes become `failed` with the reason, so the author decides
  again. If a piece cannot be read, nothing is settled and the operation
  fails, to be retried; a lock is never taken to mean the piece was left
  alone.
- `POST /contracts/<id>/revert` restores `before` for each accepted change,
  only if every targeted piece still holds `afterHash`. Otherwise it returns
  `409 STALE_SOURCE` and writes nothing. The node id is unchanged and the
  restored hash equals `baseHash`. If a write itself fails part-way through a
  rollback of several pieces, the pieces already restored stay restored and
  each change records its own outcome. A contract with no accepted change
  returns `409 NOTHING_TO_REVERT`; an unknown contract returns
  `404 CONTRACT_NOT_FOUND`. An id that is not a UUID does not match the
  facade's route and returns its plain `404`.
- Frige never overwrites a piece that is not valid UTF-8: a save, acceptance
  or rollback of one is refused with `400 SOURCE_NOT_UTF8` (an acceptance
  records the change as `failed`). Hashes are taken over decoded text, so
  such a file's bytes could not be restored. For valid UTF-8, restoration is
  byte-exact, including a byte-order mark, line endings and a missing final
  newline.
- A successful build is recorded as `proof` on every contract it proves. A
  contract keeps its strongest proof: a compiler-verified page map outranks
  an unverified one, and a book-order proof outranks a piece typeset alone.
  A weaker build changes nothing; an equally strong one replaces the record
  only when it was typeset under a different publication profile. Accepting a further change of the
  contract, or rolling one back, clears the proof. `proof` records that such
  a build happened; whether the proof on screen is current is reported by
  the build status and preflight.
- A contract file that is missing, unparsable, stored under another id, or
  lacks the fields a decision acts on is treated as absent. The conversation
  still opens, and the next proposal replaces the pointer. A file that exists
  but cannot be read (a lock or permission error) is an error, not absence:
  the request fails and nothing is replaced, so a passing lock cannot orphan
  a pending contract.
- A proposed text must be well-formed Unicode and at most 400 KB after it is
  converted to the piece's own line endings; otherwise that change is
  dropped. A reply that differs from the offered text only in line endings
  proposes nothing.
- `PUT /nodes/<id>` requires `baseHash`. A save without one returns
  `400 BASE_HASH_REQUIRED`. This closes a gap in the stale-write guard; the
  documented save body has always been `{source, baseHash}`.

`GET /project/contracts` returns at most 200 summaries and omits `before` and
`source`. Section- and book-scope conversations already produce contracts in
this form; hierarchical context, typed layout changes and all-or-nothing
application across pieces are not part of v1.

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
