# STEX developer guide

Supported local workflow: Node 22+, pnpm 9, Git, and LuaLaTeX for Frige proof tests. Install with `corepack pnpm install --frozen-lockfile`.

| Command | Purpose |
| --- | --- |
| `corepack pnpm test` | All deterministic suites |
| `corepack pnpm dev:alpha` | Shell plus active application processes |
| `corepack pnpm --dir apps/seaxneat build` | React production build |

Use disposable temp data for Seaxneat through `STEX_SEAXNEAT_DATA_DIR`. Remote Hermes configuration remains server-side; test the fake transport by default. See application READMEs and [verification reports](verification/).
