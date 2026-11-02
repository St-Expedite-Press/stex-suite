# TexGraph director capability contract v1

TexGraph reaches the persistent director only through the authenticated
inference gateway. Each turn supplies a **Director Kit** with five skills and
four bounded tool adapters:

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
