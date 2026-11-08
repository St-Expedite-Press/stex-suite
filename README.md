# STEX Pantheon

STEX Pantheon is a local-first creative computing platform with modular
capability engines. Pantheon owns the common web environment; Frige owns
publishing state, Seaxneat owns website workspaces, and Igor supplies the
Hermes-derived intelligence layer. Ēostre and Woden remain deferred.

The [platform transition plan](docs/PLATFORM-TRANSITION.md) distinguishes the
destination from implementation. Seaxneat and Frige have platform-owned
workspaces, and Pantheon composes Igor's private renderer through a versioned
HTTP interface. Igor can receive explicitly previewed, revision-pinned project
sources. Optional knowledge projections retain source provenance, user
assertions, and reviewable inferences. Embeddings, multimodal retrieval,
runtime engine tools, and vault integration remain outside this implementation.

Python/FastAPI with typed contracts is the required destination for STEX-owned
application backends; existing Node servers remain transitional. Milestone M1
adds the Python platform API in `backend/` beside them (health and a read-only
merged project list); no Node route has moved yet. Obsidian is the required
direct human-facing knowledge integration. Both continue under the
[migration plan](docs/PLATFORM-TRANSITION.md#python-backend-migration) and
[Obsidian gate](docs/PLATFORM-TRANSITION.md#direct-obsidian-integration).

| Subsystem | Path | Status |
| --- | --- | --- |
| Pantheon | `apps/pantheon` | Common shell, composed Seaxneat workspace, local proxy |
| Platform API | `backend/` (Python/FastAPI) | M1 foundation: `/health` and read-only `stex.platform.projects.v1`; not yet routed through Pantheon |
| Frige | `apps/frige`; UI in `apps/pantheon/workspaces/frige` | Engine-owned manuscripts/proofs and platform-owned publishing workspace |
| Seaxneat | `apps/seaxneat`; UI in `apps/pantheon/workspaces/seaxneat` | Active engine and platform-owned website workspace |
| Igor | `stex-igor/apps/igor` | Composed Director conversations and approved project context; fake transport by default |
| Eostre / Woden | `apps/eostre`, `apps/woden` | Deferred, no simulated workflows |
| Design system | `packages/design-system`, `assets` | Shared CSS tokens, type, and brand marks; LFS asset library |
| Hermes | `stex-igor/runtime/hermes-agent`, `stex-igor/hermes`, `stex-igor/services/inference` | Pinned upstream source, eight native profile specifications, 12 reusable skill procedures and fake/upstream API boundary |
| User Graph | `services/knowledge`; optional `vault` | Opt-in metadata projections; separate read-only vault adapter remains unexposed |

## Prerequisites

JavaScript dependencies are declared in each workspace's `package.json` and
pinned in `pnpm-lock.yaml`. The Python platform API's dependencies are declared
in `pyproject.toml` and pinned in `uv.lock`; uv installs the Python version
named in `.python-version` (3.12) when it is missing. System tools are
installed separately:

| Tool | Need | Used by |
| --- | --- | --- |
| Node.js 22.13+ (22 or 24 LTS) | Required | Everything. Node 25+ no longer bundles Corepack, which the Windows launchers call directly. |
| Corepack with pnpm 9.15.9 | Required | Bundled with Node 22–24; `packageManager` selects pnpm. |
| uv 0.11+ | Required | Python platform API (`test:platform`, `dev:platform`); `uv sync --frozen` creates the ignored `.venv`. |
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
renders Frige at `/frige/`, proxying its versioned engine API;
`/seaxneat/` redirects to the platform-owned
`/workspaces/seaxneat/`, whose API calls reach the Seaxneat engine through
the proxy. `/texgraph/` remains
an explicit Frige compatibility redirect. The fake Hermes transport is deterministic and makes no provider
request.

Igor at `/igor/` shares Pantheon's navigation. A project's Igor link opens
source selection: preview the exact text and approve it before
sending. Changing or withdrawing context starts a fresh reasoning context;
earlier conversation records remain visible.

The **Graph** page is disabled by default. To enable its local metadata journal
from PowerShell at the repository root, run:

```powershell
$env:STEX_KNOWLEDGE_DATA_DIR = Join-Path (Get-Location) 'services/knowledge/.local-data'
corepack pnpm dev:alpha
```

Accept selected source revisions, record evidence-backed assertions or
inferences, correct or reject relationships, export knowledge, or erase the
journal. Graph acceptance stores metadata rather than source text. Sources
are checked with their engine before use; unavailable revisions stay labelled.
See the [user manual](docs/USER-MANUAL.md). Activity remains unimplemented.
These workflows are implemented and tested locally. The reviewed merge and
Igor release are in progress; [release evidence](docs/verification/platform-release.md)
records actual merge/deployment results when verified.

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

The checked-in [runtime profile manifest](stex-igor/hermes/runtime-profiles.json)
defines exactly eight native identities: `igor`, `architect`, `developer`,
`designer`, `artist`, `editor`, `knowledge`, and `auditor`. Igor handles the
ordinary user relationship; the seven specialists own coherent disciplines,
not application-specific roles. Twelve native `SKILL.md` files provide real
reusable procedures. Models can change independently of profile identity;
profile memory is expertise and references, not canonical project storage.
Run
`corepack pnpm run check:hermes-runtime` to read and reconcile the local
upstream profile catalog, model-provider selections, and empty CLI/API-server
tool policies; it changes nothing and never reads a credential.

Only Igor is conversation-enabled; the specialists and temporary workers stay
parked and toolsets stay empty. Native profile-targeted delegation can load
configuration at the pin, but delegated children start fresh and skip memory.
Full persistent-session specialist orchestration is not accepted. Skill source
and static configuration checks are separate from native execution proof, CI
release verification and production activation.

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
