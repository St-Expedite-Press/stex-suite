# Frige

Frige is STEX Pantheon's local publishing and typesetting application. It is
available at `/frige/`; `/texgraph/` remains a route compatibility redirect.
Never use a real manuscript as a test fixture or alter
`books/*/manuscript/` for layout convenience.

Frige is the local, single-user STEX application for building a book one
page at a time. Its working surface pairs a page-specific writing conversation
with an explicit LuaLaTeX/PDF preview.

## Run locally

From the repository root:

```powershell
corepack pnpm install
corepack pnpm dev:frige
```

`pdfjs-dist` (pinned) supplies the proof viewer; the server exposes only its
two browser files under `/vendor/pdfjs/`. Without it, the Studio falls back to
the browser's own PDF viewer.

Then open <http://127.0.0.1:4310>. LuaLaTeX must be installed and available on
`PATH` to build a preview. The app binds to loopback only.

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

## Current contract

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
  preflight exists yet.

## Conversation boundary

The conversation is a front end to Hermes through the server-side inference
gateway (`services/inference`). The browser talks only to Frige; Frige talks
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
- **Changes** to offered nodes become one pending change set per scope
  (`.texgraph/proposals/<scope>.json`), shown as line diffs. Accepting writes
  the node only if it is unchanged since the suggestion (otherwise it is
  marked stale), refreshes the graph and editor, and typesets the scope again.

The Hermes pill reports whether the local fake transport or optional remote
Hermes boundary is available. A failed turn is saved with a safe reason and
changes nothing. The legacy v3 endpoint is a compatibility adapter over
`stex.hermes.turn.v1`; A0 does not expose a provider roster or make paid
inference calls.

The single-page local book (`book.json`) still uses `page-turn` v1.

## Checks

```powershell
Push-Location apps/frige
corepack pnpm test
Pop-Location
```

The proof test compiles a synthetic book with LuaLaTeX and is skipped when
`lualatex` is not on `PATH`.
