# STEX Pantheon

STEX Pantheon is a local-first creative development monorepo. Pantheon is the
loopback shell; Frige and Seaxneat are active applications; Eostre and Woden
are registered, honestly deferred domains.

| Subsystem | Path | Status |
| --- | --- | --- |
| Pantheon | `apps/pantheon` | Active shell and local proxy |
| Frige | `apps/frige` | Active manuscripts, proofs, and preflight |
| Seaxneat | `apps/seaxneat` | Active website workspaces and revisions |
| Eostre / Woden | `apps/eostre`, `apps/woden` | Deferred, no simulated workflows |
| Design system | `packages/design-system`, `assets` | Shared CSS tokens, type, and brand marks; LFS asset library |
| Hermes | `hermes`, `services/inference` | Declarative roster; fake/remote boundary |
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

```powershell
corepack pnpm check:prereqs
corepack pnpm install --frozen-lockfile
corepack pnpm test
corepack pnpm dev:alpha
```

Open `http://127.0.0.1:4300/` for the splash; **Sign in** enters the command
center at `/home/` (a local single-user entry, not authentication). Pantheon
proxies Frige at `/frige/` and Seaxneat at `/seaxneat/`; `/texgraph/` remains
an explicit Frige compatibility redirect. The fake Hermes transport is deterministic and makes no provider
request.

Use `corepack pnpm dev:pantheon`, `dev:frige`, or `dev:seaxneat` for an
individual active application. The temporary `dev:lab` and `dev:texgraph`
aliases remain for existing automation. Canonical settings use `STEX_PANTHEON_*`
and `STEX_FRIGE_*`; a legacy setting is a fallback only.

Frige manuscripts are protected source. Never use a real manuscript as a test
fixture. Seaxneat state is ignored local data. The User Graph is optional
knowledge, never application state, Hermes memory, or credentials.

Interface work follows [the design doctrine](docs/DESIGN-SYSTEM.md) and
[the interface charter](packages/design-system/AGENTS.md); artwork and media
follow [the asset book](assets/README.md).

See [MONOREPO.md](MONOREPO.md), [AGENTS.md](AGENTS.md),
[the developer guide](docs/DEVELOPER-GUIDE.md), and
[implementation status](docs/STATUS.md).
