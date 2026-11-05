# Pantheon consolidation verification

**Base revision:** `264630a` on `main`  
**Captured:** 2026-11-05 (America/Chicago)

## Delivered

- Canonical tracked application paths are `apps/pantheon`, `apps/frige`,
  `apps/seaxneat`, `apps/eostre`, and `apps/woden`.
- Canonical package names and commands are `@stex/pantheon`, `@stex/frige`,
  `dev:pantheon`, `dev:frige`, `test:pantheon`, and `test:frige`. Legacy
  commands, the `/texgraph/` route, legacy inference endpoints, and legacy
  environment settings remain explicit compatibility surfaces.
- Frige accepts canonical `STEX_FRIGE_*` settings before `TEXGRAPH_*` and
  retains existing ignored legacy local data without moving it. The tracked
  manuscript `Programme.md` hash matches its pre-migration `HEAD` object.
- `hermes/` supplies one validated roster with 18 bounded roles and eight
  profiles. It is declarative configuration, not a vendored runtime.
- `vault/` is an Obsidian-openable User Graph. `services/knowledge` is a
  read-only, disabled-by-default local adapter.

## Verification

| Check | Result |
| --- | --- |
| `corepack pnpm install --frozen-lockfile` | Passed |
| `corepack pnpm run test:pantheon` | 5 passed |
| `corepack pnpm run test:frige` | 42 passed, including LuaLaTeX proofs and preflight |
| `corepack pnpm run test:inference` | 18 passed |
| `corepack pnpm run test:seaxneat` | 8 passed |
| `corepack pnpm run build:seaxneat` | Passed |
| `corepack pnpm run test:hermes` | 2 passed |
| `corepack pnpm run test:knowledge` | 2 passed |
| static `node --check` for changed servers/modules | Passed |
| `git diff --check` | Passed |

## Limits

Default loopback ports were already occupied by unrelated local Node services.
An isolated launcher logged all four new processes as ready, but this
environment could not complete a browser/HTTP probe against that background
job before automatic tool teardown. Route behavior is covered by the Pantheon
server suite, but a fresh manual browser acceptance run remains required.

No remote Hermes request, provider call, deployment, paid workload, vault
write, or real Eostre/Woden workflow was performed. Multiagent execution is
not implemented; a roster does not grant tool authority.
