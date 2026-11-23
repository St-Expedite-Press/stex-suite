# TexGraph director capability contract v1

TexGraph reaches Hermes, the editorial director, only through the authenticated
inference gateway, which runs the director on OpenRouter. TexGraph's
conversation is a front end to that director: it supplies context, renders
replies and enforces every state change. Each turn supplies a **Director Kit**
with five skills and four bounded tool adapters:

- Book scope and Programme-order reasoning.
- Author-gated Obsidian Markdown revision.
- Composition and section architecture.
- Review-gated document grounding.
- LuaLaTeX/page-map preview reasoning.

The declared MCP surfaces are not open remote services:

| Surface | Access | Constraint |
| --- | --- | --- |
| `texgraph-vault` | Context adapter | Normalized selected scope, graph, diagnostics, and Programme order only. |
| `markitdown` | Review-gated context adapter | Only author-approved extracted excerpts. |
| `lualatex-preview` | Explicit local operation | Product-run build and page-map results; no director shell access. |

The director cannot read the raw vault, run commands, invoke providers, see
credentials, or write canonical state. It may make structured proposals and
suggestions. TexGraph validates them; the author accepts any canonical source
change and explicitly triggers builds.

For Frige scope turns, `approvedSourceExcerpts` carries up to eight
`{id,name,hash,excerpt}` records. `hash` is the SHA-256 digest of the exact
UTF-8 excerpt the author approved. The gateway verifies the shape and
digest before putting any of these records in its untrusted context.
It trims whole records within the existing turn budget and returns
`meta.forwardedContext.approvedSourceExcerpts` with the admitted ids and
digests. A record with no digest is omitted. This is conversational context
and grants no runtime tool authorization.

## Scope turn v2 (`stex.texgraph.scope-turn.v2`)

An author conversation with a selected scope: the whole book, a section, or a
page. `POST /v1/texgraph/scope-turn` carries `scope` (id, kind, title, node
ids), `scopeSources` (the current text and hash of each node the director may
change: the table of contents for the book, every node of a section or page,
within a size budget), `withheldNodes` (in scope but too large to include),
a slim `graph`, approved excerpts, recent turns and the message.

The director replies with `commentary`, optional `graphSuggestions`, and
optional `changes: [{ nodeId, source, summary }]`, each a complete
replacement of an offered node. The gateway rejects malformed changes.

A change may instead carry **anchored edits** (added 2026-11-20, additive;
[D-020](../../docs/program/DECISIONS.md)):
`{ nodeId, edits: [{ find, replace }], summary }`, with `edits` in place of
`source`, never both. Each `find` is text copied exactly from the offered
node that occurs there exactly once; `replace` takes its place (empty
deletes it). At most 40 edits per node, each `find` and `replace` at most
20,000 UTF-16 units. The gateway checks only their shape and never clips
them. Frige resolves the edits against the exact text it offered. That node's
whole change is refused, with the reason shown in the reply, when a `find`:

- is missing from the text;
- occurs more than once;
- overlaps another edit;
- would end between the two characters of a CRLF;

or when a `replace` would write a carriage return that ends no line.

Offsets and line numbers are never accepted. The result is recorded as an
ordinary whole-text change (below), so a reader of the change set or contract
sees no difference.

**Request `proposalForms`** (optional, additive) is how a Frige that
resolves edits says so: `["source", "edits"]`. The gateway teaches the
director the edit form, and passes `edits` on, only to a caller that sends
it. A caller that sends no `proposalForms`, such as a Frige from before
anchored edits, gets the whole-piece instructions word for word as before.
Any edits its director writes anyway are set aside with a notice, because
such a Frige would otherwise drop them silently.
TexGraph keeps a change only if its node was offered in that turn, records
the kept changes as one pending change set for the scope, and writes nothing
until the author accepts. Acceptance writes through the node's base hash, so
a node edited since the suggestion is marked stale instead of overwritten.
The page-turn v1 contract and its director kit are unchanged.

## Scope turn v3: reply parts and answers

v3 adds two optional fields to scope turn v2; v2 fields keep their meaning.

**Reply `parts`** — the body of the director's reply, in order (at most 12):

