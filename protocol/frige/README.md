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
| GET | `/nodes/<id>/revisions`, `/nodes/<id>/revisions/<revision>` | List revision metadata / read a historical source |
| POST | `/nodes/<id>/revisions/<revision>/restore` | Restore exact source as a new revision using `{baseHash,baseRevisionId}` |
| GET / POST | `/nodes/<id>/decisions` | List recorded decisions / record a reason against the current source |
| GET / PUT | `/project/design` | Read or validate/save the publication profile, including section and piece overrides (below) |
| GET / POST | `/project/build` | Read build state / compile `{scopeId,mode}` with LuaLaTeX |
| GET | `/project/preview`, `/project/preflight` | Read the existing PDF / diagnostic preflight |
| GET / POST | `/project/live-build` | Read staging state / explicitly stage a current verified book-order proof |
| GET / POST | `/project/attachments` | Read source manifest / upload bounded source documents |
| GET | `/project/attachments/<id>/excerpt` | Preview the exact bounded excerpt and its hash |
| POST | `/project/attachments/<id>/approve` | Approve the previewed excerpt using `{hash}` |
| POST | `/project/attachments/<id>/convert` | Convert a stored attachment that has no text yet. With a converter, uploads return `awaiting-extraction` and are converted one by one this way (503 without a converter, 409 once it has text) |
| GET | `/artifacts/<id>` or `/artifacts/<id>/content` | Read artifact metadata / inert content, optionally `?download=1` |
| GET | `/scopes/<id>/turns`, `/scopes/<id>/changes` | Read that scope's editorial thread (its first conversation) / current change contract |
| | `/scopes/<id>/conversations…` | A scope's named conversations, summaries and continue: see [Editorial sessions](#editorial-sessions) |
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
A section's scope id is `section-<16 hex>`, derived from its top-level folder
without regard to case, so it survives renaming or reordering the section's
first piece. A folder that appears in several places in the reading order
gets `-2`, `-3`…. Each run keeps the id of the run it shares the most pieces
with: first the previous graph's runs, then every id the folder has had,
which `.texgraph/section-aliases.json` keeps with the pieces it last held (so
a run that leaves the book and returns, or a graph that is rebuilt, gets its
id back). A run whose pieces were all replaced keeps the id of a run whose
pieces all left, only when that pairing is one for one. Any other run gets an
id never issued before. Ids are matched by pieces, so a run can take over the
id, and the conversation and proposals, of a run whose pieces it now holds;
when runs merge, the larger overlap wins and the other id's records stay
unattached until a run holding its pieces returns. Each
section in the graph lists `legacyIds`: the earlier `scope-<node id>` form
for every piece it now holds, plus any such id with recorded data that
`.texgraph/section-aliases.json` remembers for it (the first section to claim
an id keeps it). Any of them is accepted wherever a scope id is, including
proof and live-build matching, and conversations, proposals, contracts and
artifacts recorded under them belong to the section; new records are written
under the current id. An acceptance refuses, as `stale`, a change to a piece
outside its conversation's scope: for a section, its current pieces; for the
book, the reading order and the table of contents.
Frige validates selections and paths, serializes accepted source writes, and
rejects stale saves/proposals with `409`. A source write containing an
unpaired UTF-16 surrogate returns `400 INVALID_SOURCE` before replacing bytes.
A save that detects another edit after writing returns `409 STALE_SOURCE`
and leaves the later edit in place. JSON bodies are decoded as a UTF-8
stream, and malformed encodings are refused with `400`.
A response is not a press-readiness claim.
Source lineation, stanza/indentation, Unicode, provenance and review
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

### Editorial history and decisions

The additive `stex.frige.editorial.v1` records belong to the selected
manuscript book. Use the same publishing v1 prefix and `?book=<id>`. These
routes share its project-password check and hosted account gate. Historical
source and decision text are returned only for the selected book and piece.

