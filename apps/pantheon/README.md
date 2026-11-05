# Pantheon

The STEX loopback shell: the public splash, the command center, and a
same-origin proxy to the studios. Pantheon owns no product state.

| Route | Behaviour |
| --- | --- |
| `/` | Public splash (`public/index.html`) |
| `/home/` | Interim command center: the four studios, labelled Open or Deferred as registered (static page; `/home` redirects) |
| `/frige/`, `/seaxneat/` | Proxied to the active studios on loopback |
| `/eostre/`, `/woden/` | Honest deferred pages |
| `/texgraph/`, `/screenlab/`, `/novelgraph/` | `308` compatibility redirects |
| `/design-system/…` | `@stex/design-system` `src`, `fonts`, `brand`, `specimen` folders only |
| `/media/…` | Splash derivatives (Git LFS); byte ranges supported |
| `/api/applications` | The versioned application registry |
| `/api/books…` | Legacy routes; do not extend (see root `AGENTS.md`) |

```powershell
corepack pnpm dev:pantheon          # http://127.0.0.1:4300/ (STEX_PANTHEON_PORT)
corepack pnpm run test:pantheon
corepack pnpm verify:splash         # browser check; needs Chrome or Edge
```

## Splash

The ceremonial entrance: the P10 loop over the P01 still, with a live HTML
panel (emblem, wordmark, laurel rule, tagline, **Sign in**). Design rules are
in [docs/DESIGN-SYSTEM.md](../../docs/DESIGN-SYSTEM.md); assets and their focal
regions are in [assets/README.md](../../assets/README.md).

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
- **Motion.** The page loads only the still image. `splash.js` starts the loop
  unless the visitor prefers reduced motion, has data saver on, or paused it
  earlier (the choice is kept in `localStorage`, `stex.splash.motion`). It
  pauses when the tab is hidden or the art is off-screen. **Pause motion /
  Play motion** is always available. Without JavaScript the still and the
  Sign in link still work.
- **Serving.** Static files revalidate by ETag, honour single byte ranges
  (Safari needs them to play video), and send `nosniff`.

`corepack pnpm verify:splash` drives an installed Chrome or Edge over the
DevTools protocol with no extra dependencies. It covers 15 viewports from
320×568 to 2560×1080, including real browser windows such as 1366×657 and
1280×689, and checks:

- the panel against the recorded focal regions;
- the display font loading, the Sign in target size, and whether Sign in is
  visible without scrolling;
- that there is no horizontal overflow;
- loop playback and wrap, keyboard order and focus;
- pausing and whether that choice is remembered;
- that reduced motion fetches no video;
- the no-JavaScript fallback.

It writes screenshots and `report.json` to the system temp folder, or to
`--out <dir>`.

## Settings

`STEX_PANTHEON_PORT` (default 4300), `STEX_FRIGE_URL` and `STEX_SEAXNEAT_URL`
(loopback HTTP origins only), and `STEX_FRIGE_BOOKS_DIR`. The legacy aliases
`STEX_LAB_PORT` and `STEX_BOOKS_DIR` are fallbacks.
