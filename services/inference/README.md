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

## Local development against the private director

The deployed private relay runs on `stex-inference-01` as
`screenlab-orchestrator-proxy.service`. It binds only to VM loopback and uses
the VM service account to reach the internal Cloud Run director. Keep the
relay private; use an IAP-backed SSH forward from the development machine:

```powershell
gcloud compute ssh stex-inference-01 --project central-nerve-machine --zone us-central1-a --tunnel-through-iap --ssh-flag="-N" --ssh-flag="-L 127.0.0.1:8200:127.0.0.1:8100"
```

Set `SCREENLAB_ORCHESTRATOR_URL=http://127.0.0.1:8200` in the ignored root
`.env`, then restart the local inference service. The relay deployment files
in `deploy/` are intentionally fixed to this one private Cloud Run upstream.
