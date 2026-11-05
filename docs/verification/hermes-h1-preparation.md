# H1 Hermes / Igor preparation report

**Status:** PARTIAL — the repository unit, local Igor-only runtime boundary,
and STEX adapter are complete and locally verified. No provider-backed Hermes
or OpenRouter completion was authorized or made.

## Recorded runtime source

The suite packages upstream NousResearch/hermes-agent as the
`runtime/hermes-agent` Git submodule, pinned to
`e76fbd80be65ea5c1b89831f8d7aaedb713f5cac` (2026-11-05 upstream commit).
The submodule is initialized with `git submodule update --init --recursive`.
The upstream native-Windows runtime is installed outside the suite at
`%LOCALAPPDATA%\hermes`; the observed CLI is Hermes Agent v0.23.0 (stable,
local revision `2bd378ed1b8d6bf2192cb26e0a55ff3091e6bd19`). The installed
runtime revision is local evidence only; it does not alter the suite's pinned
source submodule.

`hermes/runtime-profiles.json` maps the complete STEX roster to eight named
runtime profiles. `igor` is the sole active profile, maps to
`pantheon-director`, and runs as a standalone compatibility gateway; the other
seven profiles are parked. The ignored OpenRouter credential is scoped to
Igor's `.env`, and all Igor toolsets are disabled. Its configured Docker
terminal has no environment forwarding, host mounts, or container network,
but it was not invoked because no toolset is enabled.

## Implemented boundary

- `services/inference` preserves `stex.hermes.turn.v1` and translates a
  validated request to authenticated upstream Chat Completions by default or
  Responses when explicitly selected.
- The adapter passes an opaque, product-scoped `X-Hermes-Session-Id`, uses
  the STEX correlation id as `Idempotency-Key`, translates usage where
  available, and classifies authentication, timeout, cancellation,
  unavailability, and malformed-reply failures.
- `tools: []` and `tool_choice: none` are sent as defense in depth. Remote
  turns are refused until `STEX_HERMES_ISOLATION=verified` and
  `STEX_HERMES_TOOL_POLICY=conversational-only` are explicit operator
  acknowledgements. Those flags do not themselves enforce an operating-system
  sandbox. Remote credentials are accepted only for an HTTP loopback URL;
  cancellation is resolved before upstream submission; and STEX caps live
  remote turns at one by default.
- Pantheon now sends a local persistent conversation id; Frige retains its
  existing book/section/piece records and passes only the selected scope to
  the adapter. No proposal is automatically applied to canonical source.
- The upstream API gateway is running manually for Igor only on
  `127.0.0.1:8642`. An invalid bearer key received HTTP 401; the matching STEX
  API credential retrieved local `/v1/models` metadata. Neither test sends a
  completion request or proves provider availability.

## Evidence run

| Command | Result |
| --- | --- |
| `node --check services/inference/src/hermes-client.mjs` | Passed |
| `node --check services/inference/server.mjs` | Passed |
| `corepack pnpm --dir services/inference test` | Passed: 20 tests, including Chat Completions, Responses, loopback-only credentials, tool-denial request shape, scope/session isolation, no-bill cancellation, concurrency cap, error mapping, and fake transport |
| `corepack pnpm --dir apps/pantheon test` | Passed: 12 tests |
| `corepack pnpm --dir apps/frige test` | Passed: 44 tests |
| `corepack pnpm run test:hermes` | Passed: 6 tests, including one-active-profile, profile-specification alignment, and reconciliation failure cases |
| `corepack pnpm run check:hermes-runtime` | Passed: all eight expected local profiles observed and default plus all profiles pinned to OpenRouter; read-only |
| `hermes -p igor gateway status` | Passed: running standalone gateway, Igor only; default and seven specialists unserved |
| Local `GET /v1/models` checks | Invalid API credential rejected (401); matching credential returned local metadata; no completion submitted |

All adapter tests use stubs. No provider-backed completion, pricing, token
usage, full Pantheon live conversation, or Frige live scoped conversation was
exercised. The configured OpenRouter model is `openai/gpt-4.1-mini`, but its
availability and cost are intentionally unverified because no provider request
was sent.

## Required live-activation gate

Before calling this H1 COMPLETE, an operator must authorize a maximum paid-test
budget and provider calls, then run direct authenticated positive, multi-turn,
invalid-model, timeout, and tool-negative tests; record actual model, usage,
and cost; and run Pantheon and Frige end-to-end using disposable data. Each
paid turn requires that explicit authorization.
