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
| Hermes | `hermes`, `services/inference` | Declarative roster; fake/remote boundary |
| User Graph | `vault`, `services/knowledge` | Optional portable vault; read-only adapter |

## Local development

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm test
corepack pnpm dev:alpha
```

Open `http://127.0.0.1:4300/`. Pantheon proxies Frige at `/frige/` and
Seaxneat at `/seaxneat/`; `/texgraph/` remains an explicit Frige compatibility
redirect. The fake Hermes transport is deterministic and makes no provider
request.

Use `corepack pnpm dev:pantheon`, `dev:frige`, or `dev:seaxneat` for an
individual active application. The temporary `dev:lab` and `dev:texgraph`
aliases remain for existing automation. Canonical settings use `STEX_PANTHEON_*`
and `STEX_FRIGE_*`; a legacy setting is a fallback only.

Frige manuscripts are protected source. Never use a real manuscript as a test
fixture. Seaxneat state is ignored local data. The User Graph is optional
knowledge, never application state, Hermes memory, or credentials.

See [MONOREPO.md](MONOREPO.md), [AGENTS.md](AGENTS.md),
[the developer guide](docs/DEVELOPER-GUIDE.md), and
[implementation status](docs/STATUS.md).
