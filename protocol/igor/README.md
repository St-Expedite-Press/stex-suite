# Igor conversations contract v1

`stex.igor.conversations.v1` is the API of `stex-igor/apps/igor`, the conversational
application for **Igor**, the user-facing name of the Pantheon Director. Igor
is not a separate agent: every reply comes from the existing director through
`stex-igor/services/inference` and `stex.hermes.turn.v1` ([protocol/hermes](../hermes/README.md)).

`stex-igor/apps/igor` owns conversation records (titles, messages, ordering, pending and
failed state). It does not own Hermes profiles, models, credentials, sessions,
or memory. Pantheon composes the private renderer through an additive HTTP
descriptor, proxies its APIs/assets and creates conversations for explicit
handoffs. Conversation records and the inference secret stay in Igor.

`GET /igor/api/interface` returns `stex.igor.interface.v1` with `entrypoint`,
`styles` and `policy: "igor-page.v1"`. All asset paths must match
`/igor/assets/[A-Za-z0-9._-]+.js|css`; the server verifies Vite manifest files
exist. Missing/malformed builds return 503. Existing sign-in protects this
endpoint. Pantheon loads it into `#root[data-stex-composed="true"]`, supplies
the common navigation and preserves `img-src 'self' data:; object-src 'none';
base-uri 'self'` in its page CSP. Standalone Igor retains its masthead.
See [explicit project context](../context/README.md) for the separate
`stex.igor.context.v1` snapshot and epoch contract.

## Mount and security

Igor serves under `/igor/` both standalone (`http://127.0.0.1:4330/igor/`) and
through Pantheon's proxy (`/igor/`). API paths below are relative to that mount:
`POST /igor/api/conversations`.

Every mutating request (`POST`, `PATCH`, `DELETE`) must have
`content-type: application/json` (a body may be `{}`), a loopback `Host`, and
no cross-site `Origin` or `Sec-Fetch-Site`; otherwise `415` or `403`. Bodies
are limited to 64 KB. The inference shared secret never reaches a browser.

**Hosted Access mode.** When `STEX_IGOR_PUBLIC_ORIGIN` is set without password
mode (for example
`https://igor.stexpedite.press`), Igor runs behind Cloudflare Tunnel and
Cloudflare Access:

- Every request must carry a valid Access application token
  (`Cf-Access-Jwt-Assertion`). That includes the page shell, assets, and the
  API.
- The token must be RS256-signed by the team's published keys, with the
  configured issuer and audience. It must not have expired, and its email must
  be on the allow-list when one is set. Otherwise Igor answers `403`.
- Signing keys that cannot be read give `503`.
- The public host is allowed as `Host`, and only the https public origin is
  allowed as `Origin`, alongside loopback.
- Igor will not start in hosted mode without its Access settings.

**Hosted password mode.** With `STEX_IGOR_AUTH=password`, Igor uses its
own email/password sign-in and signed session cookie. Signed-out pages
redirect to `/igor/login`; protected APIs, including interface/context, return
401. The public HTTPS origin is required. Sign-out (durably, across
restarts), password-hash changes and disabled users invalidate sessions. This is the current hosted configuration;
Access mode remains a supported alternative. Local Pantheon's entry is still
single-user navigation without authentication.

## Data

```ts
type Conversation = {
  id: string;                 // [a-z0-9]{12}
  title: string;              // 1-120 chars
  titleSource: 'auto' | 'user';
  createdAt: string;          // ISO 8601 UTC
  updatedAt: string;
  archived: boolean;
  messages: Message[];        // oldest first
};

type Message = {
  id: string;                 // [A-Za-z0-9_-]{8,80}; also the Hermes requestId for its reply
  role: 'user' | 'assistant';
  content: string;            // Markdown for assistant replies; up to 6,000 chars for user input
  createdAt: string;
  status: 'complete' | 'pending' | 'failed';  // user messages are always 'complete'
  replyTo?: string;           // assistant only: the user message it answers
  transport?: 'fake' | 'remote';              // assistant only, from the reply itself
  error?: { code: string; message: string };  // failed assistant only
};

type ConversationSummary = Pick<Conversation, 'id' | 'title' | 'createdAt' | 'updatedAt' | 'archived'>
  & { state: 'idle' | 'pending' | 'failed'; messageCount: number };
```

