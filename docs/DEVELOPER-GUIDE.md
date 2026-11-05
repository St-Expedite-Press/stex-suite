# STEX developer guide

Supported local workflow: Node 22+, pnpm 9, Git, and LuaLaTeX for Frige proof tests. Install with `corepack pnpm install --frozen-lockfile`.

| Command | Purpose |
| --- | --- |
| `corepack pnpm test` | All deterministic suites |
| `corepack pnpm dev:alpha` | Shell plus active application processes |
| `corepack pnpm --dir apps/seaxneat build` | React production build |
| `corepack pnpm run test:hermes` | Validate the role/profile catalog |
| `corepack pnpm run test:knowledge` | Validate the optional User Graph adapter |

Use disposable temp data for Seaxneat through `STEX_SEAXNEAT_DATA_DIR`. Canonical
Pantheon and Frige settings are `STEX_PANTHEON_*` and `STEX_FRIGE_*`; legacy
aliases are fallbacks. Remote Hermes configuration remains server-side; test
the fake transport by default. See [MONOREPO.md](../MONOREPO.md), application
READMEs, and [verification reports](verification/).
