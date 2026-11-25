# Igor working sessions (program A2)

**Date:** 2026-11-25. **State:** local branches only. Nothing is pushed,
released or deployed. Tests used the fake transport or a stub inference
service; no provider was called.

| Repository | Branch | Commits |
| --- | --- | --- |
| stex-igor | `feat/igor-working-sessions` (base `a9b187f`) | `c5f3da3` gateway forwarding of Frige `sessionSummaries`; `a3435e7` Igor working sessions; `b6418d9` actor secret in the hosted env templates (D-028) |
| stex-suite | `docs/program-persistent-workspaces` | `921007b` contract, browser check and pin |

## What was built

These features follow [D-027](../program/DECISIONS.md#d-027--conversations-and-working-sessions-share-one-lifecycle).
The fields, routes and errors are in the [Igor protocol](../../protocol/igor/README.md).

- **Kinds.**
  - A conversation is a `chat` (the default, including every existing
    record) or a `session` with an objective.
  - A chat can become a session. A session cannot go back to being a chat.
- **Lifecycle.**
  - The lifecycle states and transitions are exactly D-027's.
  - Each transition is recorded; the newest 100 are kept.
  - Sending to a paused session, or to one awaiting review, resumes it.
  - Sending to a completed or abandoned session is refused with `409
    SESSION_CLOSED`.
  - Archive and delete keep their existing meaning.
- **Summary.**
  - The summary is revisioned. A save against an old revision is refused
    with `409 STALE_SUMMARY`.
  - The draft is deterministic and labelled, and it is never stored.
  - "Draft with Igor" (a model-written draft) was not built.
- **Continue.**
  - Continuing starts a new session with `continuedFrom`.
  - The model receives the saved summary as labelled context, limited to
    8,000 of the 24,000 envelope bytes. It never receives the earlier
    transcript.
  - A project binding starts again at a new epoch with no approved
    snapshot.
- **Renderer.**
  - Sessions are marked in the sidebar.
  - The sidebar has title search and an All/Sessions/Archived filter.
  - Sessions have a lifecycle bar and a summary sheet.
  - `window.confirm` was replaced by Igor's own confirmation dialog.
- **Gateway.** The texgraph adapter validates, trims and forwards Frige's
  `sessionSummaries`. The adapter behaviour is recorded in the
  [texgraph protocol](../../protocol/texgraph/README.md#session-summaries).

## Commands and results

| Command | Result |
| --- | --- |
| `corepack pnpm --dir stex-igor/apps/igor test` | 57 of 57 pass, including 13 new session tests. The coordinator re-ran it |
| `corepack pnpm --dir stex-igor/apps/igor run typecheck` | Clean. The coordinator re-ran it |
| `corepack pnpm --dir stex-igor/apps/igor run build` | Built; only the existing chunk-size warning |
| `corepack pnpm --dir stex-igor/services/inference test` | 76 of 76 pass. The coordinator re-ran it |
| `node --test stex-igor/hermes/test/runtime-profiles.test.mjs` | 7 of 7 pass |
| `corepack pnpm build:igor && corepack pnpm run verify:igor` (Chrome, stub inference) | **Passed**, with `failures: []`. The coordinator ran it from the integration branch |

The new tests cover:

- old records loading unchanged, and corrupt or unknown stores failing
  closed;
- every one of the 25 state pairs, the 100-event cap, resume on send,
  `SESSION_CLOSED`, and retry in closed and paused sessions;
- 404 for every other owner on every new route;
- the summary bounds and stale saves;
- draft determinism;
- that a continued turn carries the summary but no transcript;
- the envelope byte bound;
- a restart round trip.

The browser check covers:

- the delete confirmation: Cancel keeps the conversation and returns focus,
  Delete removes it;
- making a chat a working session, which needs an objective;
- pause, then resume by sending;
- completing with an edited draft;
- the hidden composer of a closed session;
- the sheet and session bar at 390 px, without overflow;
- Escape restoring focus;
- continue, where the stub inference service received the summary and not
  the earlier transcript marker;
- search and the Sessions filter;
- a direct POST to a closed session, which returns `409`;
- the five standard viewports.

## Limits

- **Fake transport.** No turn reached hosted Hermes. A live run needs the
  owner's authorization.
- **Rollback.** Rolling Igor back to its previous generation would show
  sessions as chats and accept messages to closed sessions until the
  working-session release is restored.
- **Summary history.** Only the latest revision of a summary is kept; a
  continued session keeps its own frozen copy.
- **Summary fields.** `author` and `coversThroughMessageId` are stored as
  the client sends them, because the summary is the user's own record.
- **Creating sessions.** New conversations start as chats in the interface,
  and the user turns one into a session.

## Hosted release (2026-11-25)

[Igor PR #14](https://github.com/St-Expedite-Press/stex-igor/pull/14) merged
as `8b7a789c7e59fbaed3f07efda8bd5b3dc8528d93` after branch and PR CI passed.
The [production workflow](https://github.com/St-Expedite-Press/stex-igor/actions/runs/45653289301)
passed. A VM read of `/opt/stex/ACTIVE.json` confirmed the same revision at
generation 24, with Igor and inference active. The local Chrome suite
passed again with stub inference. Hosted acceptance is limited to the
deployment and service checks. Hosted Pantheon and Frige use a separate
release process.
