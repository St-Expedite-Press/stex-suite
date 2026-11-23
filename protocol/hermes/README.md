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

**Director proposals in a scope turn** (program Wave 4,
[D-017](../../docs/program/DECISIONS.md)). The inference service's
scope-turn adapter sends trusted instructions, before the untrusted
context, telling the director how to propose: one fenced `stex-proposal`
block of JSON at the end of its prose reply. The adapter reads that block
into the v3 reply's existing `changes` and `layout` fields, keeping only the
pieces the turn offered, and a layout change only in a section or piece
conversation. It removes the block from the prose and says in the reply what
it set aside. Frige validates both fields as before, and nothing changes
until the author accepts. A reply cut short at its output limit proposes
nothing, and neither does a simulated reply. A remote reply's `meta.model`
names the model the turn requested (the task's configured model), and
`meta.taskId` names its agent-configuration task. A simulated reply keeps
its `stex.hermes.fake` label. No field was removed or retyped.

## Approved-document turns

The opt-in `POST /v1/hermes/document-turn` uses the v1 turn and reply
envelopes. Igor's server may call it after a signed-in account approves an
exact project snapshot through [the context API](../context/README.md).
The route requires the inference secret and a per-attempt `X-STEX-Document-Grant`
credential. It accepts an Igor conversation with an epoch-specific id and
`context.approvedDocuments` containing `project` and `approvalDigest`. Igor
binds the grant to the owned pending reply and the SHA-256 of the complete
serialized turn. Inference verifies that request and digest with Igor over
a private Unix socket before dispatch. Source bytes travel only through the
broker's tool replies. The credential never reaches browsers or model
messages.

The isolated MCP client offers `search_approved_excerpts({query})` and
`read_approved_excerpt({reference,revision})`. Both resolve the current
grant on Igor's broker. Search returns exact reference and revision pairs.
Read returns the selected UTF-8 excerpt with provenance and an untrusted
source label. The broker verifies the approval and source hashes, allows up
to eight calls and 24,000 cumulative UTF-8 JSON result bytes, and closes
the grant at completion, cancellation or timeout. A context withdrawal
advances the epoch and closes access for subsequent turns.

The route requires a separately isolated streaming worker and fails closed
when it is unavailable. The existing conversational route and TexGraph
adapters continue to use their current transports. PDF and DOCX approval
and conversion are outside this text-snapshot route.

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
  - Each catalog model carries `description`: OpenRouter's description,
    reduced to at most 280 characters of plain text, shown when its name is
    hovered or focused.
  - Each also carries `free`: a `:free` variant, or zero prompt and
    completion prices. Unknown prices are not free.
  - Claude's free variants, and OpenRouter's own `openrouter/free` router,
    are refused like any other Claude model or router.
- **Free mode** (added 2026-11-21, [D-022](../../docs/program/DECISIONS.md)).
  The owner may run **Igor's own conversation sandbox** on a free model.
  - Document: `freeMode: {task: "igor.conversation", scope: "igor-sandbox",
    enabled, model}`.
  - Update: `freeMode: {enabled?, model?}`. Fields left out keep their saved
    values, the model is kept when the mode is turned off, and a reset clears
    both.
  - It applies only to a generic turn (`/v1/hermes/turn`) that has all of
    these:
    - `product` `igor`;
    - an operation of exactly `{kind: "conversation"}`;
    - no context at all.

    Every other turn keeps its paid task model:
    - Frige's scope turns;
    - the legacy page and interview turns that use Igor's conversation task;
    - an Igor turn about a project;
    - a turn carrying any context or payload;
    - another product.
  - Turning the mode on needs a model the catalog marks `free`. A free model
    is refused (`MODEL_UNAVAILABLE`) for every task and default model.
  - The same rule is checked again on every turn, since OpenRouter may
    reprice a model after it was chosen:
    - a paid turn whose model the catalog now marks free fails closed
      (`MODEL_UNAVAILABLE`);
    - so does a free-mode turn whose model is no longer free, or cannot be
      confirmed free.
  - Catalog `free` flags are recomputed from ids and prices, never read back
    from a cache.
  - Hermes's own profile memory is outside this rule; see
    [R-15](../../docs/program/RISKS.md).
  - The Company screen warns that free endpoints are rate-limited and may log
    or train on what is sent.
  - Hermes's own side calls keep their pinned Grok models.
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
