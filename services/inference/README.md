# STEX inference service

This is STEX's server-side boundary for the versioned Hermes client. The
default transport is deterministic and makes no network call. In `remote`
mode it calls an authenticated, loopback upstream Hermes API; Hermes, not
STEX, owns the OpenRouter credential and selected provider model.

Run locally with `corepack pnpm dev:inference`. Configure only as needed:

| Variable | Purpose |
| --- | --- |
| `STEX_INFERENCE_SHARED_SECRET` | Token required by product servers. |
| `STEX_HERMES_TRANSPORT` | `fake` (default) or `remote`. |
| `STEX_HERMES_URL`, `STEX_HERMES_API_KEY` | Loopback Hermes base URL and its `API_SERVER_KEY`; server-only. `STEX_HERMES_TOKEN` is a temporary migration fallback. |
| `STEX_HERMES_API_MODE` | `chat-completions` (default) or `responses`. |
| `STEX_HERMES_MODEL` | OpenAI-compatible gateway model name (normally `hermes-agent`). Hermes's own model selection chooses the OpenRouter model. |
| `STEX_HERMES_ISOLATION`, `STEX_HERMES_TOOL_POLICY` | Must be `verified` and `conversational-only` before a remote turn is allowed. They are explicit operator acknowledgements, not an operating-system sandbox. |
| `STEX_HERMES_MAX_CONTEXT_CHARS`, `STEX_HERMES_MAX_OUTPUT_CHARS`, `STEX_HERMES_MAX_TIMEOUT_SECONDS`, `STEX_HERMES_MAX_CONCURRENT_TURNS` | Per-turn and local concurrency upper bounds (one live turn by default). |

`GET /v1/hermes/health` and authenticated `POST /v1/hermes/turn` implement
[`stex.hermes.turn.v1`](../../protocol/hermes/README.md). Failures are
classified as validation, authentication, unavailable, timeout, cancellation,
or malformed-response failures.

The existing Frige v3 compatibility endpoints remain adapters for historical
TexGraph callers:
`/v1/texgraph/interview-turn`, `/page-turn`, and `/scope-turn` convert their
request into `stex.hermes.turn.v1` and return a no-change v3-shaped response.
They do not contact a provider or expose credentials. The retired provider
roster endpoints return `410 Gone`.

## Upstream Hermes adapter

`stex.hermes.turn.v1` remains the stable product contract. The adapter sends a
bounded system envelope plus the STEX conversation to upstream
`POST /v1/chat/completions` (or the opt-in `/v1/responses` mode), using the
upstream API key only in this process. It uses an opaque, product-scoped
`X-Hermes-Session-Id` and the STEX request id as `Idempotency-Key`; Frige book
and scope ids are never sent verbatim in those headers. Chat responses and
Responses output are translated back to ordered v1 events. Token usage is
preserved when Hermes reports it.

The adapter asks for no client-declared tools (`tools: []`,
`tool_choice: none`), but upstream Hermes itself can expose powerful built-in
tools. STEX therefore fails closed unless the operator explicitly acknowledges
an independently verified OS/container boundary and declares a
conversational-only policy. Neither the acknowledgement, a prompt, nor those
request fields is a tool-security boundary.

`GET /v1/hermes/health?probe=1` performs an authenticated, non-turn probe of
the upstream API when remote mode is safely configured. It reports configured,
unreachable, unavailable, or key-rejected state; it does not prove a
provider-backed completion. The probe needs the STEX shared token, so an
unauthenticated local page cannot drive repeated upstream checks. Starting the service and all repository tests make
no paid calls. Direct runtime and paid provider verification remain explicitly
authorized operations.
