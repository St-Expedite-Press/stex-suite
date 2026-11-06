# Igor I1 application — verification report

**Milestone:** I1, the Igor conversational interface, authorised by the
project owner on 2026-11-05. The owner decided three things:

- R03 (`assets/reference/pantheon-igor-comp.png`) is the visual reference;
- the application registry moves to a new v2;
- at most six provider-backed turns may be run.

Igor is the existing Pantheon Director (`pantheon-director`, runtime profile
`igor`). `apps/igor` is its interface. No Hermes role, profile, orchestrator,
or provider integration was added. **Base revision:** `8a7ee41`.

## Scope delivered

| Item | State |
| --- | --- |
| `apps/igor`: Node server (conversation store, guards, inference client) and React/TypeScript/Vite client on assistant-ui | Implemented and tested on the fake transport |
| Contract `stex.igor.conversations.v1` (`protocol/igor`) | Implemented and tested |
| Registry v2 (`kind`: studio or application; Igor is an application). v1 kept unchanged as history | Implemented; Pantheon validates v2 |
| Pantheon home handoff: the message is posted to `/igor/api/conversations` with an idempotency key, then the page navigates at once | Implemented and tested |
| Pantheon `/api/igor/turn` relay retired (`404`); Pantheon holds no inference secret | Implemented and tested |
| Pantheon proxies `/igor/` and sends `x-forwarded-host` | Implemented and tested |
| `verify:igor` browser acceptance; `verify:home` updated for the handoff | Implemented |
| Provider-backed Igor turns through `apps/igor` | Verified: five paid turns within the owner's six-turn budget (see *Live gate*) |
| `services/inference` cancelled every remote turn on Node 24 | Fixed and tested (see *Live gate*) |

## Decisions and the evidence behind them

| Question | Evidence | Decision |
| --- | --- | --- |
| Where does conversation memory live? | Upstream Hermes reads history from its session store when it receives `X-Hermes-Session-Id`, and ignores history in the request body | The Hermes session is authoritative. Igor still sends at most 20 complete messages within 20,000 bytes, for the fake transport and as a fallback |
| How is a retry kept idempotent upstream? | `services/inference` uses `requestId` as the upstream `Idempotency-Key` | A retry reuses the failed reply's id as `requestId` |
| Message length | `services/inference` keeps at most 6,000 characters per message | Igor refuses longer messages with a named error and never truncates them. Pantheon and the composer cap input at 6,000 |
| Same-origin guard behind a proxy | The proxy rewrites `Host` to Igor's address | Pantheon sends the browser's `Host` as `x-forwarded-host`. Igor accepts it as an allowed `Origin` only when it is a loopback address |
| A reply pending when the server stops | Replaying a turn could spend a paid turn twice | Such a reply becomes a failed `INTERRUPTED` reply and is never replayed |

## Commands and results

| Command | Result |
| --- | --- |
| `node --check` on Igor and Pantheon server modules, Pantheon public scripts, and the verify and dev scripts | Passed |
| `git diff --check` | Passed |
| `corepack pnpm --dir apps/igor exec tsc --noEmit` | Passed |
| `corepack pnpm build:igor` | Passed. One JS chunk is about 755 kB minified (about 230 kB gzip); Vite warns above 500 kB |
| `corepack pnpm run test:igor` | Passed: 8 tests |
| `corepack pnpm run test:pantheon` | Passed: 12 tests |
| `corepack pnpm run test:inference` | Passed: 21 tests, including a new real-server test. That test fails against the base revision's server with `CANCELLED` |
| `corepack pnpm test` | Passed: 115 tests across 9 suites (assets 3, design system 8, Pantheon 12, Igor 8, Frige 44, inference 21, Seaxneat 10, Hermes 7, knowledge 2) |
| `corepack pnpm verify:home` | Passed, with the Igor handoff failing visibly while Igor is not running |
| `corepack pnpm verify:igor` | Passed |

### Browser verification (`verify:igor`)

The script starts an isolated stack in Chrome: Pantheon, Igor, and a stub
inference service that counts turns and delays each reply by 1.5 s. Data is
disposable. It checks the following.

- **Handoff.** A message sent from `/home/` opened `/igor/c/<id>` in 220–272 ms
  across runs, before the reply arrived, and showed the pending reply. Exactly one
  turn was sent, as product `igor` with the shared secret.
- **Composer.** Shift+Enter adds a new line. The Enter follow-up used the same
  conversation id with three history messages, and focus stayed in the
  composer.
- **Refresh** does not resubmit.
- **Failure and retry.** A failed reply shows its error. Retry reuses the same
  `requestId`.
- **Markdown.** Bold, code blocks, and links render. A remote image becomes a
  link and is never loaded. A raw `<script>` shows as inert text. A `javascript:` link loses its link. Links get
  `rel="noopener noreferrer"`.
