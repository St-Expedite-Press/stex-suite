# STEX inference service

The inference gateway is the Hermes agent unit and the only STEX process that
talks to a model provider. It runs the Hermes director procedure for each
product turn on OpenRouter, validates the reply, and returns it to the product.
The OpenRouter key never leaves this process; products and browsers send turns
here with the shared secret and receive validated replies.

## Run locally

Set these in the ignored root `.env`, then run `corepack pnpm dev:inference`:

| Variable | Purpose |
| --- | --- |
| `STEX_INFERENCE_SHARED_SECRET` | Long random value shared with calling products |
| `OPENROUTER_API_KEY` | OpenRouter key (this service only) |
| `OPENROUTER_MODEL` | Director model used until a director stack is saved (see Model roster) |
| `OPENROUTER_BASE_URL` | Defaults to `https://openrouter.ai/api/v1` |
| `OPENROUTER_REQUEST_TIMEOUT_SECONDS`, `OPENROUTER_MAX_RETRIES` | Per-call timeout (default 90) and retries for 429, 502, 503 and refused connections (default 2) |
| `STEX_INFERENCE_MAX_INPUT_TOKENS`, `STEX_INFERENCE_MAX_OUTPUT_TOKENS` | Request size limit (estimated) and `max_tokens` |
| `OPENROUTER_SITE_URL`, `OPENROUTER_APP_NAME` | Attribution headers sent to OpenRouter |
| `STEX_INFERENCE_STATE_DIR` | Where `models.json` is kept; defaults to the ignored `services/inference/.state` |

The gateway binds to `STEX_INFERENCE_HOST:STEX_INFERENCE_PORT` (loopback by
default). `GET /health` reports the provider, the director's model stack and any
missing settings without contacting OpenRouter; `GET /health?probe=1` also
checks the key against OpenRouter's key endpoint, which costs nothing.

## Model roster

Each agent role has a model stack: an ordered list of OpenRouter model ids. A
role uses its first model; when OpenRouter refuses that model, its provider is
down, or it is rate limited, the next model is tried. Key, credit and timeout
failures end the turn instead, since another model would fail the same way.
Each role may also set a temperature (0–2) and an output cap, which never
exceeds `STEX_INFERENCE_MAX_OUTPUT_TOKENS`.

The built-in roles are the director (used today by every TexGraph turn) and
the general worker, visual worker and embedding roles, kept ready for when
those agents exist. Custom roles can be added; built-in roles cannot be
removed. Settings are saved to `models.json` in the state directory; they hold
model choices, never credentials. Until the director has a stack,
`OPENROUTER_MODEL` is used.

TexGraph edits the roster from Settings → Configure models.

## Contracts

Every `/v1` call requires the `X-STEX-Inference-Token` header.

- `POST /v1/texgraph/interview-turn` and `POST /v1/texgraph/page-turn` return
  commentary plus an optional proposal (v1 shapes).
- `POST /v1/texgraph/scope-turn` returns commentary, typed reply parts, and
  optional changes for offered nodes (see `protocol/texgraph`, scope turn v3).
  Its `meta` names the model that answered and, after a fallback, the models
  `skipped`.
- `GET /v1/settings/models` returns the roster, which roles are in use and the
  environment's director model. `PUT /v1/settings/models` replaces the roster;
  while OpenRouter's catalog is reachable, unknown model ids are refused
  (`INVALID_SETTINGS`, 400, with an `errors` list).
- `GET /v1/models/catalog` returns OpenRouter's public model list (id, name,
  context length, per-token prices, modalities), cached for ten minutes.

Failures return `{ "error", "code" }` with an HTTP status: `UNAUTHORIZED`
(401), `UNCONFIGURED` (503), `CONTEXT_TOO_LARGE` (413), `PROVIDER_AUTH` (502),
`PROVIDER_CREDITS` (402), `PROVIDER_RATE_LIMITED` (429), `PROVIDER_TIMEOUT`
(504), `PROVIDER_UNREACHABLE`, `PROVIDER_REJECTED`, `PROVIDER_UNAVAILABLE` and
`PROVIDER_MALFORMED` (502).

Tests use a fake OpenRouter transport; running them, starting the service,
calling `/health` or reading the catalog spends nothing. A real turn is a paid OpenRouter call.
