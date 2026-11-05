# STEX Pantheon Alpha

STEX is a local-first suite of independently owned creative applications. Alpha
A0 provides two active workflows under one local shell:

- **Frige** (`apps/texgraph`) — protected manuscript editing, LuaLaTeX proofs,
  preflight, and review-gated proposals. TexGraph paths remain supported as a
  compatibility surface.
- **Seaxneat** (`apps/seaxneat`) — isolated Next.js website workspaces with a
  deterministic edit simulator, validated builds, Git revisions, and restore.

The shell also registers **Eostre** and **Woden**, but neither is implemented
in A0. Applications do not share operational storage. The optional Obsidian
vault is user knowledge, not a database or credential store.

## Run locally

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm test
corepack pnpm dev:alpha
```

Open `http://127.0.0.1:4300/`. The shell proxies Frige at `/frige/` and
Seaxneat at `/seaxneat/`; it starts loopback-only supporting processes. Press
`Ctrl+C` in the terminal to stop them.

Frige’s standalone command remains `corepack pnpm dev:texgraph`. Seaxneat
state defaults to ignored `apps/seaxneat/.local-data/` and may be relocated with
`STEX_SEAXNEAT_DATA_DIR`.

## Manual A0 acceptance

1. In Frige, choose an existing local book or create a new local book project
   from `/frige/`, then edit a source node, compile a proof, open the PDF, and
   inspect current/preflight status. Never use a protected real manuscript as
   a test fixture.
2. In Seaxneat, create a project, start its local preview, request a bounded
   heading edit, review/apply it, confirm preview/diff changes, then restore a
   validated revision.
3. Open Eostre and Woden only to confirm their honest deferred state.

## Hermes and limits

`services/inference` exposes versioned `stex.hermes.turn.v1` fake and remote
transports. A0 defaults to a deterministic fake; remote Hermes requires
server-side `STEX_HERMES_URL` and `STEX_HERMES_TOKEN`. No real Hermes request,
provider call, deployment, or paid workload is part of A0 verification.

See [MONOREPO.md](MONOREPO.md), [the protocol contracts](protocol/README.md),
the [baseline evidence](docs/verification/alpha-baseline.md), and the
[acceptance report](docs/verification/alpha-report.md).
