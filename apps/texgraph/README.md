# TexGraph Studio

TexGraph is the local, single-user STEX application for building a book one
page at a time. Its working surface pairs a page-specific writing conversation
with an explicit LuaLaTeX/PDF preview.

## Run locally

From the repository root:

```powershell
corepack pnpm dev:texgraph
```

Then open <http://127.0.0.1:4310>. LuaLaTeX must be installed and available on
`PATH` to build a preview. The app binds to loopback only.

The first launch creates an ignored local book at `apps/texgraph/.local-book`.
Set `TEXGRAPH_PROJECT_DIR` to use another local project directory, or
`TEXGRAPH_PORT` to choose another loopback port.

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

## Conversation boundary

The browser talks only to TexGraph. TexGraph may call the configured inference
gateway at `STEX_INFERENCE_URL/v1/texgraph/page-turn`; it sends the active
page, book design, and at most ten recent turns. It never reads or exposes an
OpenRouter credential. The gateway response must be commentary plus either a
complete proposed page source or an explicit no-change result.

Until the gateway is implemented and configured, turns are preserved locally
and the Studio plainly reports that no revision was proposed.

## Checks

```powershell
Push-Location apps/texgraph
corepack pnpm test
Pop-Location
```
