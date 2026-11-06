# Runtime charter

**Scope:** `runtime/`, including the `hermes-agent` Git submodule.

This directory packages upstream Hermes Agent as a suite unit. It is not STEX
application code, a provider client, a credential store, or a place to develop
new Hermes features. Read the root `AGENTS.md`, this charter, and
[`README.md`](README.md) before changing anything here.

## Current H1 record

- `hermes-agent/` is pinned source, currently at
  `e76fbd80be65ea5c1b89831f8d7aaedb713f5cac`. It is an upstream submodule, not
  a vendored implementation.
- STEX's source-controlled roster, profile mapping, tests, and reconciliation
  command live in `../hermes/`; the product-facing contract and adapter live in
  `../services/inference/`.
- The local H1 runtime is an Igor-only, loopback gateway. It has one verified
  direct, tool-free provider turn, but Pantheon and Frige remain on the fake
  transport and their remote workflows are not accepted.
- Installed runtime profile settings, provider keys, API keys, sessions, logs,
  caches, Docker state, and sandbox files remain ignored local state outside
  this repository. The source-controlled profile manifest remains in
  `../hermes/runtime-profiles.json`.

## Change rules

- Do not edit files inside `hermes-agent/`. Updating the submodule pointer is
  an upstream-runtime upgrade and needs explicit authorization, pinned revision
  evidence, compatibility review, and updated documentation.
- Do not copy upstream code into STEX, vendor Python environments, or commit
  runtime-generated artifacts. Never add `.env` files, provider keys, gateway
  traces, session content, logs, or Docker state.
- Do not give applications a provider key or a provider endpoint. Browser and
  product traffic reaches Hermes only through `services/inference` and
  `stex.hermes.turn.v1`.
- Keep Igor toolsets empty on both the CLI and API-server platforms. The Docker
  terminal boundary has no forwarded secrets, host mounts, or network egress;
  altering that policy requires an explicitly authorised milestone and fresh
  security evidence.
- Remote/provider calls, model changes, Docker pulls that materially change the
  runtime, and gateway start/stop actions are operational work. Require the
  authorization, bounded budget, and evidence stated in the root charter.

## Verification and documentation

- Run `corepack pnpm run test:hermes` for checked-in configuration.
- Run `corepack pnpm run check:hermes-runtime` only to inspect the local
  profile catalog, provider selections, and tool-policy state; it must remain
  read-only and never print credential values.
- Keep [`README.md`](README.md), `../docs/STATUS.md`, and
  `../docs/verification/hermes-h1-preparation.md` honest about the difference
  between a direct runtime check and a product integration acceptance.
