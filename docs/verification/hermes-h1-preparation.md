# H1 Hermes / Igor preparation report

**Status:** PARTIAL — the repository unit and the STEX adapter are complete
and stub-verified; no live Hermes or OpenRouter call was authorized or made.

## Recorded runtime source

The suite packages upstream NousResearch/hermes-agent as the
`runtime/hermes-agent` Git submodule, pinned to
`e76fbd80be65ea5c1b89831f8d7aaedb713f5cac` (2026-11-05 upstream commit).
The submodule is initialized with `git submodule update --init --recursive`.
The upstream source's supported native-Windows installer was invoked for
investigation, but the CLI did not become available in this acceptance window;
therefore this report does **not** claim a completed local runtime install,
gateway start, or direct API response.

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

## Evidence run

| Command | Result |
| --- | --- |
| `node --check services/inference/src/hermes-client.mjs` | Passed |
| `node --check services/inference/server.mjs` | Passed |
| `corepack pnpm --dir services/inference test` | Passed: 20 tests, including Chat Completions, Responses, loopback-only credentials, tool-denial request shape, scope/session isolation, no-bill cancellation, concurrency cap, error mapping, and fake transport |
| `corepack pnpm --dir apps/pantheon test` | Passed: 12 tests |
| `corepack pnpm --dir apps/frige test` | Passed: 44 tests |

All adapter tests use stubs; no provider credential, model, pricing, token
usage, direct Hermes HTTP response, full Pantheon live conversation, or Frige
live scoped conversation was exercised. The selected OpenRouter model is
therefore intentionally unrecorded and no cost was incurred.

## Required live-activation gate

Before calling this H1 COMPLETE, an operator must: establish a testable
least-privilege OS/container boundary; complete and record the upstream CLI
installation; configure OpenRouter and one model in the ignored upstream
Hermes environment; start loopback `hermes gateway`; run direct authenticated
positive, multi-turn, invalid-key, invalid-model, timeout, and tool-negative
tests; then run Pantheon and Frige end-to-end using disposable data. Each paid
turn requires explicit credential, budget, and authorization.
