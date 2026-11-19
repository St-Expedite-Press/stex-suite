# Hermes turn contract v1

`stex.hermes.turn.v1` is the product-neutral, server-side contract for a turn
sent to a separately hosted Hermes service. It is not a provider contract and
does not grant Hermes filesystem, vault, shell, database, or canonical-state
authority.

The STEX inference service is the only application-facing client. Browsers
send requests to their product server; product servers call the authenticated
inference service; only that service may contact a remote Hermes host. The
default local transport is deterministic and never makes a network request.

## Request

The JSON request schema is in `schema.v1.json`; the response schema is in
`response.schema.v1.json`. A request has a stable `requestId`, a
lower-case product id, a bounded conversation, an operation (`conversation`,
`proposal`, `edit`, or `cancel`), untrusted structured context, and explicit
`budget.maxContextChars`, `budget.maxOutputChars`, and `budget.timeoutMs`.
The gateway refuses values above its local limits before choosing a transport.

## Response and failures

Responses repeat the contract and request id, return `completed` or
`cancelled`, ordered events (`message`, `proposal`, or `status`), and usage
metadata. The gateway rejects malformed, unordered, or over-budget replies.

`UNAUTHORIZED`, `INVALID_REQUEST`, `UNKNOWN_CONTRACT`, and
`CONTEXT_TOO_LARGE` are local validation results. Remote failures are
classified as `UNCONFIGURED`, `CANCELLED`, `HERMES_TIMEOUT`, `HERMES_AUTH`,
`HERMES_UNREACHABLE`, `HERMES_UNAVAILABLE`, `HERMES_MALFORMED`, or
`HERMES_OUTPUT_TOO_LARGE`. No error includes an authentication token.

The v1 contract does not replace TexGraph's versioned scope-turn contract.

## Agent configuration v1

`stex.hermes.agent-config.v1` ([schema](agent-config.v1.schema.json)) is
how the user configures the company: each of the eight native profiles'
persona, equipped skills and default model, and the model each task uses.
The STEX inference service owns it, on the hosted VM, and stores it under
`STEX_INFERENCE_STATE_DIR`. Product servers relay it with the shared secret
and report the signed-in principal as the actor. Browsers never call the
inference service. Pantheon reaches it only through Igor's same-origin
routes.

| Method | Path (inference service) | Purpose |
| --- | --- | --- |
| GET | `/v1/agent-config` | The configuration document, with its `revision` |
| PUT | `/v1/agent-config` | A partial update, or `reset: true`; must carry `baseRevision` |
| GET | `/v1/agent-config/catalog` | OpenRouter's public model list, filtered and cached (`stex.hermes.model-catalog.v1`) |
| GET | `/v1/agent-config/history` | Recent changes, newest first (`stex.hermes.agent-config-history.v1`) |

Rules:

- **Grok by default.** The default stack is `high` = `x-ai/grok-4.7`,
  `medium` = `x-ai/grok-4.3` and `long` = `x-ai/grok-4.20`, taken from
  OpenRouter's catalog on 2026-11-18. A profile's default model follows its
  specification's tier. The user may choose any catalog model for a task,
  except Anthropic and Claude models and routers that choose a model for
  themselves (the `openrouter/` vendor, an id or name containing `route`,
  `router` or `routing`, or `auto` as a word or `:auto` variant), since a
  router may pick Claude. The rule is deliberately broad. These are refused
  everywhere (`MODEL_REFUSED`), even if the catalog lists them.
- **Catalog.** The catalog comes from OpenRouter's public, keyless model
  list. It is refreshed at most every six hours and kept as a last good copy.
  If no copy exists, only the default stack is offered (`source: defaults`).
  A chosen model must be in the catalog and must report the task's
  `requires` capabilities (`MODEL_UNAVAILABLE`).
- **Fixed profiles.** The eight profile ids, their discipline, mission,
  runtime state and allowed skills are read-only. Configuration never adds,
  renames, activates or removes a profile, grants a toolset, or widens a
  budget. Equipped skills must be a subset of the allowed skills.
- **Personas never remove boundaries.** A persona's name, title, sigil,
  temperaments and voice are composed into the profile's persona text, and
  the fixed STEX boundaries are always appended after the voice.
- **Only the owner changes the company.** Any signed-in user may read it, but
  only the owner may save, because a save changes the persona and models used
  in every user's turns. The owner is the `owner`-role account in password
  mode, the email in `STEX_IGOR_COMPANY_OWNERS` (or the sole allow-listed
  email) in Access mode, and `local` locally. The product server enforces
  this (`403 COMPANY_READ_ONLY`) and reports `x-stex-actor-role`. The
  inference service also refuses any save that does not carry
  `x-stex-actor-role: owner`.
- **Optimistic concurrency.** Every update names `baseRevision`. A stale
  revision is refused with `409 STALE_CONFIG`.
- **History.** Each accepted change is recorded with its actor. The change
  is stored with the configuration in the same atomic write. If appending it
  to the history then fails, the save still stands and the entry is added
  the next time the history is read or written. The history keeps the newest
  1,000 entries.
- **What takes effect where.** Task models and Igor's persona apply per
  request. Igor's default model and the Hermes side-call tasks apply when the
  operator runs `deploy/hermes/apply-igor-profile.sh`, which reads the stored
  choices. Igor's default model is Hermes's `model.default`, used only by
  Hermes sessions outside STEX (its CLI or scheduled jobs): STEX turns always
  carry their task model. Parked members' personas, loadouts and default models are recorded
  for when they are activated. Equipped skills are recorded but not yet
  installed into Hermes. The screen says which applies to each setting.
- **Application.** `per-request` tasks take effect on the next turn: the
  inference service sends `provider: "openrouter"` and the task's model with
  every Hermes request. `profile-sync` tasks (Hermes's own side calls:
  context compression, titles, delegation) take effect when the operator
  applies the profile on the VM. The document says which is which.

Task ids in v1:

| Task | App | Application | Default |
| --- | --- | --- | --- |
| `igor.conversation` | Igor | per-request | `high` |
| `frige.book`, `frige.section`, `frige.piece` | Frige | per-request | `high` |
| `hermes.compression` | Hermes | profile-sync | `long` |
| `hermes.title` | Hermes | profile-sync | `medium` |
| `hermes.delegation` | Hermes | profile-sync | `high` |

Seaxneat has no model tasks yet; its menu opens the same screen, which shows
that honestly.

Failures: `UNAUTHORIZED` (401), `INVALID_REQUEST` (400, with `issues`),
`COMPANY_READ_ONLY` (403, from the product server), `STALE_CONFIG` (409),
`MODEL_REFUSED` and `MODEL_UNAVAILABLE` (422), and
`CONFIG_UNAVAILABLE` (503, when the state directory cannot be read or
written). No failure includes a token. The retired `/v1/settings/models` and
`/v1/models/catalog` routes stay `410 Gone`.
