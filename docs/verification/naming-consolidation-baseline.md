# Pantheon consolidation baseline

**Captured:** 2026-11-04 (America/Chicago)  
**Base revision:** `264630a` on `main`  
**Working tree:** clean before this record was created.

## Scope and boundaries

The requested C-03 consolidation uses the canonical Pantheon identities:
Pantheon, Frige, Seaxneat, Eostre, and Woden. The checkout already exposes
those identities in the application registry and active shell routes, while
source directories and package names still retain several compatibility-era
names.

Tracked Frige manuscripts live below `apps/texgraph/books/*/manuscript/` and
were neither read as test fixtures nor modified for this baseline. Ignored
local state includes Frige book sidecars, the Pantheon shell's local projects,
Seaxneat workspaces, and inference state. No credentials were inspected or
recorded.

`services/inference` is the sole product-facing Hermes boundary. Its default
transport is deterministic and local. No remote Hermes, provider, vault, or
deployment action was performed.

## Observed source layout

| Current path | Current identity | Consolidation destination | Notes |
| --- | --- | --- | --- |
| `apps/lab` | Lab shell | `apps/pantheon` | Shell has an ignored local-project root. |
| `apps/texgraph` | Frige / TexGraph compatibility | `apps/frige` | Contains protected, tracked manuscripts. |
| `apps/seaxneat` | Seaxneat | unchanged | Canonical already. |
| `apps/screenlab` | deferred ScreenLab | `apps/eostre` | README-only deferred application. |
| `apps/novelgraph` | deferred NovelGraph | `apps/woden` | README-only deferred application. |
| `services/inference` | Hermes client boundary | unchanged | Contract-compatible fake and remote transports. |

No in-repository Hermes runtime or User Graph directory exists at baseline.
The versioned vault contract describes an optional, user-selected folder.

## Deterministic checks

| Command | Result |
| --- | --- |
| `corepack pnpm test` | Passed: Lab 5, Frige 42 (including LuaLaTeX proof cases), inference 18, Seaxneat 8. |
| `corepack pnpm run build:seaxneat` | Passed: Vite production build. |

The test suite uses synthetic or temporary fixtures; it does not establish
that a user manuscript or remote Hermes host is ready for production.

## Consolidation risks and gates

- Frige's directory move must retain byte-identical protected manuscript
  sources and an explicit legacy configuration fallback.
- Existing `texgraph` route and inference endpoints are public compatibility
  surfaces; they remain aliases, not a protocol rewrite.
- No real Hermes runtime is installed or invoked without an independently
  verifiable, authorized runtime source. The initial `hermes/` subtree is
  configuration and validation only.
- The initial `vault/` subtree is portable, optional user knowledge and does
  not grant applications direct filesystem access or become operational state.
