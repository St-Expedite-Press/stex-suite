# Igor

Igor is the conversation interface for the **Pantheon Director**, the existing
`pantheon-director` Hermes role (runtime profile `igor`). It is an interface,
not another agent. It keeps conversation records and nothing else. Rules for
changing it are in [AGENTS.md](AGENTS.md).

```text
browser ──► Pantheon /igor/ (proxy) ──► apps/igor ──► services/inference ──► Hermes
                                        (records,       stex.hermes.turn.v1
                                         shared secret)
```

- **React, TypeScript, Vite.** The thread uses assistant-ui
  (`useExternalStoreRuntime`) with Igor's own server as the source of truth.
  Markdown renders through `@assistant-ui/react-markdown` and `remark-gfm` with
  no raw HTML; links get `rel="noopener noreferrer"`.
- **Server-driven replies.** Posting a message saves the user message and a
  pending assistant message, answers at once, and runs exactly one turn in the
  background. The page polls while a reply is pending. Replies are never
  streamed or simulated in the browser.
- **Context.** Each turn sends product `igor`, the conversation id, and at most
  20 complete messages within 20,000 bytes. The Hermes session for that
  conversation is the authoritative memory.
- **One turn at a time.** Turns from all conversations run in arrival order,
  because the inference service admits one remote turn by default. Deleting a
  conversation aborts its running turn.
- **Retry** reuses the failed reply's id as the `requestId`, so the inference
  service sends the same idempotency key upstream.
- **Restart.** A reply still pending when the server stops becomes a failed
  `INTERRUPTED` reply on the next start. It is never replayed.
- **Labels.** Replies from the fake transport carry a "Simulated" badge, and
  the sidebar footer names the transport.

The HTTP API, data shapes, limits, and failure codes are the
`stex.igor.conversations.v1` contract in
[protocol/igor](../../protocol/igor/README.md).

## Run and check

```powershell
corepack pnpm build:igor             # Vite build into apps/igor/dist (served by the server)
corepack pnpm dev:igor               # http://127.0.0.1:4330/igor/ (needs a build)
corepack pnpm run test:igor          # server, store, lifecycle, and guard tests
corepack pnpm --dir apps/igor exec tsc --noEmit
corepack pnpm verify:igor            # browser acceptance through Pantheon; needs Chrome or Edge
corepack pnpm dev:alpha              # whole stack; Igor is at http://127.0.0.1:4300/igor/
```

`verify:igor` starts an isolated stack with disposable data: Pantheon, Igor,
and a stub inference service that counts turns. It checks the following:

- the handoff from `/home/` navigates before the reply and sends one turn;
- Enter and Shift+Enter, follow-up context, refresh without resubmitting, and
  retry with the same request id;
- Markdown with no script execution;
- conversation isolation, Back and Forward, rename and delete;
- no secret in any served file, and keyboard order;
- layout at 1440, 1280, 1024, 768, and 390 pixels wide, including the phone
  drawer.

## Routes

| Path | Purpose |
| --- | --- |
| `/igor/` | The most recently updated unarchived conversation, or an empty new one |
| `/igor/new` | A new, unsaved conversation; the first message creates it |
| `/igor/c/<id>` | One conversation |
| `/igor/api/…` | `stex.igor.conversations.v1` |
| `/design-system/…` | Design-system `src`, `fonts`, `brand`, `icons`, so Igor also runs without Pantheon in front |

## Settings

| Variable | Purpose |
| --- | --- |
| `STEX_IGOR_PORT` | Port (default 4330) |
| `STEX_IGOR_DATA_DIR` | Conversation store (default ignored `apps/igor/.local-data/`) |
| `STEX_IGOR_DIST_DIR` | Built client (default `apps/igor/dist`; without it pages answer `503`) |
| `STEX_INFERENCE_URL`, `STEX_INFERENCE_SHARED_SECRET` | The inference service and its shared secret; without a URL every reply fails as `UNCONFIGURED` |

Only the Igor server holds the inference secret. Pantheon proxies `/igor/` to
`STEX_IGOR_URL` and holds none.

## Markup contract

`src/components/*.tsx` emits this structure, and `src/styles/igor.css` styles
only these classes. Change both together. The visual reference is R03,
[assets/reference/pantheon-igor-comp.png](../../assets/reference/pantheon-igor-comp.png).
Its search, attachment, format, rating, and Settings controls do nothing
yet, so they are left out on purpose.

```text
div.igor-app[data-sidebar="open|closed"]
  header.igor-header
    .igor-header__start > a.igor-brand (mark + name), a.igor-back "‹ Pantheon"
    .igor-header__title > span.igor-title "Igor"
    .igor-header__end > button.igor-icon-button.igor-sidebar-toggle (drawer only), button "About Igor"
  div.igor-body
    div.igor-scrim                         drawer backdrop, only while open
    aside#igor-sidebar.igor-sidebar
      button.igor-new                      "New conversation"
      nav.igor-nav > h2.igor-section-label, ul.igor-conversations > li > a.igor-conversation[aria-current]
                     (__title, __date, optional __state), p.igor-empty-note
                     details.igor-archive > summary.igor-section-label "Archive (n)"
      .igor-sidebar__footer > p.igor-transport[data-transport="fake|remote|unavailable"]
    main#main.igor-main
      .igor-thread-header > h1.igor-thread-title | form.igor-rename (> __input),
                            .igor-thread-actions > button.igor-action, span.igor-action-divider
      .igor-transcript > p.igor-thread-empty | ol.igor-messages
        li.igor-message.igor-message--user|--assistant[data-status="complete|pending|failed"]
          span.igor-avatar.igor-avatar--user|--assistant
          .igor-message__body > .igor-message__meta (__author, __time, __badge "Simulated"),
            .igor-message__content.igor-prose, p.igor-message__pending > span.igor-dots,
            .igor-message__error[role="alert"], .igor-message__actions > button.igor-icon-button
      form.igor-composer > textarea#igor-composer-input.igor-composer__input,
                           .igor-composer__bar > span.igor-composer__hint, button.igor-send
  dialog.igor-dialog, div.igor-toast[role="status"]
```

The drawer breakpoint is `(max-width: 767.98px)`, matched in `App.tsx` and the
stylesheet.
