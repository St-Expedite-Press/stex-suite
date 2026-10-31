# STEX inference service

The local inference gateway is the only STEX process permitted to reach the
private Hermes director. It never exposes that director's URL or internal key
to a browser or product server. OpenRouter remains behind Hermes; TexGraph
does not call it directly.

## Run locally

Configure `SCREENLAB_ORCHESTRATOR_URL`, `SCREENLAB_ORCHESTRATOR_KEY`, and a
long `STEX_INFERENCE_SHARED_SECRET` in the ignored root `.env`, then run:

```powershell
corepack pnpm dev:inference
```

The gateway binds to `STEX_INFERENCE_HOST:STEX_INFERENCE_PORT` (loopback by
default). `GET /health` is safe and does not call a provider. It reports
whether the Hermes bridge is configured, without exposing its address or key.

## Contracts

Every `/v1` call requires the private `X-STEX-Inference-Token` header.

- `POST /v1/texgraph/interview-turn` accepts bounded interview turns and
  project context, returning commentary plus an optional draft settings ticket.
- `POST /v1/texgraph/page-turn` accepts bounded page context and returns
  commentary plus either a complete proposed source revision or `noChange`.

The gateway authenticates callers, bounds source/context, polls the private
asynchronous director, and rejects malformed structured replies. Its tests use
a fake Hermes transport; starting it or querying `/health` never spends tokens.
