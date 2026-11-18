# Frige

Frige is STEX Pantheon's local publishing and typesetting engine. It is
available at `/frige/`; `/texgraph/` remains a route compatibility redirect.
Frige is the publishing capability engine in the
[platform transition](../../docs/PLATFORM-TRANSITION.md). Pantheon owns its
library and workstation presentation at `apps/pantheon/workspaces/frige`;
manuscript and proof authority stays in this engine.
The current Node backend is transitional: STEX-owned backend application logic
targets Python/FastAPI and typed contracts under the
[approved migration plan](../../docs/PLATFORM-TRANSITION.md#python-backend-migration).
No backend rewrite, source conversion or UI redesign is part of this release.
Never use a real manuscript as a test fixture or alter
`books/*/manuscript/` for layout convenience.

Frige is the local, single-user STEX application for building a book one
page at a time. Its working surface pairs a page-specific writing conversation
with an explicit LuaLaTeX/PDF preview.

## Run locally

From the repository root:

```powershell
corepack pnpm install
corepack pnpm dev:alpha
```

`pdfjs-dist` (pinned) supplies the proof viewer; the server exposes only its
two browser files under `/vendor/pdfjs/`. Without it, the Studio falls back to
the browser's own PDF viewer.

Open <http://127.0.0.1:4300/frige/>. The engine's direct UI entry on port 4310
redirects there; Pantheon must run for the interface. `dev:frige` still starts
the engine alone for API work. LuaLaTeX must be installed and available on
`PATH` to build a proof. Both servers bind to loopback only.

The first launch creates an ignored local book at `apps/frige/.local-book`.
Set `STEX_FRIGE_PROJECT_DIR` to use another local project directory, or
`STEX_FRIGE_PORT` to choose another loopback port. The corresponding
`TEXGRAPH_*` settings remain fallbacks for existing local installations.

Under the STEX shell, `/frige/` is the project selector. It lists only local
book directories that contain `manuscript/Programme.md`; **Create book
project** makes a new, isolated scaffold under `apps/frige/books/` and then
opens it explicitly as `?book=<id>`. Selecting or creating a project never
rewrites an existing manuscript.

`GET /api/stex/projects` serves the books as
[`stex.projects.summary.v1`](../../protocol/projects/README.md) for Pantheon's
project lists. Its `updatedAt` is the newest file modification time in the
book, excluding Frige's private `.texgraph` and `.obsidian` folders. It reads
file metadata only and never opens a manuscript.

## Approved project context and knowledge observations

The workstation's **Discuss with Igor** link opens `/igor/new?project=…` in
Pantheon. Igor presents source selection and exact text preview; nothing is
offered until approval. Existing scoped Frige editorial threads and explicit
proposal acceptance remain independent of that conversation.
**Project knowledge** opens Graph with the current project selected. When
knowledge is enabled, inspect its source revisions and accept the references
explicitly; otherwise Graph explains that it is disabled.

`GET /api/stex/context/v1/projects/<id>` exports a paged metadata catalog;
`GET /api/stex/context/v1/projects/<id>/sources/<source-id>?revision=<sha256>`
exports one exact UTF-8 source revision under `stex.project.context.v1`.
Exports enforce manuscript containment and refuse symlink/junction escapes,
invalid text, stale hashes and source text above 12,000 bytes. They never
rewrite protected source. Source references grant no mutation authority.

`POST /api/stex/context/v1/projects/<id>/observation` takes explicit
`{sources: [{id, revision}]}` selections, revalidates them, and records an
engine-owned monotonic `stex.knowledge.event.v1` metadata checkpoint in ignored
Frige state. Identical selections reuse the checkpoint; changed valid
selections advance it. No source text is retained in this checkpoint.
Pantheon's optional Graph accepts this provenance under the
[knowledge contract](../../protocol/knowledge/README.md); it never becomes
Frige's canonical manuscript or workflow store. Frige works with Graph disabled.
Direct human-facing Obsidian integration is a required future milestone under
the [Obsidian gate](../../docs/PLATFORM-TRANSITION.md#direct-obsidian-integration).
The current metadata checkpoint and vault reader do not implement sync or
authorize changes to a manuscript from a note.

## One-page compatibility contract

The primary platform library opens Markdown manuscript books (below). The
engine also retains its older one-page local-book format:

- `book.json` and `pages/*.tex` are the canonical local book and page source.
- `.texgraph/` holds conversation JSONL, pending/accepted proposal records,
  builds, PDFs, and compiler logs.
- Source is changed only through an explicit save or proposal acceptance. A
  proposal records the base hash and is rejected when stale.
- Builds produce a generated wrapper document, run `lualatex` with shell
  escape disabled and a 30-second timeout, and keep the previous successful
  PDF when a newer build fails.
- Page source is intentionally restricted to body content; document setup,
  package imports, file operations, command definitions, and direct Lua are
  rejected before compilation.

## Manuscript book proofs

For a manuscript vault (`?book=<id>`, under `books/`), a proof typesets the
book in table-of-contents order through the selected scope.

- Each source line is a verse line: its break and leading indentation are
  kept, wrapped lines hang, and blank lines separate stanzas. `*x*`/`_x_`
  render as emphasis and `**x**` as bold; an unmatched marker or a leading
  `>` stays literal. Em, en and thin spaces print as that much space.
  Front matter and code-fence markers are not print content.
- An `Editorial` heading starts a notes section: reviewer labels
  (`**Name — score**`, recognised only when a `>` quote follows) and their
  quoted comments. It prints as one footnote on the end of the text before
  it (a heading takes the mark when no text precedes), and the work resumes
  at the first other line. A `---` just before the heading belongs to it.
- The page map comes from the compiler. Each node writes start/end markers
  that LuaLaTeX expands at shipout with the physical page and folio; the
  shipped page total is cross-checked against the PDF page count in the log.
  Any missing or inconsistent marker leaves the map marked unverified.
  Front matter, section notes and cycle notes open on a recto, decided in TeX.
  A node with no print content gets no page and no markers.
- A page or section can be typeset alone (`mode: 'isolated'`): only its
  pieces, with the book's preamble. Page and footnote numbers continue from
  the book: the start page comes from the latest verified book-order proof
  (`builds/reference-map.json`) and is marked provisional when anything
  before the scope changed since; the footnote number counts the notes
  before it. Recto openings follow the page number, so the scope lands on
  the same sides as in the book. Page maps then carry `bookPage` numbers.
  Only book-order proofs can be staged for the live build.
- A publication profile (`.texgraph/design.json`, edited in the Design
  panel) sets trim, margins, body font, size, leading, running heads and
  their title, folios and recto openers, and drives the LuaLaTeX preamble.
  The defaults reproduce proofs made before profiles existed. A proof
  records its profile hash; changing the profile makes the proof stale.
- With a section or piece selected, the Design panel also shows that
  scope's own settings: body size and leading (set together), whether it
  opens on a recto, and, for a section, the recto running-head text. Blank
  fields follow the level above: a piece follows its section, a section
  follows the book. Page size, margins, body font, folios and running heads
  stay book-wide. The assembler sets an override inside a group around that
  piece only, and the page-map entry of each piece that prints records the
  size, leading and recto setting it was typeset with. Only pieces in the
  table of contents offer their own settings
  ([layout overrides](../../protocol/frige/README.md#layout-overrides)).
- Preflight (`GET /api/project/preflight`) checks the proof on screen: the
  source-to-page map, PDF page count, trim size of every page, font
  embedding (via `pdffonts` when installed, otherwise reported as not
  checked), font fallback, missing glyphs, lines running into the margin
  (attributed to pieces), and freshness. It never marks a book press-ready;
  no printer profile or PDF/X validation exists yet.
- Staging a proof for the live build requires a compiler-verified page map,
  unchanged node sources, and an unchanged table of contents through the
  proof's scope.
- The graph reports `empty-editorial-note` for a notes section with no
  reviewer comments in that form, since no footnote prints for it.
- The sidebar is one book tree: the whole book, sections in
  table-of-contents order, and their pieces, with page numbers from the
  current proof's page map. Opening a piece scrolls the viewer to it.
- The proof viewer shows spreads (a lone opening recto, then verso + recto)
  or single pages. Zoom by fit width, fit page, preset or −/+, Ctrl/⌘ +
  wheel or pinch, and the + − 0 keys; the page in view is kept across zoom
  and across a new proof. Pages far from view release their canvas. Page
  captions and clicks come from the page map: clicking a page opens its
  node, and the selected node's pages are outlined.
- The status bar compares the displayed proof's source hashes with the
  current graph. A current, compiler-mapped proof is not press-ready: no
  printer-profile or PDF/X validation exists yet; diagnostic preflight is
  described above.

## Platform compatibility boundary

Frige now owns the historical interview-ticket and source-document operations
at [`/api/stex/legacy-books/v1`](../../protocol/frige/README.md). Pantheon's
`/api/books…` routes only proxy them; they never open a book directory.
These compatibility operations retain their historical response shapes and
are separate from the existing simple `POST /api/books` scaffold API.
Books-directory precedence is `STEX_FRIGE_BOOKS_DIR`, `TEXGRAPH_BOOKS_DIR`,
`STEX_BOOKS_DIR`, then the default. The legacy fallback belongs to Frige now.
Set `STEX_PANTHEON_URL` for a non-default loopback platform origin; the server
rejects non-loopback Host values and foreign/opaque browser origins, while
continuing to admit local CLI calls without Origin. `dev:alpha` sets the
platform origin. This is browser request protection, not multi-user identity.

## Conversation boundary

The conversation is a front end to Hermes through the server-side inference
gateway (`stex-igor/services/inference`). The browser talks only to Frige; Frige talks
only to that gateway; browser code receives neither Hermes nor provider
credentials. A0 defaults to a deterministic no-change transport.

In a manuscript book, the conversation belongs to the selected scope: the
whole book, a section, or a page each keep their own thread in
`.texgraph/conversations/<scope>.jsonl`. A turn calls
`STEX_INFERENCE_URL/v1/texgraph/scope-turn` (`protocol/texgraph`, scope turn
v3) with the scope's offered sources and at most ten recent turns.

Hermes replies in typed parts:

- **Text** renders as formatted prose.
- **Artifacts** (code, documents, data, images) are stored in
  `.texgraph/artifacts/` and shown as cards to copy, download or open.
  Images are kept only if their file signature matches their declared type;
  content is served as plain text or the checked image type, never as HTML.
- **Choices and forms** are interactive. An answer is validated against the
  stored prompt (known options, required fields, value types), recorded once,
  and sent back to Hermes as the next turn; the prompt then shows the answer.
- **Changes** to offered nodes become one pending change contract per scope,
  shown as line diffs (next section). Accepting writes the node only if it is
  unchanged since the suggestion (otherwise it is marked stale), refreshes
  the graph and editor, and typesets the scope again.

### Change contracts

A proposal is stored as a change contract
([`stex.frige.change-contract.v1`](../../protocol/frige/README.md#change-contracts-v1)).
The contract is the whole record of one proposed change:

- **What was asked and why:** the author's request and the director's reason.
- **The exact change:** each piece's prior and proposed text with their
  SHA-256 hashes, plus line counts.
- **What the director was shown,** by category: manuscript pieces offered
  (canonical source), author-approved references, pieces withheld as too
  long, and the publication profile in force.
- **Effects and conflicts:** proofs that include the pieces become stale;
  undecided proposals to the same piece from another conversation are named.
- **Approval and rollback terms,** and the proof that typeset the accepted
  text once one is built.

Each contract is one file in `.texgraph/contracts/` and is kept after it is
decided. `.texgraph/proposals/<scope>.json` only points at the scope's current
contract. A newer proposal in the same conversation marks an undecided one
*superseded*; it is never erased. A change set written before contracts that
is still undecided stays decidable, and joins the history when it is decided
or superseded. One already decided before contracts existed is not in the
history and cannot be rolled back.

**Roll back** (beside an accepted change in the thread) restores the exact
prior text and hash and keeps the piece's identity. It is refused, and nothing
is written, if the piece changed after it was accepted. The workstation then
typesets the scope again.

Restoration is byte-exact for valid UTF-8, including a byte-order mark, line
endings and a missing final newline. A piece that is not valid UTF-8 is never
overwritten at all — by a save, an acceptance or a rollback — because its
bytes could not be restored (`400 SOURCE_NOT_UTF8`).

A contract keeps the strongest proof that typeset all its accepted text: a
compiler-verified book-order proof is not displaced by a piece typeset alone.
Accepting another piece of the same contract clears the proof until one
covers that piece too.

A source save must carry the base hash of the text it replaces; one without is
refused with `400 BASE_HASH_REQUIRED`.

The deterministic simulator (`STEX_FRIGE_INFERENCE_MODE=fake`, the `dev:alpha`
default) proposes nothing unless the message begins `Simulate change:`. It then
proposes one labelled change that appends the rest of the message as a closing
line to the first offered piece, never to the table of contents. This
exercises the contract path without a provider. The inference service itself
does not yet return changes from a real director.

A section's or a piece's conversation can also propose a **layout change**:
setting or clearing that section's or piece's own size and leading, recto
opening or (section) running head. The card lists each setting from what it
follows now to the proposed value. Acceptance and **Roll back** check the
whole publication profile instead of a piece's text: either is refused if
the profile changed in between. With the simulator, write
`Simulate layout: 15pt/18pt`, `recto on`, `recto off`, `recto inherit`,
`size inherit`, `head <text>`, `head inherit` or `clear`. A contract holds
either text changes or one layout change.

The Hermes pill reports whether the local fake transport or optional remote
Hermes boundary is available. A failed turn is saved with a safe reason and
changes nothing. The legacy v3 endpoint is a compatibility adapter over
`stex.hermes.turn.v1`; A0 does not expose a provider roster or make paid
inference calls.

The single-page local book (`book.json`) still uses `page-turn` v1.

## Interface

Pantheon renders the existing publishing library and workstation with the
shared design system and Dusty Garnet accent. The common platform header and
navigation replace duplicate Frige mastheads; the workstation uses a compact
header. The engine serves no UI code and never reads Pantheon's files. Its
design-system, media copies and PDF.js resources remain available for
compatibility. The platform consumes
[`stex.frige.publishing.v1`](../../protocol/frige/README.md#publishing-v1).

- The project library uses the common motion policy; the instrumental
  workstation omits artwork. Global navigation and Book projects remain
  available. Unsaved Markdown triggers the native leave-page protection.
- The workstation keeps three columns at 1024 px and wider. From 640 to
  1023 px the contents tree becomes a drawer (Tab stays inside, Escape closes
  it and restores focus); below 640 px
  one view shows at a time (Contents, Editor, Proof). Layout state is
  presentation only and never changes a book.
- Interface fonts and colours never reach book output: proof pages stay white
  and the LuaLaTeX preamble comes only from the publication profile.

## Checks

```powershell
Push-Location apps/frige
corepack pnpm test
Pop-Location
corepack pnpm verify:frige   # Chrome: platform create/save/stale-save/accept/proof/rollback/reject/profile, 5 widths
```

Proof tests compile synthetic books with LuaLaTeX and skip when it is absent.
`verify:frige` requires LuaLaTeX for its real PDF evidence. It starts Pantheon,
Frige and a labelled local inference stub with disposable books. It covers
creation, Unicode/indentation-preserving save, stale-write refusal, visible
proposal/explicit acceptance, rendered compiler-mapped PDF, the proof recorded
on the change contract, rollback to the exact prior text, a rejected proposal,
profile freshness,
model-settings styling, keyboard focus, tablet drawer and five widths. It
saves screenshots/report outside the repository (`--out <directory>`).
