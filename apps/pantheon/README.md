# Pantheon

The STEX loopback shell: the public splash, the command center, and a
same-origin proxy to the studios. Pantheon owns no product state.

| Route | Behaviour |
| --- | --- |
| `/` | Public splash (`public/index.html`) |
| `/home/` | Command center: Continue working, Igor, Studios, Recent projects |
| `/projects/` | Every project in the active studios, newest first |
| `/studios/` | The four studios with their registered state and project counts |
| `/graph/`, `/activity/` | Honest "not built yet" pages |
| `/home`, `/projects`, … | `308` to the trailing-slash route |
| `/frige/`, `/seaxneat/` | Proxied to the active studios on loopback |
| `/eostre/`, `/woden/` | Deferred studio pages in the same shell |
| `/texgraph/`, `/screenlab/`, `/novelgraph/` | `308` compatibility redirects |
| `/design-system/…` | `@stex/design-system` `src`, `fonts`, `brand`, `icons`, `specimen` folders only |
| `/media/…` | Splash, masthead, and studio-emblem derivatives (Git LFS); byte ranges supported |
| `POST /api/igor/turn` | Relays one Igor turn to the inference service (see below) |
| `/api/applications` | The versioned application registry |
| `/api/books…` | Legacy routes; do not extend (see root `AGENTS.md`) |

```powershell
corepack pnpm dev:pantheon          # http://127.0.0.1:4300/ (STEX_PANTHEON_PORT)
corepack pnpm run test:pantheon
corepack pnpm verify:splash         # browser checks; need Chrome or Edge
corepack pnpm verify:home
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
Graph, and Activity.

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
- **Igor** is the user-facing name of the STEX assistant (the Hermes layer
  internally). The Ask box posts to `POST /api/igor/turn`. Pantheon's server
  adds the shared secret and calls the inference service with
  `stex.hermes.turn.v1` (product `pantheon`, operation `conversation`). Every
  reply states whether it was simulated ("Simulated reply · fake transport");
  only a reply that reports the `fake` transport is called simulated.
  Turns are bounded: 2,000 characters per message and 10 earlier messages
  (the page keeps no more), 96 KB per request counted in bytes, and a 20-second
  timeout. The oldest context is dropped until the conversation fits 20 KB,
  under the inference service's own limit, so a long chat never stops working.
  Nothing is stored.
- **Only Pantheon's own pages can use Igor.** The endpoint requires a JSON
  body, a loopback `Host` (no DNS rebinding), and no cross-site `Origin` or
  `Sec-Fetch-Site`. Other websites therefore cannot spend the shared secret.
  Failures are named: `UNCONFIGURED`, `UNAVAILABLE`, `TIMEOUT`, `UNAUTHORIZED`,
  `CANCELLED`, `MALFORMED_RESPONSE`, `UPSTREAM_ERROR`, `INVALID_REQUEST`,
  `FORBIDDEN`.

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
- `verify:home` starts an isolated stack with disposable data: real inference
  (fake transport), real Frige with a synthetic book, and a labelled Seaxneat
  stub. Across 9 viewports it checks overflow, the masthead's share of the
  viewport, the face, fingertips, and sun staying visible, the brand never on
  visible art, and stray "null" text. It also checks project order, status
  text and links, studio counts, the Projects table, a studio that is down,
  an Igor round trip and its label, keyboard order, and motion.

## Settings

| Variable | Purpose |
| --- | --- |
| `STEX_PANTHEON_PORT` | Port (default 4300) |
| `STEX_FRIGE_URL`, `STEX_SEAXNEAT_URL` | Studio origins to proxy (loopback HTTP only) |
| `STEX_INFERENCE_URL`, `STEX_INFERENCE_SHARED_SECRET` | Igor's inference service and its shared secret; without a URL, Igor reports `UNCONFIGURED` |
| `STEX_FRIGE_BOOKS_DIR` | Books for the legacy `/api/books` routes |

The legacy aliases `STEX_LAB_PORT` and `STEX_BOOKS_DIR` are fallbacks.
`corepack pnpm dev:alpha` sets all of these for the local stack.
