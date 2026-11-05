# STEX inference service

This is STEX's server-side boundary for the versioned Hermes client. It does
not contact OpenRouter or any provider. The default transport is deterministic
and makes no network call; remote Hermes is optional and its URL and bearer
token remain in this process only.

Run locally with `corepack pnpm dev:inference`. Configure only as needed:

| Variable | Purpose |
| --- | --- |
| `STEX_INFERENCE_SHARED_SECRET` | Token required by product servers. |
| `STEX_HERMES_TRANSPORT` | `fake` (default) or `remote`. |
| `STEX_HERMES_URL`, `STEX_HERMES_TOKEN` | Server-only remote Hermes settings. |
| `STEX_HERMES_MAX_CONTEXT_CHARS`, `STEX_HERMES_MAX_OUTPUT_CHARS`, `STEX_HERMES_MAX_TIMEOUT_SECONDS` | Per-turn upper bounds. |

`GET /v1/hermes/health` and authenticated `POST /v1/hermes/turn` implement
[`stex.hermes.turn.v1`](../../protocol/hermes/README.md). Failures are
classified as validation, authentication, unavailable, timeout, cancellation,
or malformed-response failures.

The existing TexGraph v3 endpoints remain only as compatibility adapters:
`/v1/texgraph/interview-turn`, `/page-turn`, and `/scope-turn` convert their
request into `stex.hermes.turn.v1` and return a no-change v3-shaped response.
They do not contact a provider or expose credentials. The retired provider
roster endpoints return `410 Gone`.

Remote Hermes is intentionally unverified in A0. Starting the service and
running its tests make no paid calls.