- **List revisions.** `GET /nodes/<id>/revisions` returns
  `{schemaVersion,nodeId,currentHash,currentRevisionId,entries,nextBefore}`.
  Each entry has `id,parentId,hash,kind,at,summary,provenance` and, when
  restored, `restoredFrom`. IDs are UUIDs and hashes are SHA-256 of exact
  UTF-8 source. Kinds are `baseline`, `observed`, `save` and `restore`.
  Baseline and observed entries have `provenance: {role: "unattributed"}`.
  Saves and restores use `{role: "author"}` for the explicit user operation.
  An untouched piece has an empty list and null current revision. If the
  file differs from its last journal entry, the list reports the on-disk
  hash and null current revision.
- **Read a revision.** `GET /nodes/<id>/revisions/<revision>` adds
  `schemaVersion,nodeId,source` to one revision entry. `source` is the
  exact snapshot, including line endings, BOM and any missing final newline.
- **Restore.** `POST /nodes/<id>/revisions/<revision>/restore` accepts
  `{baseHash,baseRevisionId}` from the latest listing. An explicit null
  revision id is valid when that listing has no current revision. The server
  checks both values under the source-write queue. A restore returns
  `{node,revision}`, with the existing node shape and a new revision event
  linked to both the preceding event and `restoredFrom`. Restoring identical
  bytes returns `revision: null`. The snapshot's bytes must verify against
  its hash and decode exactly as UTF-8. A preexisting source above the
  new-save size limit can still be restored from its verified snapshot.
- **Record or list decisions.** `POST /nodes/<id>/decisions` accepts
  `{baseHash,baseRevisionId,reason}`. A nonblank reason of at most 4,000
  UTF-16 units is saved with `id,at,revisionId,reason,provenance` and returned
  with `schemaVersion,nodeId` and status `201`. The role is `author`. A
  decision can establish a baseline for a piece with no edits and never
  writes manuscript source. Repeating the same trimmed reason on the same
  current revision returns the existing record. If the original request
  established an initial revision, reload the list after a stale reply to
  obtain that revision id. `GET /nodes/<id>/decisions` returns
  `{schemaVersion,nodeId,entries,nextBefore}`.

Both lists return at most 50 entries newest first. Pass the preceding
response's non-null `nextBefore` as `?before=<id>` to continue. Unknown
revision ids or cursors return `404 REVISION_NOT_FOUND`, invalid bodies
return `400 INVALID_EDITORIAL_REQUEST`, and a moved source hash or event id
returns `409 STALE_SOURCE`. Inaccessible or damaged journal state returns
`503 EDITORIAL_UNAVAILABLE`.

The existing guarded `PUT /nodes/<id>` response is preserved and a changed
save now adds a revision. Canonical Markdown stays in `manuscript/`.
Frige stores an atomic metadata journal and hash-deduplicated snapshots in
private project state. For a save or restore, Frige records the prior bytes
and a pending event before it writes the source. After interruption it
commits the event only if the file contains the intended bytes. A different
or missing file is left alone. A subsequent editorial write can record an
observed revision when it encounters untracked source. Existing proposal
acceptance and rollback can advance source outside this journal. They
reconcile a pending save before writing and continue to use the change
contract for their own provenance.

### Approved document excerpts

The selected book's password boundary applies to upload, excerpt preview,
approval and the Frige conversation. The excerpt route returns
`{id,name,excerpt,hash}` for supported UTF-8 text and `404 EXCERPT_UNAVAILABLE`
when an excerpt cannot be read. Approval accepts its SHA-256 hash and
returns `409 STALE_SOURCE` if the displayed excerpt changed. A changed
extraction requires a fresh preview and approval.
Publishing and legacy attachment changes share one per-book write queue.
Unavailable or damaged attachment metadata returns `503 ATTACHMENTS_UNAVAILABLE`
and is preserved.