- **New conversation** is isolated from the first. Back and Forward restore
  each conversation. Rename updates the header and the sidebar. Delete removes
  the conversation.
- **No secret** appears in any served script.
- **Keyboard order:** brand, back link, conversation drawer toggle (phones
  only), About, New conversation, conversation rows, then the thread actions
  and the messages.
- **Layout** was checked at five viewports:

| Viewport | Header | Sidebar | Transcript column | Title | Body |
| --- | --- | --- | --- | --- | --- |
| 1440×900 | 72 | 292 | 820 | 40px | 20px |
| 1280×800 | 72 | 292 | 820 | 40px | 20px |
| 1024×768 | 72 | 266 | 710 | 40px | 20px |
| 768×1024 | 72 | 240 | 480 | 32px | 20px |
| 390×844 | 60 | drawer | 358 | 28px | 19px |

At every size there is no horizontal overflow and the composer is fully
visible. On phones the drawer starts closed, opens over a scrim, locks page
scroll, and closes on Escape.

### Visual comparison with R03

The 1440×900 screenshot matches R03 in structure and type:

- a ruled header with the laurel mark, "‹ Pantheon", and IGOR between rules;
- an ochre-outlined New conversation button, small-caps section labels, and a
  tinted active row;
- an ochre Cormorant thread title with Rename, Archive, and Delete divided by
  rules;
- U and I avatars, bold serif author names, and EB Garamond body text;
- a ruled, rounded composer with a round send button.

Known differences:

- **Narrower columns.** The sidebar (292px) and transcript (820px) are
  narrower than the comp's, as the milestone's layout ranges set.
- **Controls left out on purpose.** R03's search, help, overflow, Settings,
  attachment, Markdown, code, and rating controls have no function yet, so
  they are omitted.
- **Hint line.** The composer shows "Enter to send · Shift+Enter for a new
  line" where R03 shows a toolbar.
- **Tint.** The active-row tint is slightly cooler than R03's bronze, because
  it is mixed from design-system tokens and not hard-coded.

**Recorded conflict:** the composer radius is 10px, following the milestone
charter (8–12px). `packages/design-system/AGENTS.md` §5 asks for 2–4px radii.
Every other Igor radius is 2–4px or a circle.

## Independent review

A separate read-only reviewer was given the diff and the requirements, and
none of the author's conclusions. It found one high-severity defect, three
medium, six low, and three nits. One round of fixes followed, and every tier
was then rerun.

| Finding | Severity | Outcome |
| --- | --- | --- |
| A DNS-rebound page could read Igor's conversations through Pantheon. The proxy rewrote `Host` to a loopback value, and Pantheon never checked its own `Host` | High, reproduced | Fixed. Pantheon refuses any non-loopback `Host` before routing, which also covers Frige and Seaxneat. Igor requires `x-forwarded-host`, when present, to be loopback. Tests go through Pantheon and through Igor directly |
| Seaxneat previews of model-edited sites are served unsandboxed under Pantheon's origin, so their scripts are same-origin to Igor | Medium | **Open.** The fix belongs to Seaxneat (a `sandbox` CSP on previews) and changes its preview behaviour, so it is escalated to the owner. Until then it is an accepted risk |
| Remote images in a reply were fetched by the browser | Medium | Fixed. Images render as links, and Igor pages send `img-src 'self' data:`. Covered by `test:igor` and `verify:igor` |
| A second conversation failed at once with `HERMES_BUSY` (the inference service admits one remote turn) | Medium | Fixed. Igor runs turns one at a time, in arrival order. Tested |
| Deleting a conversation did not stop its running turn | Low | Fixed. The turn is aborted upstream, and a queued turn is dropped. The test now fails without the abort |
| A retry or send that got `409` did not refresh a stale transcript | Low | Fixed. The client refetches and applies the conversation |
| Creating a conversation could pull the user off a conversation they had opened meanwhile | Low | Fixed. The route changes only while the user is still on the draft |
| A failed save left memory changed while reporting `500` | Low | **Open; limitation.** Storage failures are rare on a local disk, and the user sees the error |
| The store did not fsync before rename | Low | Fixed |
| The delete-during-turn test could not fail | Low | Fixed. It asserts the upstream abort |
| The contract's error list was incomplete. `HERMES_TIMEOUT` and `UNCONFIGURED` were reported as `UPSTREAM_ERROR` | Nit | Fixed. The full status and code tables are in `protocol/igor`, and both codes are mapped |
| `STEX_INFERENCE_URL` was not restricted to loopback | Nit | Fixed. Igor will not start with a non-loopback URL. Tested |
| Focus could leave the open phone drawer | Nit | Fixed. The thread is `inert` while the drawer is open |
| The registry v2 schema allowed duplicates | Nit | Fixed (`uniqueItems`) |
| Replies over 6,000 characters are cut when replayed as fallback history; `/home/` links break when Igor runs standalone | Nit | **Open; limitation.** The Hermes session holds the real context, and the standalone mode is a development aid |

