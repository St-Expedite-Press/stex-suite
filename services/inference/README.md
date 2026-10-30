# STEX inference service

The local inference gateway is the only STEX process that reads
`OPENROUTER_API_KEY`. Browser code and product servers receive neither that
credential nor an OpenRouter URL.

## Run locally

Configure `OPENROUTER_MODEL`, `OPENROUTER_API_KEY`, and a long
`STEX_INFERENCE_SHARED_SECRET` in the ignored root `.env`, then run:

```powershell
corepack pnpm dev:inference
```

The gateway binds to `STEX_INFERENCE_HOST:STEX_INFERENCE_PORT` (loopback by
default). `GET /health` is safe and does not call a provider. It reports
whether a model and provider key are configured, without exposing either.

## Contracts

Every `/v1` call requires the private `X-STEX-Inference-Token` header.

- `POST /v1/texgraph/interview-turn` accepts bounded interview turns and
  project context, returning commentary plus an optional draft settings ticket.
- `POST /v1/texgraph/page-turn` accepts bounded page context and returns
  commentary plus either a complete proposed source revision or `noChange`.

The gateway authenticates callers, bounds input and output, enforces provider
timeouts, and rejects malformed structured model responses. Its tests use a
fake provider; starting it or querying `/health` never spends provider tokens.
