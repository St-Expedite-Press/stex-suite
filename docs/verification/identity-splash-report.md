# Identity foundation and splash — verification report

**Milestone:** Identity Foundation and Splash, authorised by the project owner
on 2026-11-05. **Base revision:** `9b6804f` (uncommitted owner changes to
`README.md`, `docs/DEVELOPER-GUIDE.md`, `package.json`, and
`scripts/check-prereqs.mjs` were built on, as agreed).

## Scope delivered

| Item | State |
| --- | --- |
| Brand book, interface charter, and asset book ingested into tracked docs | Implemented |
| `@stex/design-system`: tokens, fonts, components, brand marks, specimen | Implemented and tested |
| Asset storage (Git LFS), manifest, naming convention, verifier | Implemented and tested |
| Splash media pipeline (seamless loop, AV1 + H.264, WebP stills) | Implemented and measured |
| Pantheon server: MIME types, byte ranges, ETag, `nosniff`, `/design-system/`, `/home` | Implemented and tested |
| Splash at `/`; interim command center at `/home/`; deferred pages restyled | Implemented and tested |
| Accounts and authentication | Not implemented (Sign in is a local entry) |
| Frige and Seaxneat adoption | Not started (recorded as a conflict in STATUS) |

## Source ingestion

The scratch folder `front-end-dev/` was the only copy of these sources.
Each file has a tracked destination; the copies match the originals byte for
byte (SHA-256).

| Source | Destination | SHA-256 |
| --- | --- | --- |
| `AGFENTS.md` | `packages/design-system/AGENTS.md` (+ `CLAUDE.md` shim; routed from root `AGENTS.md`) | edited for the real repository |
| `style.md` | `docs/DESIGN-SYSTEM.md` (Doctrine v1.1) | edited: preamble and mockup commentary removed |
| `image-asset.md` | `assets/README.md` + `assets/manifest.json` | edited: third-party image links not retained |
| `pantheon_v2_subtle_s27.mp4` | `assets/masters/pantheon/pantheon-splash-loop.mp4` (P10) | `4f0424f4…f08888f` (identical) |
| `2904b63b-ec96-4932-8c17-0c29e2d6cb80.png` | `assets/reference/pantheon-splash-panel-comp.png` (R01) | `b4f5dc34…cb75a3` (identical) |
| — | `assets/masters/pantheon/pantheon-splash-still.png` (P01) | frame 24 of P10, lossless |

The reference image links in `image-asset.md` pointed to temporary proxy
copies of third-party stock and portfolio pages. They were replaced with
written art direction rather than kept as references.

## Measurements behind decisions

| Question | Evidence | Decision |
| --- | --- | --- |
| Where can the panel sit without breaking the narrative? | Frame-difference motion energy per candidate slot (frame mean 57.7): lower right 26.7, lower centre 29.7, upper left 41.2, right middle 112.8; gaze line from the seated head (0.245, 0.555) to the celestial face (0.745, 0.162) | Lower right. Hard limit: artwork y ≥ 0.52, x ≥ 0.42 |
| Does the source loop? | Last→first SSIM 0.894 vs median frame step 0.993 | Blend the last 24 frames into source frames 0–23; output ends on frame 23 and restarts on frame 24 (both identities SSIM 1.000) |
| Which AV1 settings? | CRF 38 with the temporal filter on smoothed the engraved hatching; CRF 42 with the filter off kept the texture at 2.05 MB (1920w) | CRF 42, `enable-tf=0`, 10-bit |
| AVIF or WebP stills? | 1920w: AVIF 405 KB vs WebP 383 KB at trial settings | WebP only |
| Which serif? | Rendered against R01: Cormorant matches the display caps; its italic thins at 21 px, where EB Garamond holds | Cormorant for display ≥ 28 px; EB Garamond for text serif and italics |
| Emblem form | The first tapered four-point star read as the generic AI sparkle | Redrawn as a hairline engraved cross-star |
| Palette contrast | Every text and accent colour ≥ 4.7:1 on all surfaces; Engraving Slate ≤ 2.9 and Oxidized Copper ≤ 2.6 | The two failing colours are decoration-only tokens |

## Commands and results

| Command | Result |
| --- | --- |
| `corepack pnpm test` (baseline, before changes) | Pass. Pantheon 5, Frige 42, inference 18, Seaxneat 8, Hermes 2, knowledge 2 |
| `corepack pnpm test` (after review fixes) | Pass, 0 failures, 93 tests. Assets 3, design system 8, Pantheon 9, Frige 43, inference 18, Seaxneat 8, Hermes 2, knowledge 2 |
| `node --check` on every touched module | Pass |
| `git diff --check` | Clean |
| `corepack pnpm check:prereqs` | All required, recommended, and optional tools found |
| `corepack pnpm assets:splash`, run twice | 9 derivatives, all within budget; all 9 hashes identical across the two builds |
| `corepack pnpm verify:splash` (Chrome 156.0.8078.80, headless) | Pass, 0 failures at 15 viewports (details below) |
| `corepack pnpm dev:alpha` on ports 4500/4510/4520/8150 (the default ports were held by another running stack) | `/` 200, `/home` 308 → `/home/` 200, `/frige/` and `/seaxneat/` proxied 200, `/eostre/` and `/woden/` deferred 200, `/texgraph/` 308 → `/frige/`, specimen 200, `image/svg+xml` favicon, MP4 byte range 206. Frige `runtime-config.js` returns `STEX_SHELL_URL="/home/"` |