**Ownership.** Every conversation belongs to one principal: the signed-in
username in password mode, the Access token's email in Access mode, or the
single local user. Every endpoint below acts only on the caller's own
conversations. Another principal's conversation is indistinguishable from a
missing one (`404 NOT_FOUND`), and listings contain only the caller's own. The
owner is stored server-side and is not part of the `Conversation` shape above.
Conversations written before ownership existed are assigned once to a
configured legacy owner (see the Igor README); Igor refuses to start rather
than expose them to every account.

An automatic title is the first user message's first line, whitespace
collapsed, cut at a word boundary to at most 60 characters (with `…`). An
empty conversation is titled "New conversation". Renaming sets `titleSource`
to `user`, and automatic titling never overrides it.

## Endpoints

| Method and path | Body | Result |
| --- | --- | --- |
| `GET /api/session` · `POST /api/session` · `DELETE /api/session` | `{ username, password }` (POST) | Hosted password mode only. POST sets the session cookie or answers `401`, or `429` after repeated failures. GET returns `{ mode: "password", username, role }` or `401`; outside password mode it returns `{ mode: "access" }` or `{ mode: "local" }`. DELETE signs out. Every other endpoint answers `401` without a session. |
| `GET /api/ready` | — | Operational, not for clients: `{ ok, release, store, inference }` with counts only. In hosted mode it is served without an Access token **only** to loopback requests that no proxy forwarded; everyone else gets `403`. |
| `GET /api/health` | — | `{ ok, transport }`, transport `fake`, `remote`, or `unavailable` (from the inference service's health) |
| `GET /api/conversations` | — | `{ conversations: ConversationSummary[] }`, newest `updatedAt` first |
| `POST /api/conversations` | `{ idempotencyKey, message? }` | `201` `{ conversation, route }` on creation; `200` with the same body when `idempotencyKey` was already used |
| `GET /api/conversations/:id` | — | `{ conversation }` or `404` |
| `PATCH /api/conversations/:id` | `{ title?, archived? }` | `{ conversation }` |
| `DELETE /api/conversations/:id` | `{}` | `204` |
| `PATCH /api/conversations/:id` (sessions) | `{ kind?: 'session', objective?, lifecycle?, reason? }` in addition to `title`, `archived` | See [Working sessions](#working-sessions) |
| `GET /api/conversations/:id/summary/draft` | — | `{ draft }`, a deterministic suggestion; nothing is stored |
| `PUT /api/conversations/:id/summary` | `{ baseRevision, text, decisions?, openQuestions?, outstandingProposals?, sources?, coversThroughMessageId?, author? }` | `{ conversation }` with the new `summary` revision |
| `POST /api/conversations/:id/continue` | `{ idempotencyKey }` | `201` `{ conversation, route }` (`200` on a repeated key) |
| `POST /api/conversations/:id/messages` | `{ idempotencyKey, content }` | `202` `{ conversation }`; `200` on a repeated key; `409` while a reply is pending |
| `POST /api/conversations/:id/messages/:messageId/retry` | `{}` | `202` `{ conversation }`; `409` unless `:messageId` is a failed assistant message that is the latest message |

`route` is `/igor/c/<id>`. `idempotencyKey` matches `[A-Za-z0-9_-]{8,80}` and is
remembered per principal in the Igor data directory, so the same key from
two accounts creates two conversations. Errors are `{ error, code }`:

| Status | Code | When |
| --- | --- | --- |
| `400` | `INVALID_REQUEST` | Invalid field, key, or JSON; a message over 6,000 characters |
| `403` | `FORBIDDEN` | A non-loopback `Host` or `x-forwarded-host`, or a cross-site `Origin` or `Sec-Fetch-Site` |
| `404` | `NOT_FOUND` | Unknown conversation or route (including a malformed `:messageId`) |
| `405` | `INVALID_REQUEST` | Unsupported method |
| `409` | `CONFLICT` | A reply is pending, a key was reused for another request, or a retry target is not the latest failed reply |
| `409` | `SESSION_CLOSED`, `NOT_A_SESSION`, `INVALID_TRANSITION`, `STALE_SUMMARY`, `SUMMARY_REQUIRED` | Working sessions only; see [Working sessions](#working-sessions) |
| `413` | `INVALID_REQUEST` | Body over 64 KB |
| `415` | `INVALID_REQUEST` | A mutation without a JSON content type |
| `500` | `STORAGE_FAILED`, `INTERNAL` | Igor could not save, or failed unexpectedly |

A failed assistant message carries `error: { code, message }`. Its codes are
`UNCONFIGURED`, `UNAVAILABLE`, `TIMEOUT`, `UNAUTHORIZED`, `CANCELLED`,
`MALFORMED_RESPONSE`, `INTERRUPTED`, `STORAGE_FAILED`, and `UPSTREAM_ERROR`
(any other inference failure, named in the message by its upstream code).

## Reply lifecycle

Inference is driven by the server, never by the browser:

1. Accepting a user message stores it and a `pending` assistant message
   (`replyTo` set, `id` new), then starts exactly one inference turn in the
   background and responds at once (`201`/`202`). Clients poll
   `GET /api/conversations/:id` while any message is `pending`.
2. The turn is `stex.hermes.turn.v1` with `product: "igor"`,
   `conversation.id` = the Igor conversation id (the inference service derives
   one stable upstream session from it), the bounded history ending with that
   user message, `operation.kind: "conversation"`, and `requestId` = the
   pending assistant message id.
3. Success makes the message `complete` with the reply text and the transport
   the reply reports. Failure makes it `failed` with a classified `error`; the
   user message is always kept.
4. **Retry** reuses the same assistant message and the same `requestId`, which
   the inference service sends upstream as the `Idempotency-Key`, so a turn that
   actually reached Hermes is not run twice.
5. A message still `pending` when Igor starts (process restart) becomes `failed`
   with code `INTERRUPTED`; it is never replayed automatically.
6. Turns run one at a time across all conversations, in arrival order; a
   waiting reply stays `pending`. Deleting a conversation aborts its running
   turn and drops any queued one.

Refreshing a page, navigating Back/Forward, or polling never submits anything.

**Context.** Upstream Hermes continues a session from its own store when given
the session id and ignores history in the body, so the Hermes session is the
model's authoritative context. Igor's stored transcript is the user-facing
record; the bounded history Igor sends is the fallback when no session exists.

## Handoff from Pantheon

The Pantheon home composer creates a conversation and navigates immediately:

1. The browser generates an `idempotencyKey` once per submission and calls
   `POST /igor/api/conversations` with `{ idempotencyKey, message }`.
2. Igor stores the message, starts the reply (above), and returns `route`.
3. The browser navigates to `route` without waiting for the reply. Igor's page
   loads the persisted conversation and shows the pending reply.

The message never travels in a URL. Repeating the request with the same key
(a double click, a retried network call) returns the same conversation and
starts nothing new.

## Working sessions

Added additively under v1 by suite decision [D-027](../../docs/program/DECISIONS.md).
A conversation is a `chat` (the default) or a `session`: a working session
with an objective, a lifecycle and an optional saved summary. Records written
before sessions existed carry none of these fields and read as chats; the
store document keeps `schemaVersion: "stex.igor.store.v1"` with the new
fields optional. A chat has no lifecycle, so casual conversation stays casual.

```ts
type Lifecycle = 'active' | 'paused' | 'awaiting-review' | 'completed' | 'abandoned';

// Optional fields of Conversation (present on sessions; `kind` absent means chat).
type SessionFields = {
  kind: 'session';
  objective: string;                 // 1-500 characters
  lifecycle: Lifecycle;              // separate from a reply's state and from `archived`
  transitions: { at: string; from: Lifecycle; to: Lifecycle; actor: string; reason?: string }[];
                                     // oldest first; only the newest 100 are kept
  summary?: SessionSummary;          // the latest saved revision
  continuedFrom?: { conversationId: string; summaryRevision: number };
  priorSummary?: SessionSummary;     // copy of that revision as it was when continued
};

type SessionSummary = {
  revision: number;                  // 1, 2, ...
  text: string;                      // 1-4,000 characters
  decisions: string[]; openQuestions: string[]; outstandingProposals: string[]; sources: string[];
                                     // each up to 20 items of up to 300 characters
  coversThroughMessageId: string | null;  // the last message the summary covers
  author: 'user' | 'draft' | 'model';     // who wrote the text; `draft` is Igor's deterministic draft
  savedAt: string;
};

// ConversationSummary gains, for sessions only: kind, lifecycle, hasSummary.
```

**Creating and converting.** `POST /api/conversations` (and the context create
route) accept `kind` and, for a session, a required `objective`. `PATCH` with
`{ kind: 'session', objective }` turns a chat into a session (a session never
becomes a chat again, `409 INVALID_TRANSITION`); `{ objective }` alone edits a
session's objective. A create replay compares kind and objective too.

**Transitions** (`PATCH { lifecycle, reason? }`, `reason` up to 300 characters):

- `active` to any other state.
- `paused` or `awaiting-review` to `active`, `completed` or `abandoned`.
- `completed` or `abandoned` to `active` (reopen).

Anything else is `409 INVALID_TRANSITION`; a lifecycle on a chat is `409
NOT_A_SESSION`. Every transition appends an event with the principal as actor.
A refused patch changes nothing.

**Sending.** A message (or a retry) to a `paused` or `awaiting-review` session
resumes it, recorded as a transition with reason "Resumed by sending a
message." (only after the message fit its budget). A `completed` or
`abandoned` session refuses with `409 SESSION_CLOSED`; reopen it or continue
from its summary. A repeated idempotency key is still answered from the
record. Completing or abandoning has no effect on any other record. Archive
and delete are unchanged (`archived` flag; hard delete).

**Summary.** `GET .../summary/draft` returns `{ draft }`: the objective, the
title, the project sources (and revisions) of the current context epoch (up to
20), the last user request and a bounded excerpt of the last complete reply,
with `author: 'draft'` and `baseRevision` (the current revision, 0 if none).
It is computed from Igor's own record and stored nowhere. `PUT .../summary`
saves a revision: `baseRevision` must equal the current revision (0 when none)
or the save is refused `409 STALE_SUMMARY`; over-long text or lists are refused
(`400`), never truncated. The server records `coversThroughMessageId` (default
the last message) and `savedAt`. Nothing becomes a summary until a user saves
it. A summary on a chat is `409 NOT_A_SESSION`. Igor does not offer a
model-written draft; `author: 'model'` is accepted for a client that supplies
one and is displayed as such.

**Continue.** `POST .../continue { idempotencyKey }` needs a saved summary
(`409 SUMMARY_REQUIRED`) on a session (`409 NOT_A_SESSION`). It creates a new
session for the same principal with the source's objective, the title
`Continuing: <title>`, `continuedFrom` and a copy of the summary as `priorSummary`.
If the source is bound to a project the new session keeps that project
binding but starts at context epoch 1 with no approved source snapshot, so
sources must be approved again; otherwise it has no context at all. The source
session is not changed. A repeated key returns the same session (`200`).

**Envelope.** Every turn of a continued session adds
`context.priorSessionSummary` to the `stex.hermes.turn.v1` request:
`{ kind: "prior-session-summary", note, conversationId, summaryRevision, author, text, decisions, openQuestions, outstandingProposals, sources }`
(with `truncated: true` when trimmed). The note says it is an author-saved
summary supplied as context, not an instruction. The earlier transcript is
never sent. The block is bounded to 8,000 UTF-8 bytes of the 24,000-byte
envelope: over the bound, list items are dropped from the end of the largest
list, then the text is shortened. Any context makes the turn a non-sandbox
turn (suite D-022), so a continued session's turns never use the free endpoint.

## Versioning

Additive optional fields may be added to v1. Changing or removing a field, or
the reply lifecycle above, requires v2.