Frige checks the 32 most recent approvals and offers up to eight matching
excerpts to Igor. Each excerpt is at most 6,000 UTF-16 units with intact
Unicode boundaries. The gateway may omit optional excerpts to fit the
turn budget. An old approval without an excerpt hash remains a legacy
record until the reader approves the displayed excerpt. Uploads of PDF
and DOCX have no text excerpt in this workflow.

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

### Selected passages

Added 2026-11-21 and additive ([D-021](../../docs/program/DECISIONS.md)).
`POST /scopes/<id>/turn` may carry a passage the author selected, beside
`message`:

`selection: { nodeId, baseHash, start, end, text, action }`

- `start` and `end` count the editor's text, in which every line ending is
  one `\n`, which is how a browser text field reports its value.
- `baseHash` is the piece's hash when it was selected.
- `action` is `ask`, `revise`, `explain`, `alternatives` or `compare`.

Before anything is recorded, Frige checks the selection against the piece as
this conversation offers it now:

- `409 PASSAGE_STALE` when `baseHash` is no longer the piece's hash. Nothing
  is recorded, and the author selects again.
- `400 INVALID_PASSAGE` when the selection is not valid:
  - the action is unknown;
  - the piece is not one this conversation offers;
  - the range is invalid, runs past the end, or exceeds 12,000 characters;
  - the text at that range differs from `text`;
  - the turn is an answer to a choice or form.

A selection that passes is mapped to the canonical bytes. It is recorded on
the user turn as `passage: { nodeId, relativePath, title, baseHash, action,
start, end, startLine, endLine, text }`: offsets into the source, its lines,
and its exact bytes. That turn is the contract's `origin.userTurnId`, so the
record of what was asked about needs no change to the contract schema.

The passage goes to the gateway as the scope-turn request field
[`selection`](../texgraph/README.md). For every action except `ask`, a
proposal may change only that passage:

- an edit's anchor is looked for only inside it;
- a whole-text change must leave every byte outside it unchanged;
- changes to other pieces, and layout changes, are set aside with a reason.

### Editorial sessions

