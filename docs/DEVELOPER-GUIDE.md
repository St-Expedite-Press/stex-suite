# STEX developer guide

Supported local workflow: Node 22.13+ (22 or 24 LTS, which bundle Corepack), pnpm 9.15 via Corepack, Git, LuaLaTeX for Frige proof tests, and optionally `pdffonts` for Frige preflight. Check the toolchain with `corepack pnpm check:prereqs` (see [Prerequisites](../README.md#prerequisites)), then install with `corepack pnpm install --frozen-lockfile`.

| Command | Purpose |
| --- | --- |
| `corepack pnpm test` | All deterministic suites, including `test:stex-igor-sync` |
| `corepack pnpm sync:stex-igor` | Copy `packages/design-system`, the masthead and splash media, and Pantheon's `splash.css` and `motion.js` into the `stex-igor` submodule after changing them; then commit inside `stex-igor` |
| `corepack pnpm dev:alpha` | Shell plus active application processes |
| `corepack pnpm --dir apps/seaxneat build` | React production build |
| `corepack pnpm build:igor` | Igor's Vite production build (needed before `dev:igor` or `verify:igor`) |
| `corepack pnpm run test:hermes` | Validate the role/profile catalog |
| `corepack pnpm run test:knowledge` | Validate the optional User Graph adapter |
| `corepack pnpm run test:design-system` | Tokens, contrast, status colours, font coverage |
| `corepack pnpm run test:assets` | Asset manifest, naming, checksums, budgets, LFS pointers |
| `corepack pnpm assets:build [splash\|masthead\|emblems]` | Rebuild web media from masters, bit-exact (needs FFmpeg) |
| `corepack pnpm verify:splash` | Browser check of the splash at 15 viewports (needs Chrome or Edge) |
| `corepack pnpm verify:home` | Browser check of the command center with an isolated stack and disposable data (needs Chrome or Edge) |
| `corepack pnpm verify:igor-login` | Browser check of hosted Igor's password sign-in page (the Pantheon splash with a form) at 15 viewports, plus a real sign-in, with a disposable user; needs `corepack pnpm build:igor` and Chrome or Edge |
| `corepack pnpm verify:igor` | Browser check of the Igor handoff, conversation workflow, and layout at 5 viewports with a stub inference service (needs Chrome or Edge) |

Use disposable temp data for Seaxneat through `STEX_SEAXNEAT_DATA_DIR` and for Igor through `STEX_IGOR_DATA_DIR`. Canonical
Pantheon and Frige settings are `STEX_PANTHEON_*` and `STEX_FRIGE_*`; legacy
aliases are fallbacks. Remote Hermes configuration remains server-side; test
the fake transport by default. Interface work uses `@stex/design-system`
(plain CSS, see [its README](../packages/design-system/README.md)) and follows
[the doctrine](DESIGN-SYSTEM.md); binary media go through Git LFS and
[the asset manifest](../assets/README.md). See [MONOREPO.md](../MONOREPO.md),
application READMEs, and [verification reports](verification/).

## Hermes / Igor runtime (H1)

Initialize the suite-owned upstream source before working on Hermes:

```powershell
git submodule update --init --recursive
```

The pinned source is `stex-igor/runtime/hermes-agent` (H1 currently pins commit
`e76fbd80be65ea5c1b89831f8d7aaedb713f5cac`). Its supported
native-Windows installer is documented in that checkout. It installs outside
the repository, under `%LOCALAPPDATA%\hermes`; do not copy session data,
credentials, logs, caches, or virtual environments into the suite.

The H1 local runtime is provisioned as a profile-scoped, Igor-only gateway.
The ignored `%LOCALAPPDATA%\hermes\profiles\igor\.env` contains
`OPENROUTER_API_KEY`, `API_SERVER_ENABLED=true`, and a unique
`API_SERVER_KEY`; seven specialist profiles are parked and have no provider
credential. Check only the installed profile catalog with:

```powershell
corepack pnpm run check:hermes-runtime
```

Do not enable a Hermes toolset: Igor's CLI **and API-server** tool policies are
intentionally empty, and its dormant Docker terminal configuration has no
forwarded secrets, host mounts, or network egress. The reconciliation command
checks both surfaces. `hermes -p igor gateway run` is the only H1 gateway
command; its upstream `gateway.standalone` compatibility configuration prevents
the default multiplexer from serving specialists.

Before starting a live gateway, pre-pull and locally verify the sandbox image
without calling a provider; see the exact commands in
[`runtime/README.md`](../stex-igor/runtime/README.md). One direct no-tool OpenRouter turn
has succeeded, but that is not Pantheon or Frige remote-workflow evidence.

For an authorized provider-backed STEX integration activation, set only these STEX values in ignored
`.env`: `STEX_HERMES_TRANSPORT=remote`,
`STEX_HERMES_URL=http://127.0.0.1:8642`, `STEX_HERMES_API_KEY`,
`STEX_HERMES_ISOLATION=verified`, and
`STEX_HERMES_TOOL_POLICY=conversational-only`. The inference service refuses
remote turns until both explicit operator acknowledgements are present; they
do not prove the required OS/container boundary. Set
`STEX_HERMES_MAX_CONCURRENT_TURNS=1` unless an approved budget changes it.
Start in order:

```powershell
hermes -p igor gateway run
corepack pnpm dev:inference
corepack pnpm dev:alpha
```

Stop with `Ctrl+C` in reverse order. Diagnose configuration with
`Invoke-RestMethod http://127.0.0.1:8100/v1/hermes/health`; the `?probe=1`
variant also needs the STEX shared token and tests authenticated upstream reachability but is not evidence of a
provider-backed answer. The fake transport remains the default and all
repository tests use it or stubs, so none spends provider funds.
