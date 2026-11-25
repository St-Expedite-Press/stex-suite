# Frige editorial sessions (A1)

**Date:** November 25, 2026. **Scope:** `apps/frige`, Pantheon's Frige
workspace and the Frige and TexGraph protocol notes, with synthetic books in
temporary directories and the fake or local-stub inference transport only. No
manuscript under `apps/frige/books/*/manuscript/` was opened, no provider was
called, and nothing was deployed. Authority:
[D-027](../program/DECISIONS.md#d-027--conversations-and-working-sessions-share-one-lifecycle)
(lifecycle) and [D-028](../program/DECISIONS.md#d-028--a-verified-actor-reaches-the-engines)
(actor), on branch `feat/frige-sessions-a1`.

## What changed

| Area | Change |
| --- | --- |
| Storage | A scope's existing journal is its first conversation (`main`), read in place. Other conversations keep a journal and a per-scope index in `.texgraph/sessions/<scope>/`. A damaged index is `503 SESSIONS_UNAVAILABLE` |
| Lifecycle | Five states, an archive flag, no delete, the D-027 transitions with actor, time and reason, resume on send, `409 SESSION_CLOSED` |
| Contracts | Additive `conversationId` and `context.sessionSummaries`; schema and README updated; proposal supersession stays per scope |
| Summary | Revisioned record, base-revision saves (`409 STALE_SUMMARY`), a deterministic draft from Frige's records, never stored unsaved |
| Continue | A new conversation with `continuedFrom`, needing a saved summary |
| Turn context | Only the conversation's own turns, plus up to three saved summaries (12,000 UTF-8 bytes) as the additive scope-turn v3 field `sessionSummaries` |
| Actor | `src/actor.mjs`; with `STEX_PLATFORM_ACTOR_SECRET` set, every state-changing request needs a verified actor (`401 ACTOR_REQUIRED`) |
| Interface | Switcher, actions menu, naming dialog and summary sheet in the conversation panel |

## Commands and results

Run in the worktree, on Windows, Node 24.

| Command | Result |
| --- | --- |
| `node --check` on `server.mjs`, `src/project-store-vault.mjs`, `src/editorial-sessions.mjs`, `src/actor.mjs`, `src/change-contract.mjs`, `src/inference-client.mjs`, `src/publishing-contract.mjs`, the Pantheon workspace modules and `scripts/verify/verify-frige.mjs` | Clean |
| `git diff --check` | Clean |
| `corepack pnpm run test:frige` before the change | 169 tests, 168 pass, 0 fail, 1 skipped |
| `corepack pnpm run test:frige` after the change | 189 tests, 188 pass, 0 fail, 1 skipped (the same skip as before) |
| `corepack pnpm run test:pantheon` | 31 tests, 31 pass, 0 fail |
| `STEX_VERIFY_FRIGE_PORT=4471 node scripts/verify/verify-frige.mjs` (Chrome, real LuaLaTeX) | `PASS`, 25 workflow steps, five viewports |

The mutation checks in the new suite were exercised once by hand: allowing
`completed` to `paused`, or raising the summary budget to 120,000 bytes,
fails the transition and the byte-bound tests respectively.

`corepack pnpm run test:instructions` could not run: it needs the `stex-igor`
submodule, which this worktree does not initialize. The remaining root suites
(`seaxneat`, `hermes`, `knowledge`, `platform`, `inference`, `igor`) were not
run, because the change touches none of them.

## What the new tests prove

`apps/frige/test/editorial-sessions.test.mjs` and `apps/frige/test/actor.test.mjs`:

- **Migration.** A single-thread journal with legacy turns stays byte-identical
  while conversations are listed, renamed, paused, created and written to, and
  reads exactly as before. Appending to the first conversation only extends
  it. A legacy section turn filed under its anchor still merges into the
  section.
- **Isolation.** Each conversation's turns, the 12-turn bound and a prompt's
  answer stay within it; another scope's turns are never mixed in.
- **Lifecycle.** All 25 state pairs are allowed or refused as D-027 says, with
  `from`, `to`, actor and reason recorded; refusals record nothing. Unknown
  states, empty or oversized titles and reasons, and a title with a lone
  surrogate are refused, and a refused request applies none of its parts.
- **Sending.** A paused or awaiting-review conversation resumes (recorded); a
  completed or abandoned one is `SESSION_CLOSED` and the message is not stored.
- **No editorial effect.** Every transition and archiving leave the pending
  contract pending and the manuscript hash unchanged; the later decision is
  recorded in the conversation that proposed it.
- **Summary.** Limits (4,000 characters; 20 entries of 300), blank-entry
  trimming, a stale base (`0` after a save, or a future revision), revision
  history, and `throughTurnId` validation.
- **Draft.** Built for one conversation only: its accepted, rejected and
  pending contracts with piece titles, an editorial decision recorded while it
  was open (and not one recorded before), an unanswered choice, and an
  approved excerpt a contract offered. Another conversation's superseded
  proposal and another scope's contract are left out, and a contract from
  before conversations belongs to the first conversation. The draft is not
  stored.
- **Continue.** Refused without a saved summary; records the revision.
- **`sessionSummaries`.** The continued-from summary first at its revision,
  then the most recent completed unarchived sessions, at most three, never
  itself, never another scope, never a transcript or `sources`. A fixture
  proves the 12,000-byte bound drops whole oldest items (and a single oversized
  summary entirely). A stub gateway shows the request carries the field beside,
  not inside, `turns` and `message`, and omits it when there are none.
- **Damaged index.** Six kinds of damage make list, read, create, update, send,
  save and offer fail with `SESSIONS_UNAVAILABLE`, and the file is not
  rewritten; only a missing file is an empty index.
- **Routes.** The full workflow over the publishing v1 prefix, including
  `409 SESSION_CLOSED`, `STALE_SUMMARY`, `SUMMARY_REQUIRED`, `404`, `405` with
  `Allow`, the engine's own prefix, and the first conversation's existing
  routes unchanged.
- **Project password and actor.** Each of the ten session endpoints, with a
  password on the book and the actor secret set, is checked signed out (reads
  `403 PROJECT_LOCKED`, writes `401 ACTOR_REQUIRED`), signed in but locked
  (`403`), and unlocked (success). A conversation id does not cross books.
- **Actor table.** No secret ignores any actor header; a matching token with a
  valid username (1 to 128 visible ASCII characters) and role verifies; a
  wrong, same-length wrong, short or missing token, a bad or repeated header,
  and a secret under 32 characters give no actor. Writes are refused without
  an actor on every mount and method tested, reads are not, and a forged actor
  header alone changes nothing.
- **Contract schema.** A contract made in a named conversation, with offered
  summaries, validates; a malformed `conversationId` or `summaryRevision` is
  refused; a record without them is unchanged.

## Browser verification

`scripts/verify/verify-frige.mjs` gained a conversation workflow, run at
1440 px and 390 px through real Chrome against a Frige and Pantheon stack with
a local inference stub on the gateway wire format. At each width it:

1. opens the scope on its first conversation, checks there is no horizontal
   scroll, and opens and closes the switcher from the keyboard (Escape returns
   focus to it);
2. types an unsaved source edit, creates a second conversation (focus returns
   to the switcher), and checks the scope, the editor text and the composer's
   "To …" line;
3. sends a simulated edit, which proposes in the new conversation (the
   contract's `conversationId`), checks that the first conversation shows a
   notice instead of the proposal's cards, and returns;
4. completes the conversation: the sheet opens prefilled with Frige's draft,
   says closing decides nothing, fits the viewport, saves the summary and the
   reason, and returns focus to the actions menu; the conversation is
   `completed`, the composer is disabled, and the proposal is still pending;
5. continues from the summary and checks, on the stub, that the request
   carries exactly that summary (`sessionSummaries`) and no earlier turns;
6. archives the completed conversation, hides it from the list, and shows it on
   request;
7. rejects the proposal through the engine, discards the unsaved edit, and
   checks the manuscript bytes are unchanged.

The script now takes `STEX_VERIFY_FRIGE_PORT` (default 4437) for its three
ports, so a run can avoid a stack another run owns. This run used 4471.
LuaLaTeX completed within its 30-second limit; risk R-13 did not occur.

## Inbound callers of Frige's state-changing routes

Enumerated before enforcing the actor, by searching the suite (`apps/`,
`backend/`, `services/`, `scripts/`, `protocol/`). `stex-igor` is not
initialized in this worktree, so Igor's own calls were not read.

| Caller | Route | Through Pantheon? | Effect of enforcement |
| --- | --- | --- | --- |
| The browser workspace and library | Publishing v1, `/api/books`, legacy-books, unlock and lock | Yes (`/frige/…`, `/api/books`) | Needs Pantheon to send the actor (its part of D-028) |
| Pantheon's knowledge API | `POST /api/stex/context/v1/projects/<id>/observation` (`apps/pantheon/src/knowledge-api.mjs`) | No: server to server | Exempted on the A1 branch. At integration, D2 made Pantheon forward the signed-in actor on this call, so the coordinator **removed the exemption**. A bare call is now refused, and `apps/frige/test/actor.test.mjs` asserts that |
| The Python platform API | `GET /frige/api/stex/projects` | No | Read; unchanged |
| The knowledge page in the browser | `GET /<studio>/api/stex/projects` | Yes | Read; unchanged |
| Igor (`stex-igor`) | Project-context reads | No | Reads, as the contract says; not verified here for any POST |
| Verification scripts and tests | Synthetic stacks | No | Run without the secret (local mode) |

No other process posts to Frige. Until Pantheon forwards the actor headers,
setting `STEX_PLATFORM_ACTOR_SECRET` on Frige would refuse every browser write,
so the secret must be set only together with Pantheon's sender.

## Limits

- The deployed gateway ignores `sessionSummaries` until the stex-igor adapter
  forwards it, and does not report it in `meta.forwardedContext`; the record of
  what was offered is Frige's, unconfirmed.
- The draft attributes editorial decisions to a conversation by time window
  only.
- A screenshot at 390 px of the conversation sheets was not taken (the harness
  captures evidence at 1440 px); the 390 px checks are assertions on layout,
  focus and behaviour.
- Chrome only; the hosted VM and a live gateway were not exercised.

## Changes after the independent review (2026-11-25)

The coordinator ran one independent review over the integrated program diff.
It found no High findings. The Frige items were fixed afterwards:

- **Send and close race** (Low). The lifecycle check and the message append
  could be separated by a concurrent close. `beginTurn` now takes the user
  turn and appends it under the same store lock, so a refused send stores
  nothing.
- **Continue idempotency** (Low). A repeat continue from the same summary
  revision returns the existing conversation with `replayed: true` and
  `200`, and creates nothing. A newer revision still starts a new
  conversation.
- **Damaged index** (Low, documented). A damaged session index stops new
  turns in the scope's first conversation too, including through the older
  `/turn` route. This is fail-closed by design; the protocol now says so.
- **Annotation** (Low). The session route pattern now has a comment
  explaining its security role.
- **Exemption removed.** Since D2 forwards the actor on the knowledge
  observation POST, that route is no longer exempt (see the caller table
  above).

Not fixed, recorded as a limitation: before the first conversation is
written to the index, it re-reads its whole journal to compute its creation
time, and the conversation list reads every journal to count turns. This is
a performance cost only.

After these changes, `test:frige` passed 188 of 189 with 1 skip. Each new
assertion fails against the code from before the fix.