| Part | Fields | Product behavior |
| --- | --- | --- |
| `text` | `text` (Markdown, ≤ 20,000 chars) | Rendered as formatted prose |
| `artifact` | `kind` (`code`, `document`, `data`), `title`, `language`, `content` (≤ 200,000 chars) | Stored by the product, shown as a card to copy, download or expand |
| `artifact` | `kind: image`, `mediaType` (PNG, JPEG, WebP, GIF), `content` (base64, ≤ 8 MB) | Stored after the product checks the file signature; shown as a card |
| `choice` | `id`, `prompt`, `options` (2–12 `{ id, label, description }`), `multiple`, `allowOther` | Interactive; answered once |
| `form` | `id`, `title`, `fields` (1–12 `{ id, label, kind: text\|textarea\|select\|number\|checkbox, required, options, placeholder }`), `submitLabel` | Interactive; answered once |

The gateway validates each part and sets an invalid one aside with its reason
(`droppedParts`) rather than failing the reply. Images a model returns beside
its text become image artifacts. The reply also carries `meta` (`model`,
`usage`, `role`, and `skipped` when earlier models in the role's stack were
unavailable) for provenance. These fields are additive; readers ignore ones
they do not know.

**Request `outline`, `documentSettings`, `approvedContracts`** (optional,
added 2026-11-17) — context from the levels around the conversation's scope,
each with its own `category` and none holding manuscript text. Piece titles
are their headings, offered as identifying metadata.

| Field | Category | Content |
| --- | --- | --- |
| `outline` | `outline` | `{entries, truncated}`: pieces in reading order with `nodeId`, `title`, `relativePath`, `kind`, `hash`, `section`, and book `pages` only from a verified proof that still matches the text, profile and reading order; at most 20,000 UTF-8 bytes, with `truncated` when pieces were left out |
| `documentSettings` | `document-settings` | `{designHash, book, scope}`: the publication profile and, for a section or piece, the size and leading in force there, where they come from, and the scope's own override |
| `approvedContracts` | `approved-contract` | `{entries, unavailable?}`: at most eight accepted change contracts relevant to the scope, as targets. The author's `request` is included only for contracts written in the same conversation, since it may quote any piece |

The scope's own text stays in `scopeSources`, separate from these. The STEX
inference adapter forwards them to Hermes under `context.legacy`, keeping
only known fields with bounded lengths, and trims the outline first, then
approved contracts, while the request exceeds 90,000 UTF-8 bytes. Sources and
the conversation are never trimmed, so a turn whose sources and recent turns
alone exceed the budget is still refused. The reply's `meta.forwardedContext`
(`{outline: {count, truncated}, documentSettings, approvedContracts}`) reports
what was forwarded after trimming. A reader that does not know these fields
ignores them.

**Reply `layout`** (optional, added 2026-11-17) — one proposed change to the
layout override of the conversation's own section or piece:
`{ set: { fontSize, leading, opensRecto, headText }, summary }`, where a
`null` value removes that setting, or `{ clear: true, summary }`. Frige
validates it and records it as a
[layout change contract](../frige/README.md#change-contracts-v1); it never
applies it without the author's acceptance. The STEX inference gateway does
not produce this field yet; readers that do not know it ignore it.

**Request `selection`** (optional, added 2026-11-21;
[D-021](../../docs/program/DECISIONS.md)) is the passage the author
selected, which Frige has already checked against the piece's current
source: `{ category: "selected-passage", nodeId, relativePath, sourceHash,
action, startLine, endLine, text }`.

- `action` is one of `ask`, `revise`, `explain`, `alternatives` or
  `compare`.
- `text` is the passage's exact bytes, at most 12,000 UTF-16 units.

The gateway forwards it whole, under its own label, and only for a piece in
`scopeSources`; otherwise it drops it. It never clips it. When it forwards
one, its trusted instructions add the passage rule, and it reports
`meta.forwardedContext.selection: true`. Except for `ask`, Frige keeps only
proposed changes inside the passage, and resolves an edit's `find` within the
passage. A reader that does not know the field ignores it, and Frige then
records the passage as unconfirmed.

**Request `answer`** — `{ promptId, values }` when the author answers a choice
or form. The product validates the answer against the stored prompt (known
option ids, required fields) and sends a readable summary as `message`.
