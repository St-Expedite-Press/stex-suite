# Pantheon

The common STEX web environment: public splash, command center, workspace
presentation, and same-origin engine proxies. Pantheon owns no engine state.
The [transition plan](../../docs/PLATFORM-TRANSITION.md) defines the staged
destination. Seaxneat and Frige have platform-owned workspaces. Igor's private
renderer is composed in the same shell through a versioned HTTP descriptor;
its conversation service remains the record owner. An optional local knowledge
journal supplies the Graph view without taking ownership of engine state.
React/TypeScript remains the frontend stack. Current Node application-backend
logic is transitional under the
[Python/FastAPI migration plan](../../docs/PLATFORM-TRANSITION.md#python-backend-migration);
the release preserves the existing implementation and presentation.

| Route | Behaviour |
| --- | --- |
| `/` | Public splash (`public/index.html`) |
| `/home/` | Command center: Continue working, Igor, Studios, Recent projects |
| `/projects/` | Every project in the active studios, newest first |
| `/studios/` | The four studios with their registered state and project counts |
| `/graph/` | Optional source/provenance and user-context projections; honest disabled state by default |
| `/activity/` | Honest "not built yet" page |
| `/home`, `/projects`, … | `308` to the trailing-slash route |
| `/frige/` | Platform-owned publishing library, or workstation for `?book=…`; `/frige/api/…` proxies the engine |
| `/workspaces/seaxneat/` | Pantheon-owned website workspace, using the versioned Seaxneat API |
| `/seaxneat/` | `308` to `/workspaces/seaxneat/`; query preserved; `/seaxneat/api/…` remains the engine proxy |
| `/igor/`, `/igor/new`, `/igor/c/<id>` | Shared-shell Director view; private Igor renderer, API, assets and session remain served over the loopback proxy |
| `/eostre/`, `/woden/` | Deferred studio pages in the same shell |
| `/texgraph/`, `/screenlab/`, `/novelgraph/` | `308` compatibility redirects |
| `/design-system/…` | `@stex/design-system` `src`, `fonts`, `brand`, `icons`, `specimen` folders only |
| `/media/…` | Splash, masthead, and studio-emblem derivatives (Git LFS); byte ranges supported |
| `POST /api/igor/turn` | Retired: `404`. Igor turns belong to `stex-igor/apps/igor` |
| `/api/applications` | The versioned application registry |
| `/api/books…` | Compatibility proxy to Frige's `/api/stex/legacy-books/v1…`; no local storage access |
| `/api/knowledge/v1…` | Optional knowledge view, source acceptance, relationships, withdrawal, export and erasure |

```powershell
corepack pnpm dev:pantheon          # http://127.0.0.1:4300/ (STEX_PANTHEON_PORT)
corepack pnpm run test:pantheon
corepack pnpm build:pantheon        # TypeScript + workspace production bundle
corepack pnpm verify:platform       # real dev:alpha and disposable Next.js workflow
corepack pnpm verify:splash         # browser checks; need Chrome or Edge
corepack pnpm verify:home
corepack pnpm verify:igor           # handoff into Igor; needs `corepack pnpm build:igor`
corepack pnpm verify:knowledge      # disposable knowledge lifecycle and four Chrome viewports
```

Design rules are in [docs/DESIGN-SYSTEM.md](../../docs/DESIGN-SYSTEM.md);
assets and their focal regions are in [assets/README.md](../../assets/README.md).

## Splash

The ceremonial entrance: the P10 loop over the P01 still, with a live HTML
panel (emblem, "St. Expedite Press Presents:", wordmark, laurel rule,
tagline, **Sign in**).

- **Sign in is not authentication.** It links to `/home/` and creates no
  session or stored credential; the panel says *Local workspace · single
  user*. Real accounts need an authorised identity milestone.
- **Composition.** There are three layouts:
  - **Overlay** (landscape with room, at least 900 × 640 and aspect ≥ 5:4). The
    art covers the viewport and the panel sits in a region computed from the
    artwork's cover geometry: at or below artwork y 0.52 and right of x 0.42.
    That keeps both figures, the reaching hand, and the gaze between them
    visible on any screen shape. When the region is short (wide laptop browser
    windows), the panel drops the emblem, then the laurel rule. The wordmark
    and Sign in always stay.
  - **Split** (short landscape, such as phones turned sideways or small
    windows). The art sits beside the panel.
  - **Stacked** (portrait). The art is a 16:10 band above the panel.

  In every layout, Sign in is visible without scrolling.

## Command center

The editorial pages share one shell (`src/pages.mjs`, `public/shell.css`): a
masthead playing P11 over the P02 still, then the tabs Home, Projects, Studios,
Igor, Graph, and Activity. Instrumental workspaces use a compact header.

- **Masthead.** At 1100 px and wider, the art fades out under the brand, so
  the wordmark never sits on visible art. Light text over this art fails
  contrast everywhere except its outer edges. Narrower screens put the brand
  on its own row above the art. The art takes at most 20% of the viewport
  height. Desktop widths show a 6.7:1 stripe around the face, arm, and sun;
  phones show a 4:1 window.
- **Projects** come from each active studio's `stex.projects.summary.v1`
  endpoint ([protocol/projects](../../protocol/projects/README.md)), read in the
  browser through the proxy (`public/projects.js`). Pantheon stores nothing.
  A studio that does not answer within 2 seconds is named as not responding;
  the others still show. With no projects, the page offers to start one in
  Frige or Seaxneat.
- **Igor** is the user-facing name of the STEX assistant, the Pantheon
  Director (Hermes internally). Its conversations live in the Igor application
  ([apps/igor](../../stex-igor/apps/igor/README.md)). Pantheon composes its
  renderer at `/igor/` and proxies its API/assets/session. The
  home composer hands a message off: `public/igor.js` posts it to
  `/igor/api/conversations` with one idempotency key per message text, then
  navigates to the returned route at once, before Igor has answered. A
  failed handoff stays on `/home/` and says why. Messages are limited to
  6,000 characters. Pantheon holds no inference secret, stores no
  conversation, and never calls the inference service itself
  ([protocol/igor](../../protocol/igor/README.md)).

## Motion and serving

- **Motion.** Pages load only still images. `motion.js` starts a loop unless
  the visitor prefers reduced motion, has data saver on, or paused motion
  earlier. One choice, `stex.pantheon.motion` in `localStorage`, covers the
  splash and the masthead. Loops pause when the tab is hidden or the art is
  off-screen. **Pause motion / Play motion** is always available. Without
  JavaScript the stills, links, and tabs still work.
- **Video sources** declare the exact codec strings the build recorded in
  `assets/manifest.json`; a test fails if a page drifts from them.
- **Serving.** Static files revalidate by ETag, honour single byte ranges
  (Safari needs them to play video), and send `nosniff`.

## Browser verification

Both scripts drive an installed Chrome or Edge over the DevTools protocol with
no extra dependencies (`scripts/browser/devtools.mjs`), and write screenshots
and `report.json` to the system temp folder, or to `--out <dir>`.

- `verify:splash` covers 15 viewports from 320×568 to 2560×1080, including
  real browser windows such as 1366×657. It checks the panel against the focal
  regions, font loading, the Sign in target and its visibility, overflow, loop
  playback and wrap, keyboard order and focus, pausing and its memory, zero
  video under reduced motion, and the no-JavaScript fallback.
- `verify:home` starts an isolated stack with disposable data: real Frige
  with a synthetic book, a labelled Seaxneat stub, and no Igor. Across 9
  viewports it checks overflow, the masthead's share of the
  viewport, the face, fingertips, and sun staying visible, the brand never on
  visible art, and stray "null" text. It also checks project order, status
  text and links, studio counts, the Projects table, a studio that is down,
  the Igor handoff when Igor is not running, keyboard order, and motion.
  `verify:igor` covers the full handoff and the Igor application.

## Settings

| Variable | Purpose |
| --- | --- |
| `STEX_PANTHEON_PORT` | Port (default 4300) |
| `STEX_FRIGE_URL`, `STEX_SEAXNEAT_URL`, `STEX_IGOR_URL` | Application origins to proxy (loopback HTTP only; Igor defaults to `http://127.0.0.1:4330`) |
| `STEX_KNOWLEDGE_DATA_DIR` | Opt-in knowledge metadata journal directory; unset means disabled. Use an ignored path such as `services/knowledge/.local-data` resolved from the repository root |

`STEX_LAB_PORT` is the legacy port fallback. Books-directory configuration
belongs to Frige, including its `STEX_BOOKS_DIR` compatibility fallback;
Pantheon ignores these filesystem settings.
`corepack pnpm dev:alpha` sets the ports and application origins for the local
stack and inherits an explicitly selected knowledge directory.

Knowledge remains disabled unless `STEX_KNOWLEDGE_DATA_DIR` is explicitly set.
For a portable PowerShell example, see the [developer guide](../../docs/DEVELOPER-GUIDE.md).

## Composed Igor and project knowledge

`public/igor-interface.js` reads `GET /igor/api/interface`
(`stex.igor.interface.v1`), validates the descriptor and loads its same-origin
JavaScript/CSS assets. No private renderer source is copied into the public
suite. The shared shell supplies navigation; Igor supplies a compact toolbar,
conversation UI and approved project-context selection. Page CSP preserves
Igor's prohibition on remote Markdown images. A missing/malformed build shows
an explicit unavailable state. Standalone Igor retains its own masthead and
hosted sign-in behavior.

Graph uses `services/knowledge` through `src/knowledge-api.mjs`. Explicitly
accepted engine events update source metadata/provenance and user-context
views in one durable journal. Assertions and inferred relationships remain
distinct; inferences need evidence and confidence and can be corrected or
rejected. Project choices come from real engine summaries, while relationship
subjects are chosen from accepted projects. **Project knowledge** links in
Frige and Seaxneat open `/graph/?project=<reference>` with that project selected.
Owner access/revision checks run before sources are marked current:
at most 40 checks, four concurrently, under a six-second deadline. Failed or
unchecked references remain unavailable. The graph stores no source text,
transcripts, credentials or engine operational state.

Users can withdraw consent, renew it after fresh checks, export the journal,
or erase it. Accepted relationships with current evidence can be previewed
and explicitly sent to Igor as the exact normal user message shown. Source
access is rechecked before that handoff. No automatic graph inference,
transcript mining, engine writes or runtime tools are enabled. See the
[knowledge contract](../../protocol/knowledge/README.md). These workflows are
tested locally; the reviewed release is in progress and deployment evidence
belongs in [the release report](../../docs/verification/platform-release.md).
Obsidian is the required direct human-facing knowledge integration. The
metadata Graph does not implement actual-vault synchronization; that remains
the [separate required gate](../../docs/PLATFORM-TRANSITION.md#direct-obsidian-integration).

## Website workspace

Presentation lives in `workspaces/seaxneat`; `build:pantheon` produces the
ignored `dist/workspaces/seaxneat.js` and `.css`, served through the explicit
`/workspace-assets/` allowlist. The common shell retains navigation and motion
controls. The client holds transient selection and display state only. It
calls [`stex.seaxneat.workspace.v1`](../../protocol/seaxneat/README.md) through
`/seaxneat/api/stex/workspace/v1`, never imports the engine store, and handles
failed initial builds with no validated revision. Pending proposals survive
reload and dismissal is saved by the engine. Generated preview frames allow
scripts but have opaque origins; their HTTP responses also carry sandbox CSP.
