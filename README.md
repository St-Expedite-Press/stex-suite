# STEX Pantheon

STEX Pantheon is a local-first creative computing platform with modular
capability engines. Pantheon owns the common web environment; Frige owns
publishing state, Seaxneat owns website workspaces, and Igor supplies the
Hermes-derived intelligence layer. Ēostre and Woden remain deferred.

The [platform transition plan](docs/PLATFORM-TRANSITION.md) distinguishes the
destination from implementation. Its first composed workspace is Seaxneat;
Frige and Igor retain their existing frontends during the staged migration.
The evolving User Graph and multimodal knowledge base remain specified future
work; the current knowledge adapter is optional and read-only.

| Subsystem | Path | Status |
| --- | --- | --- |
| Pantheon | `apps/pantheon` | Common shell, composed Seaxneat workspace, local proxy |
| Frige | `apps/frige` | Active manuscripts, proofs, and preflight |
| Seaxneat | `apps/seaxneat`; UI in `apps/pantheon/workspaces/seaxneat` | Active engine and platform-owned website workspace |
| Igor | `stex-igor/apps/igor` | Active conversations with the Pantheon Director; fake transport by default |
| Eostre / Woden | `apps/eostre`, `apps/woden` | Deferred, no simulated workflows |
| Design system | `packages/design-system`, `assets` | Shared CSS tokens, type, and brand marks; LFS asset library |
| Hermes | `stex-igor/runtime/hermes-agent`, `stex-igor/hermes`, `stex-igor/services/inference` | Pinned upstream runtime source, declarative STEX roster, and fake/upstream API boundary |
| User Graph | `vault`, `services/knowledge` | Optional portable vault; read-only adapter |

## Prerequisites

STEX is Node-only; there is no Python environment or `requirements.txt`.
JavaScript dependencies are declared in each workspace's `package.json` and
pinned in `pnpm-lock.yaml`. System tools are installed separately:

| Tool | Need | Used by |
| --- | --- | --- |
| Node.js 22.13+ (22 or 24 LTS) | Required | Everything. Node 25+ no longer bundles Corepack, which the Windows launchers call directly. |
| Corepack with pnpm 9.15.9 | Required | Bundled with Node 22–24; `packageManager` selects pnpm. |
| Git | Required | Seaxneat workspace revisions. |
| Git LFS | Required | Brand masters and splash media (`git lfs install` once per machine). Without it the splash media are pointer files. |
| LuaLaTeX with `fontspec`, `microtype`, `geometry` | Recommended | Frige proofs. Proof tests skip without it. TeX Live or MiKTeX. |
| `pdffonts` | Optional | Frige font-embedding preflight. Ships with Poppler and MiKTeX. |
| FFmpeg (`ffmpeg`, `ffprobe`) | Optional | Rebuilding web media from masters (`assets:build`). |
| Chrome or Edge | Optional | Browser verification (`verify:splash`, `verify:home`). |

Run `corepack pnpm check:prereqs` to check them. It exits non-zero only when a
required tool is missing.

## Local development

The hosted-VM stack (Igor, the inference service, Hermes configuration) is the
private submodule `stex-igor/` (`St-Expedite-Press/stex-igor`). Cloning it needs
read access to that repository and Git LFS:

```powershell
git clone --recurse-submodules https://github.com/St-Expedite-Press/stex-suite.git
# On Windows, clone to a short path or run: git config --global core.longpaths true
```

Without access, the suite still clones, but Igor, inference, and Hermes are
missing and `corepack pnpm install --frozen-lockfile` fails.

```powershell
corepack pnpm check:prereqs
corepack pnpm install --frozen-lockfile
corepack pnpm test
corepack pnpm dev:alpha
```

Open `http://127.0.0.1:4300/` for the splash; **Sign in** enters the command
center at `/home/` (a local single-user entry, not authentication). Pantheon
proxies Frige at `/frige/`; `/seaxneat/` redirects to the platform-owned
`/workspaces/seaxneat/`, whose API calls reach the Seaxneat engine through
the proxy. `/texgraph/` remains
an explicit Frige compatibility redirect. The fake Hermes transport is deterministic and makes no provider
request.

Use `corepack pnpm dev:pantheon`, `dev:frige`, or `dev:seaxneat` for an
individual active application. The temporary `dev:lab` and `dev:texgraph`
aliases remain for existing automation. Canonical settings use `STEX_PANTHEON_*`
and `STEX_FRIGE_*`; a legacy setting is a fallback only.

Frige manuscripts are protected source. Never use a real manuscript as a test
fixture. Seaxneat state is ignored local data. The User Graph is optional
knowledge, never application state, Hermes memory, or credentials.

## Hermes / Igor H1 runtime

The suite carries the upstream Hermes Agent source as the pinned
`stex-igor/runtime/hermes-agent` submodule. Initialize it after cloning with
`git submodule update --init --recursive`. STEX's production-shaped adapter
keeps `stex.hermes.turn.v1` stable and translates it to Hermes's authenticated
OpenAI-compatible API; the safe default remains the deterministic fake.

The checked-in [runtime profile manifest](stex-igor/hermes/runtime-profiles.json) maps
Igor and seven parked specialists to STEX's declarative roles. Run
`corepack pnpm run check:hermes-runtime` to read and reconcile the local
upstream profile catalog, model-provider selections, and empty CLI/API-server
tool policies; it changes nothing and never reads a credential.

Local gateway preparation is deliberately fail-closed. When manually started,
the Igor-only loopback API has its provider credential scoped to Igor and no
runtime tools enabled; it is otherwise stopped. STEX `.env` holds only the
loopback URL and API credential, never `OPENROUTER_API_KEY`. One bounded direct
provider turn has been verified, but STEX applications remain on the fake
transport and any additional paid turn needs explicit authorization and a
budget. See [the runtime package](stex-igor/runtime/README.md), [inference service](stex-igor/services/inference/README.md),
and [developer guide](docs/DEVELOPER-GUIDE.md).

## Documentation

Start here, then choose the reader path that fits:

| Reader | Document | What it establishes |
| --- | --- | --- |
| Evaluator or prospective user | [User manual](docs/USER-MANUAL.md) | What the local shell and active studios do today |
| Product or architecture reader | [Whitepaper](docs/WHITEPAPER.md) | Ownership, boundaries, and the local-first model |
| Transition implementer | [Platform transition](docs/PLATFORM-TRANSITION.md) | Ordered scope, ownership changes, risks, and acceptance gates |
| Contributor or operator | [Developer guide](docs/DEVELOPER-GUIDE.md) | Setup, commands, and guarded Hermes activation |
| Status reviewer | [Status](docs/STATUS.md) | Implemented, tested, deferred, and unverified claims |
| Evidence reviewer | [Verification index](docs/verification/README.md) | Current H1 evidence and dated historical reports |

The default product experience uses deterministic fake inference. The direct
Hermes verification does not make a remote Pantheon or Frige workflow live.

Interface work follows [the design doctrine](docs/DESIGN-SYSTEM.md) and
[the interface charter](packages/design-system/AGENTS.md); artwork and media
follow [the asset book](assets/README.md).

See [MONOREPO.md](MONOREPO.md), [AGENTS.md](AGENTS.md),
[the developer guide](docs/DEVELOPER-GUIDE.md), and
[implementation status](docs/STATUS.md).
