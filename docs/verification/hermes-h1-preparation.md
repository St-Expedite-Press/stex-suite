# H1 Hermes / Igor preparation report

**Status:** PARTIAL — the repository unit, local Igor-only runtime boundary,
and STEX adapter are complete and locally verified. One bounded, authorized
OpenRouter completion has returned successfully; full H1 acceptance remains
incomplete.

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
Igor's `.env`, and all Igor toolsets are disabled on both the CLI and
`api_server` platforms. Its configured Docker terminal has no environment
forwarding, host mounts, or container network, but it was not invoked because
no toolset is enabled. The required `nousresearch/hermes-sandbox:desktop`
image is pre-pulled locally; it starts successfully with no network or host
mount.

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
- The upstream API gateway was started manually for Igor only on
  `127.0.0.1:8642`. An invalid bearer key received HTTP 401; the matching STEX
  API credential retrieved local `/v1/models` metadata. Neither test sends a
  completion request or proves provider availability. It was stopped after the
  bounded direct verification attempts.
- Initial provider attempts exposed an upstream configuration distinction:
  empty CLI toolsets did not disable the `api_server` platform's toolsets. The
  request was interrupted before it completed. H1 now disables and reconciles
  both platforms, and a second 16-token, 15-second request ran with no enabled
  toolsets. It also timed out before returning a completion or usage record and
  was forcibly cancelled. Investigation found Docker Desktop's WSL distribution
  stopped and the required sandbox image absent. After Docker Desktop/WSL was
  restarted and the image pulled, a final 16-token request completed with
  `STEX-H1-OK`; the gateway was then stopped.

## Evidence run

| Command | Result |
| --- | --- |
| `node --check services/inference/src/hermes-client.mjs` | Passed |
| `node --check services/inference/server.mjs` | Passed |
| `corepack pnpm --dir services/inference test` | Passed: 20 tests, including Chat Completions, Responses, loopback-only credentials, tool-denial request shape, scope/session isolation, no-bill cancellation, concurrency cap, error mapping, and fake transport |
| `corepack pnpm --dir apps/pantheon test` | Passed: 12 tests |
| `corepack pnpm --dir apps/frige test` | Passed: 44 tests |
| `corepack pnpm run test:hermes` | Passed: 7 tests, including one-active-profile, profile-specification alignment, and fail-closed CLI/API-server reconciliation cases |
| `corepack pnpm run check:hermes-runtime` | Passed: all eight expected local profiles observed; default plus all profiles pinned to OpenRouter; CLI and API-server toolsets empty; read-only |
| `hermes -p igor gateway status` | Passed before direct verification: running standalone gateway, Igor only; default and seven specialists unserved |
| Local `GET /v1/models` checks | Invalid API credential rejected (401); matching credential returned local metadata; no completion submitted |
| Authorized direct `POST /v1/chat/completions` | First two bounded attempts were cancelled/time-limited while Docker was unhealthy. After repair, a no-tool 16-token request returned `STEX-H1-OK` in 11.5 seconds with 4,503 prompt tokens, 7 completion tokens, and `finish_reason: stop`; gateway stopped afterward. |

All adapter tests use stubs. One provider-backed direct completion succeeded,
but pricing/cost, a full Pantheon live conversation, and a Frige live scoped
conversation remain unverified. The configured OpenRouter model is
`openai/gpt-4.1-mini`; the successful gateway response reported 4,510 total
tokens. No monetary cost was returned by the response, so this report does not
claim an exact spend.

## Required live-activation gate

Before calling this H1 COMPLETE, run and record multi-turn, invalid-model,
timeout, and tool-negative tests; record actual model and cost; and run
Pantheon and Frige end-to-end using disposable data. Any additional paid turn
requires an explicit authorization and budget.
