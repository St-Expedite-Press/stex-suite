# STEX developer guide

Supported local workflow: Node 22.13+ (22 or 24 LTS, which bundle Corepack), pnpm 9.15 via Corepack, Git, LuaLaTeX for Frige proof tests, and optionally `pdffonts` for Frige preflight. Check the toolchain with `corepack pnpm check:prereqs` (see [Prerequisites](../README.md#prerequisites)), then install with `corepack pnpm install --frozen-lockfile`.

| Command | Purpose |
| --- | --- |
| `corepack pnpm test` | All deterministic suites |
| `corepack pnpm dev:alpha` | Shell plus active application processes |
| `corepack pnpm --dir apps/seaxneat build` | React production build |
| `corepack pnpm run test:hermes` | Validate the role/profile catalog |
| `corepack pnpm run test:knowledge` | Validate the optional User Graph adapter |
| `corepack pnpm run test:design-system` | Tokens, contrast, status colours, font coverage |
| `corepack pnpm run test:assets` | Asset manifest, naming, checksums, budgets, LFS pointers |
| `corepack pnpm assets:splash` | Rebuild splash media from masters (needs FFmpeg) |
| `corepack pnpm verify:splash` | Browser check of the splash at 10 viewports (needs Chrome or Edge) |

Use disposable temp data for Seaxneat through `STEX_SEAXNEAT_DATA_DIR`. Canonical
Pantheon and Frige settings are `STEX_PANTHEON_*` and `STEX_FRIGE_*`; legacy
aliases are fallbacks. Remote Hermes configuration remains server-side; test
the fake transport by default. Interface work uses `@stex/design-system`
(plain CSS, see [its README](../packages/design-system/README.md)) and follows
[the doctrine](DESIGN-SYSTEM.md); binary media go through Git LFS and
[the asset manifest](../assets/README.md). See [MONOREPO.md](../MONOREPO.md),
application READMEs, and [verification reports](verification/).
