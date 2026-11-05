# STEX Pantheon A0 baseline

**Captured:** 2026-11-04 (America/Chicago)
**STEX checkout:** `cd20562f34d9dc0607f4e3c235812fe12bb797c6` on
`feat/hermes-conversation-parts`
**Working tree at capture:** modified `AGENTS.md`; untracked
`burn_after_reading.md`. These user changes were preserved.

## Source references

- STEX remote: `https://github.com/St-Expedite-Press/stex-suite.git`.
- Agent Studio behavioral reference:
  `https://github.com/St-Expedite-Press/agent-studio.git` at
  `94ba5cc799cf40f9223fd3b1cc2bef32adc0ed2e`. It was inspected from a
  read-only shallow clone outside this monorepo. Its FastAPI, cloud persistence,
  provider, and private orchestration code are not imported.
- One open draft PR was observed: `#1`, evidence-first documentation director.

## Toolchain and baseline tests

| Tool | Observed version |
| --- | --- |
| Node | `v24.18.0` |
| pnpm | `9.15.9` |
| Git | `2.55.0.windows.2` |
| LuaHBTeX / MiKTeX | `1.24.0` / `25.12` |
| Python | `3.12.10` |

| Command | Result |
| --- | --- |
| `corepack pnpm --dir apps/lab test` | 2 passed, 0 failed |
| `corepack pnpm --dir apps/texgraph test` | 38 passed, 0 failed; includes LuaLaTeX proof/preflight cases |
| `corepack pnpm --dir services/inference test` | 14 passed, 0 failed |

No provider request was made. Lab (`/`), TexGraph (`/api/health`), and inference
(`/health`) were independently started on temporary loopback ports and returned
HTTP 200; every probe process was stopped immediately.

## Reconciliation findings

- The suite exposes three names/routes (ScreenLab, TexGraph, NovelGraph); A0
  requires four Pantheon identities and Frige/Seaxneat routes.
- Lab redirects from a TexGraph lobby to a separate process; it is not a shared
  application shell. No Seaxneat implementation exists.
- TexGraph is working Node/vanilla JavaScript with protected manuscripts and
  compiler-backed tests. The inference service is TexGraph-specific and
  OpenRouter-oriented; no generic remote-Hermes contract exists.
- The vault protocol is optional/noncanonical, while root prose called it
  user-wide/shared. The pre-A0 root `AGENTS.md` was a Python wrapper that wrote
  a different path rather than a direct Markdown authority file.

The checkout is under OneDrive. No corruption was observed, but A0 state and
fixtures must remain ignored/disposable. Remote Hermes, paid inference,
deployment, and Eostre/Woden workflows remain excluded and unverified.
