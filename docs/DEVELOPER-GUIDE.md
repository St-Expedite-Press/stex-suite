# STEX developer guide

Supported local workflow: Node 22.13+ (22 or 24 LTS, which bundle Corepack), pnpm 9.15 via Corepack, Git, LuaLaTeX for Frige proof tests, and optionally `pdffonts` for Frige preflight. Check the toolchain with `corepack pnpm check:prereqs` (see [Prerequisites](../README.md#prerequisites)), then install with `corepack pnpm install --frozen-lockfile`.

| Command | Purpose |
| --- | --- |
| `corepack pnpm test` | All deterministic suites, including `test:stex-igor-sync` |
| `corepack pnpm sync:stex-igor` | Copy `packages/design-system`, the masthead and splash media, and Pantheon's `splash.css` and `motion.js` into the `stex-igor` submodule after changing them; then commit inside `stex-igor` |
| `corepack pnpm dev:alpha` | Shell plus active application processes |
| `corepack pnpm --dir apps/seaxneat build` | React production build |
| `corepack pnpm build:pantheon` | TypeScript check and build of the platform-owned Seaxneat workspace (`build:seaxneat` is a compatibility alias) |
| `corepack pnpm verify:platform` | Real `dev:alpha`, disposable Seaxneat create/edit/diff/restore and Next preview, sandbox checks, five viewports |
| `corepack pnpm build:igor` | Igor's Vite production build (needed before `dev:igor` or `verify:igor`) |
| `corepack pnpm run test:hermes` | Validate the role/profile catalog |
| `corepack pnpm run test:knowledge` | Metadata journal/projection, consent, replay, inference, durability and legacy vault-adapter tests |
| `corepack pnpm run test:design-system` | Tokens, contrast, status colours, font coverage |
| `corepack pnpm run test:assets` | Asset manifest, naming, checksums, budgets, LFS pointers |
| `corepack pnpm assets:build [splash\|masthead\|emblems]` | Rebuild web media from masters, bit-exact (needs FFmpeg) |
| `corepack pnpm verify:splash` | Browser check of the splash at 15 viewports (needs Chrome or Edge) |
| `corepack pnpm verify:home` | Browser check of the command center with an isolated stack and disposable data (needs Chrome or Edge) |
| `corepack pnpm verify:igor-login` | Browser check of hosted Igor's password sign-in page (the Pantheon splash with a form) at 15 viewports, plus a real sign-in, with a disposable user; needs `corepack pnpm build:igor` and Chrome or Edge |
| `corepack pnpm verify:igor` | Browser check of the Igor handoff, conversation workflow, and layout at 5 viewports with a stub inference service (needs Chrome or Edge) |
| `corepack pnpm verify:knowledge` | Disposable engine/knowledge workflow, revision acceptance, relationships, withdrawal, restart, export/deletion and four Chrome viewports |

Use disposable temp data for Seaxneat through `STEX_SEAXNEAT_DATA_DIR` and for Igor through `STEX_IGOR_DATA_DIR`. Canonical
Pantheon and Frige settings are `STEX_PANTHEON_*` and `STEX_FRIGE_*`; legacy
aliases are fallbacks. Remote Hermes configuration remains server-side; test
the fake transport by default. Interface work uses `@stex/design-system`
(plain CSS, see [its README](../packages/design-system/README.md)) and follows
[the doctrine](DESIGN-SYSTEM.md); binary media go through Git LFS and
[the asset manifest](../assets/README.md). See [MONOREPO.md](../MONOREPO.md),
application READMEs, and [verification reports](verification/).

## Platform transition

The suite's GitHub CI needs the repository secret `STEX_IGOR_READ_TOKEN` to
read the private submodule. Its gate intentionally skips the test job when
the token is unavailable; a green workflow alone does not prove tests ran.
P1's suite PR encountered that limit, while all 130 tests passed locally and
Igor's independent GitHub CI ran successfully. Credential changes require
separate owner authorization.

Follow [the ordered plan](PLATFORM-TRANSITION.md). Pantheon owns the common
shell and `apps/pantheon/workspaces/seaxneat` presentation; Seaxneat owns
workspace state and operations through
[`stex.seaxneat.workspace.v1`](../protocol/seaxneat/README.md). Publishing UI
lives in `apps/pantheon/workspaces/frige` and consumes
[`stex.frige.publishing.v1`](../protocol/frige/README.md#publishing-v1).
Igor's private renderer is composed through `stex.igor.interface.v1`; Pantheon
owns the shell and loads only validated same-origin assets from its descriptor.
The conversation service owns approved project snapshots and context epochs
under `stex.igor.context.v1`. Do not relocate canonical state to Pantheon.
The legacy `/api/books` API now proxies a
[Frige-owned boundary](../protocol/frige/README.md).

`dev:alpha` builds the platform workspace and Igor, uses fake inference, and
sets each engine's `STEX_PANTHEON_URL` to the selected shell port. When
launching engines independently with a non-default platform port, set this
loopback origin explicitly so same-origin browser requests are admitted.
`STEX_BOOKS_DIR` remains a Frige compatibility fallback; Pantheon ignores
engine filesystem settings; its optional knowledge service has a separate
explicit data directory. Generated preview responses and frames are sandboxed;
opaque browser origins cannot mutate engine APIs. OS isolation for arbitrary
build code remains outside this local alpha's verified guarantees.

`dev:alpha` also gives Igor fixed loopback `STEX_FRIGE_URL` and
`STEX_SEAXNEAT_URL` origins for owner-validated context exports. Standalone or
hosted Igor without those explicit settings reports the engine unavailable.
Context selection uses metadata catalogs, exact text preview, a digest and
revision revalidation. Changed/withdrawn context advances its runtime session
epoch and excludes prior-epoch history; this is not provider-side deletion.

Knowledge is opt-in. From PowerShell at the repository root:

```powershell
$env:STEX_KNOWLEDGE_DATA_DIR = Join-Path (Get-Location) 'services/knowledge/.local-data'
corepack pnpm dev:alpha
```

Pantheon hosts `/api/knowledge/v1` and the Graph view; the knowledge library
owns its metadata journal in that selected ignored directory. Engines emit
durable monotonic observation events after revision checks; accepting one
updates coordinated source and user-context projections. No source text,
conversation transcript or engine operational state is stored there. Current
source access checks are bounded to 40 references, four concurrent requests,
and a six-second deadline; unchecked references remain unavailable.
Graph assertions/inferences have evidence, correction/rejection and explicit
preview handoff to Igor. Export/erasure, replay and stale events are specified
in [the knowledge contract](../protocol/knowledge/README.md).

These paths are implemented and tested locally. The broader twin,
embeddings, multimodal retrieval, vault integration, agent tools, shared
identity and a generalized scheduler remain outside this transition. No
production deployment follows from a review-branch push.

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
[`runtime/README.md`](../stex-igor/runtime/README.md). Earlier verification includes a direct no-tool turn, I1 provider-backed Igor
turns through Pantheon, and I2 hosted Igor turns; see [STATUS.md](STATUS.md).
Those bounded runs do not establish Frige remote behavior or authorize further
paid calls.

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
