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