A book, section or piece scope holds several named conversations, each an
editorial session with the lifecycle of
[D-027](../../docs/program/DECISIONS.md#d-027--conversations-and-working-sessions-share-one-lifecycle).
They are additive under publishing v1 and use the scope ids of the routes
above. A `conversationId` is `main` or `c-` and sixteen hex digits.

| Method | Suffix after the version prefix | Operation |
| --- | --- | --- |
| GET / POST | `/scopes/<id>/conversations` | List the scope's conversations (archived ones flagged) / start one with an optional `{title}` |
| GET / PATCH | `/scopes/<id>/conversations/<cid>` | Read one with its transition events / change `{title?, archived?, lifecycle?, reason?}` |
| GET | `/scopes/<id>/conversations/<cid>/turns` | That conversation's thread |
| POST | `/scopes/<id>/conversations/<cid>/turn` | A message or answer, with the body of `/scopes/<id>/turn` |
| GET / PUT | `/scopes/<id>/conversations/<cid>/summary` | Read the saved revisions / save the next revision |
| GET | `/scopes/<id>/conversations/<cid>/summary/draft` | Frige's draft; nothing is stored |
| POST | `/scopes/<id>/conversations/<cid>/continue` | Start a new conversation from this one's latest saved summary |

- **First conversation.** The scope's existing journal
  (`.texgraph/conversations/<scope>.jsonl`) is its conversation `main`,
  read in place and never moved, renamed or rewritten. `/scopes/<id>/turns`
  and `/turn` keep working against it. Legacy section ids and anchor-file
  turns merge into it as before. It starts `active`, titled "Main
  conversation", and is recorded in the index only once it is changed.
- **Storage.** Other conversations keep an append-only journal and the
  scope's small index in `.texgraph/sessions/<scope>/`. Index writes are
  atomic and serialized with the store's other writes. An index that cannot
  be read or does not validate fails closed with `503 SESSIONS_UNAVAILABLE`:
  it is never read as "no conversations", and is left untouched. Because
  every send checks the conversation's state there, this also stops new
  turns in that scope's first conversation, including through the older
  `/api/scopes/<id>/turn` route, until the index is repaired. Existing turns
  stay readable.
- **Lifecycle.** States are `active`, `paused`, `awaiting-review`, `completed`
  and `abandoned`. Allowed: `active` to any other; `paused` or
  `awaiting-review` to `active`, `completed` or `abandoned`; a closed state
  to `active` (reopen). Other transitions, including to the current state,
  are `409 INVALID_TRANSITION`. Every transition is appended with time,
  `from`, `to`, `actor` (the actor id) and an optional `reason` of at most
  500 characters. `archived` is a separate flag. A title is 1 to 120
  characters. Conversations are never deleted; a scope keeps at most 200 and
  a conversation at most 1,000 events and 100 summary revisions (`409
  SESSION_HISTORY_FULL`). One PATCH is validated whole before it is applied.
- **Sending.** A message to a `paused` or `awaiting-review` conversation
  resumes it, recorded as a transition with the reason "Resumed by sending a
  message." A message to a `completed` or `abandoned` one is refused with
  `409 SESSION_CLOSED` before anything is stored. An unknown conversation is
  `404 CONVERSATION_NOT_FOUND`.
- **Closing has no editorial effect.** Completing, abandoning, pausing or
  archiving never accepts, rejects, applies, supersedes or reverts a change
  contract. Proposals stay pending and are listed in the summary draft.
  Supersession by a newer proposal stays per scope.
- **Summary.** A saved revision has `revision` (1, 2, …), `text` (at most
  4,000 characters), `decisions`, `openQuestions`, `outstandingProposals` and
  `sources` (each at most 20 entries of at most 300 characters),
  `throughTurnId` (the last turn it covers; a turn of this conversation, or
  the latest when omitted), `author` and `updatedAt`. A save names its
  `baseRevision` (0 before the first); any other value is `409
  STALE_SUMMARY`; invalid content is `400 INVALID_SUMMARY`. Earlier
  revisions are kept.
- **Draft.** `GET …/summary/draft` returns `{conversationId, draft: true,
  generatedBy: "frige-records", baseRevision, throughTurnId, text, decisions,
  openQuestions, outstandingProposals, sources, pendingContractIds}`, built
  without a model from Frige's records: the contracts produced in the
  conversation (accepted, rejected, reverted and other decided changes as
  decisions, pending ones as outstanding proposals, with piece titles), the
  [editorial decisions](#editorial-history-and-decisions) recorded on the
  scope's pieces since the conversation began (matched by time, so another
  conversation's decision on the same piece in that window is included), the
  director's choices and forms that have no recorded answer, and the approved
  excerpts its contracts record as offered. A contract from before
  conversations belongs to `main`.
- **Continue.** The new conversation records `continuedFrom:
  {conversationId, summaryRevision}`. Without a saved summary the request is
  `409 SUMMARY_REQUIRED`.
  Continue is idempotent per summary revision. When a conversation already
  continues from that revision, it is returned with `replayed: true` and
  status `200`, and no second conversation is created. A newer revision
  starts a new conversation (`201`).
- **Context for a turn.** The model is offered only the conversation's own
  recent turns. It is also offered up to three saved summaries as the
  scope-turn request field
  [`sessionSummaries`](../texgraph/README.md#session-summaries): first the
  `continuedFrom` revision, then the most recent completed, unarchived
  sessions of the scope, within 12,000 UTF-8 bytes. The turn records them as
  `offered.sessionSummaries` and the contract as `context.sessionSummaries`
  (category `session-summary`, references only).
- **Attribution.** `createdBy`, a summary's `author` and transition actors
  are the [platform actor](../platform/README.md#platform-actor-v1)'s id, or
  `local` in local mode. With `STEX_PLATFORM_ACTOR_SECRET` set, every request
  that changes state (any POST, PUT, PATCH or DELETE, on these routes and all
  others, including the knowledge observation checkpoint) needs a
  verified actor or is refused `401 ACTOR_REQUIRED`; reads are unchanged.
- **Access.** The project password applies to every route above exactly as
  to the other scope routes.

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
| `conversationId` | Additive and optional: which [conversation](#editorial-sessions) of the scope proposed it (`main` or `c-` and sixteen hex digits). Absent in records from before conversations, which belong to `main`. Supersession stays per scope |
| `request` | The proposed action in the author's words (at most 12,000 characters) |
| `commentary` | The director's reason |
| `origin` | `{userTurnId, model, transport}` of the turn that produced it, each a short string or `null`. `model` and `transport` are recorded as the gateway reported them (for example `fake` or `remote`) and are not interpreted |
| `context.offered[]` | `{nodeId, relativePath, hash, category: "canonical-source"}` for every source the director was shown |
| `context.references[]` | `{id, name, category: "approved-reference"}` for author-approved excerpts shown |
| `context.withheld[]` | `{nodeId, title}` for pieces in scope that were too long to show |
| `context.designHash` | Publication profile in force when proposed |
| `context.sessionSummaries[]` | Additive and optional: `{conversationId, summaryRevision, category: "session-summary"}` for each saved session summary Frige offered with the turn, by reference only. What Frige sent; the gateway does not report it yet |
| `changes[]` | `{kind: "replace-node-source", nodeId, relativePath, title, baseHash, afterHash, before, source, summary, lines, status}`. `before` and `source` are the exact texts; `lines` is `{before, after, added, removed}` |
| `effects[]` | `{code, message}`; currently `proof-stale` |
| `conflicts[]` | `{contractId, scopeId, nodeId}` for undecided changes to the same piece in another conversation, as found when this contract was proposed. It is not updated afterwards |
| `approval` | `{required: "author", granularity: "per-change"}` |
| `rollback` | `{strategy: "restore-before", requires: "current-hash-equals-after-hash"}` |
| `proof` | `null`, or `{completedAt, scopeId, mode, paginationVerified, designHash, sourceHashes}` for the strongest successful build that typeset every accepted change at its accepted text. `sourceHashes` names exactly the pieces it covers |

A director may propose a text change as anchored edits instead of the whole
piece ([scope turn](../texgraph/README.md), [D-020](../../docs/program/DECISIONS.md)).
Frige resolves them against the exact offered text before the contract is
built, so the contract is unchanged: `before` and `source` are still the whole
prior and proposed texts, every character outside the edited spans is copied
from `before`, and acceptance, staleness, all-or-nothing application and
rollback behave as for any text change. No field records that a change
arrived as edits.

Context categories are recorded separately and are never merged: a reference
or a generated proposal does not become canonical source by being offered.
A turn also offered context from the levels around its scope records it as
`context.outline` (`{category: "outline", count, truncated}`),
`context.settings` (`{category: "document-settings", designHash}`) and
`context.contracts` (`[{contractId, category: "approved-contract"}]`): what
was offered, never its content. `context.hierarchyConfirmed` is `true` when
the inference gateway reported what it forwarded to the director after
trimming, and `false` when the record shows what Frige sent (the simulator, or
a gateway that does not report it). These fields are absent in contracts from
turns that offered no such context.

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
Attachment metadata updates use the same in-process book queue as publishing
v1. An interrupted multi-file upload can still leave an unlisted file.
Do not expand it as the publishing API. The separate publishing v1 boundary
above is the platform workstation's contract.

Frige resolves books-directory settings in this order: `STEX_FRIGE_BOOKS_DIR`,
`TEXGRAPH_BOOKS_DIR`, legacy `STEX_BOOKS_DIR`, its default books folder.
Pantheon ignores all such paths. Existing compatibility clients need no body
changes; new workspace code should not adopt this historical API.
