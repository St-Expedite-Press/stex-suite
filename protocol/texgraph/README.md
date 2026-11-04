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

**Request `answer`** — `{ promptId, values }` when the author answers a choice
or form. The product validates the answer against the stored prompt (known
option ids, required fields) and sends a readable summary as `message`.