### Browser verification (`verify:splash`)

Every viewport passed:

- no horizontal overflow;
- the display font loaded;
- the Sign in target is at least 44 px and **visible without scrolling**;
- the seated head, celestial face, and reaching hand stay inside the visible
  artwork.

In overlay mode the panel stays clear of both figures and the gaze line,
inside the hard limit. In split and stacked modes it never overlaps the art.
The list includes real browser windows (screen size minus browser chrome),
which are wider than 16:9 and leave the least room under the artwork.

| Viewport | Mode | Panel in artwork coordinates `[x0, y0, x1, y1]` | Share inside the preferred zone |
| --- | --- | --- | --- |
| 1920×1080 | overlay | 0.730, 0.590, 0.960, 0.960 | 1.00 |
| 1920×969 | overlay | 0.730, 0.570, 0.960, 0.897 | 1.00 |
| 1536×730 | overlay | 0.730, 0.586, 0.960, 0.865 | 1.00 |
| 1440×789 | overlay | 0.727, 0.535, 0.960, 0.944 | 1.00 |
| 1366×657 | overlay, emblem dropped | 0.714, 0.544, 0.960, 0.872 | 1.00 |
| 1280×689 | overlay | 0.698, 0.568, 0.960, 0.934 | 0.99 |
| 1920×640 | overlay, compact | 0.730, 0.544, 0.960, 0.711 | 1.00 |
| 2560×1080 | overlay | 0.783, 0.559, 0.963, 0.808 | 1.00 |
| 1024×768 | overlay | 0.599, 0.620, 0.845, 0.960 | 0.59 |
| 900×720 | overlay | 0.561, 0.612, 0.823, 0.960 | 0.47 |
| 1280×600, 844×390 | split | beside the art | — |
| 768×1024, 390×844, 320×568 | stacked | below the 16:10 art band | — |

Motion, at 1440×900:

- The 1920w AV1 source played and faded in.
- The loop wrapped at 11.04 s.
- Tab order was Sign in, then Pause motion, both with a solid focus ring.
- Enter on the toggle paused the loop, stored `off`, and stayed paused after reload.
- With reduced motion, the video stayed at `readyState` 0 with **zero** loop requests, and the toggle offered Play motion.
- With JavaScript disabled, the still image rendered, the toggle stayed hidden, and Sign in linked to `/home/`.

Screenshots were reviewed at 1920×1080, 1366×768, 1366×657, 1920×640,
1280×600, 1024×768, 844×390, and 390×844. Two craft defects the author found
were fixed and re-verified: the emblem hairline was too thin to read at
52 px, and the laurel was too small at 30 px.

## Independent review

One round by a separate read-only reviewer agent. It reported 1 blocker, 5
should-fix items, and nits, and found no path-traversal or
counterfeit-authentication issues. Each item was confirmed against the code
before it was fixed, and verification was re-run from the affected tier
upward. One of the two allowed review rounds was used.

| Finding | Fix |
| --- | --- |
| **Blocker.** `core.autocrlf=true` would check out the brand SVGs with CRLF, breaking their manifest checksums on every Windows clone | `.gitattributes`: `packages/design-system/brand/*.svg text eol=lf`. Proven in a scratch clone: sizes unchanged after commit and checkout |
| `pipe()` leaked file handles on aborted range requests and had no read-error handler | `stream.pipeline`. A new test aborts a stream mid-transfer and then checks the server still answers |
| In real wide browser windows (1366×657, 1920×640) the panel overflowed its region and covered the celestial figure | Reproduced with the new viewports, then fixed: the panel drops the emblem, then the rule, by container height, with smaller minimums |
| Sign in was below the fold on short landscape screens (1280×600, 844×390), and the new gate also caught 320×568 | New split layout, tighter spacing under 360 px, and a verifier gate |
| The toggle read "Pause motion" when autoplay was refused | A `NotAllowedError` now shows Play motion without storing a choice. A stored "on" yields to reduced motion, and a choice survives blocked storage |
| A layered `!important` reduced-motion rule would have frozen motion inside application content | Removed; each component handles its own motion. A test forbids `!important` and `@media` in `base.css` and requires `:where([data-stex-app])` scoping |
| Nits | `bytes=5-3` is now ignored (200); focus follows nested studio scopes; `bitexact` muxing; `aria-describedby` on Sign in; charter gate 4 and Pantheon README wording corrected; Frige's default `/home/` covered by a new test |

## Limitations

- Browser evidence comes from headless Chrome only. Safari (AV1 → H.264
  fallback, which needs byte ranges) and Firefox were not run.
- At 4:3 and in the phone art band, the celestial figure's outstretched right
  hand is cropped by the cover fit. The face, the reaching hand, and the gaze
  are kept.
- The masters are 1920×1080 with no higher-resolution original, so larger
  screens upscale the artwork.
- `/home/` is an interim studio list, not the real-data command center.
- The EB Garamond Latin Extended file (114 KB) loads for the single Ē on
  `/home/`; subsetting is possible later.
- `hermes/AGENTS.md` has no `CLAUDE.md` shim (pre-existing; outside this
  milestone).
- Nothing was committed or pushed. The LFS quota on the hosting account was
  not checked.