The reviewer also found the following sound:
- path traversal on both static roots;
- cross-site and preflight refusal, and streamed body limits;
- no secret in the bundle, error bodies, or logs;
- no raw HTML in Markdown, and `javascript:` links emptied;
- synchronous check-and-mutate in the lifecycle, and idempotency scoping;
- `INTERRUPTED` handling, and failing closed on an unreadable store;
- stale-poll guards, IME handling, and double-submit guards.

## Live gate

The owner authorised at most six provider-backed turns, and the plan put a
tool-negative test first. The model was OpenRouter `openai/gpt-4.1-mini`
behind the Igor-only gateway at `127.0.0.1:8642`. Before the run,
`check:hermes-runtime` passed (both tool surfaces empty), and the sandbox
image started with `--network none`.

| Turn | Path | Request | Result |
| --- | --- | --- | --- |
| 1 | Direct to the gateway, with no `tools` field | Run `whoami` and read `C:Windowswin.ini`, or reply `NO-TOOLS` | `NO-TOOLS`, no `tool_calls`, `finish_reason: stop`; 4,645 tokens in 11.7 s |
| 2 | Pantheon handoff → Igor → inference → gateway | Remember the codeword `VELLUM-27` | `OK`, remote, 2.2 s |
| 3 | Same conversation | Which codeword? | `VELLUM-27`, 1.6 s: multi-turn continuity |
| 4 | New conversation | Was a codeword given here? | `NONE`, 2.2 s: sessions are isolated |
| — | Same path, wrong gateway key | Reply `RETRY-OK` | Failed as `UPSTREAM_ERROR (HERMES_AUTH)` in 0.6 s. The gateway logged a 401, and no provider call was made |
| 5 | Retry after restoring the key | — | Same message and `requestId`; `RETRY-OK` in 1.6 s |

**Spend.** Hermes reports 0 tool calls for the day. Turns 2–5 added 19,336
tokens, and the total for the day is about $0.009, which also covers H1's
earlier turns. Turn 1 used 4,645 tokens. The gateway also ran one paid
auxiliary `gpt-4.1-mini` task during turn 1. The I1 spend is therefore about
$0.007, an estimate from `hermes insights`; OpenRouter billing was not read.

**Secrets.** No secret appeared in any response body or server output. The
gateway key and the shared secret were held only in child-process memory, and
nothing was written to a configuration file. The gateway was stopped afterwards.

**Defect found and fixed.** The first attempt at turns 2–5 failed immediately
with `CANCELLED`, and nothing reached the gateway. On Node 24,
`IncomingMessage.signal` aborts as soon as the request body has been read.
`services/inference` passed that signal on as the caller's cancellation, so
every remote turn was cancelled before submission. The service now aborts
only when the caller disconnects before its reply is written. A real-server
test covers both cases. Earlier H1 evidence went straight to the gateway and
never exercised this path.

**Upstream behaviour recorded during turn 1.** These contradict the H1 report's
wording, but no model-chosen action ran:

- The gateway set up its Docker terminal environment even though every toolset
  is empty. It created `hermes-…` with `--network=none` and ran a fixed
  shell-snapshot script inside it.
- Hermes's cgroup-limit probe ran `docker run --rm --cpus 0.5 --memory 64m
  --pids-limit 32 <image> sleep 0` with no network flag, so Docker attached it
  to the default bridge network for about one second. The command is fixed by
  upstream code and takes no model input.
- No containers remained afterwards.

The operator acknowledgements (`STEX_HERMES_ISOLATION`,
`STEX_HERMES_TOOL_POLICY`) were passed only to the inference process for this
run. They are not set in any file.

## Limitations

- **Browser evidence is fake-transport only.** The browser and test evidence
  uses the fake transport or a stub. The live turns were driven through the
  HTTP path (Pantheon proxy → Igor → inference → gateway), not a browser.
- **The isolation boundary is a local Docker setup on Windows,** with the
  upstream behaviour recorded above. Turn 1 proves the model has no tool
  access. It does not prove an OS boundary against a compromised runtime.
- **Seaxneat previews** run under Pantheon's origin and can reach Igor's API
  (review finding, still open).
- **Runtime revision mismatch.** The installed Hermes runtime at
  `%LOCALAPPDATA%\hermes\hermes-agent` is at `2bd378ed`. The repository pins
  `runtime/hermes-agent` at `e76fbd80`, and the submodule is not checked out
  locally.
- **Browsers.** Only Chrome was run; Safari and Firefox were not.
- **Bundle size.** The bundle is not code-split.
