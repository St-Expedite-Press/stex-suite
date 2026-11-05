# Command center — verification report

**Milestone:** Pantheon command center, authorised by the project owner on
2026-11-05 (owner decisions: assistant renamed Igor with the mockup emblem;
Igor wired to the fake transport; all five tabs with honest placeholders; a
new project-summary contract; studio emblems carved from the comp). **Base
revision:** `0237eca`.

## Scope delivered

| Item | State |
| --- | --- |
| P11 masthead master, P02 still, R02 comp ingested; four studio emblems carved from R02 (F04, S04, E04, W04); Igor emblem (H01) | Implemented; recorded in `assets/manifest.json` |
| `scripts/assets/build-media.mjs` (splash, masthead, emblems), replacing the splash-only script | Implemented; splash output byte-identical after the refactor |
| Contract `stex.projects.summary.v1` (`protocol/projects`) with Frige and Seaxneat endpoints | Implemented and tested |
| Seaxneat `?project=<id>` opens a project | Implemented; production build passes |
| `/home/`, `/projects/`, `/studios/`, honest `/graph/` and `/activity/`, deferred studios in the shell | Implemented and tested |
| Igor: `POST /api/igor/turn` → `services/inference` (`stex.hermes.turn.v1`) | Implemented on the fake transport; remote Hermes unverified |
| `verify:home` and the shared browser harness | Implemented |

## Measurements behind decisions

| Question | Evidence | Decision |
| --- | --- | --- |
| Where does the narrative sit in P11? | Art band rows 220–821 (3.18:1); face (0.453, 0.435), fingertips (0.83, 0.42), sun x 0.73–0.85, y 0.30–0.50 | Masthead crops to a stripe through face, arm, and sun |
| Can the wordmark sit on the art, as in R02? | Across all frames, Primary Parchment over the stripe reaches only 1.0–2.1:1, except x < 0.10 (6.8:1) and x > 0.90 (5.6:1) | No. The art fades out under the brand on wide screens; the brand gets its own row on narrower ones |
| Does P11 loop? | Last→first SSIM 0.787 vs normal step 0.986 | Same frame-exact crossfade as the splash (168 frames, 7.0 s) |
| What does the masthead cost? | Full band at 1920: AV1 3.7 MB. Desktop stripe (rows 300–587): AV1 CRF 48 = 1.55 MB at SSIM 0.971; H.264 CRF 29 = 1.41 MB at SSIM 0.940 | Crop to what is shown; AV1 CRF 48 first, H.264 CRF 28 fallback. Built: 1.34 MB / 1.56 MB at 1920 |
| Codec strings | The first hand-written strings were wrong for all six masthead files (ffprobe levels 01/04 for AV1, 1E/1F for H.264) | The build records exact strings in the manifest; a test fails if a page differs |
| Lucide version | 1.69.0 was published the same day | Pinned 1.61.0 (2026-10-21); both SVGs read in full |

## Commands and results

| Command | Result |
| --- | --- |
| `corepack pnpm test` | Pass, 0 failures, 99 tests. Assets 3, design system 8, Pantheon 12, Frige 44, inference 18, Seaxneat 10, Hermes 2, knowledge 2 |
| `corepack pnpm build:seaxneat` | Pass |
| `corepack pnpm assets:build` | 26 derivatives, all within budget; splash and masthead bytes identical across rebuilds (FFmpeg 8.1.2) |
| `corepack pnpm verify:home` (Chrome 156, headless) | Pass, 0 failures (below) |
| `corepack pnpm verify:splash` | Pass, 0 failures at 15 viewports after the harness refactor |
| `node --check` on every changed module; `git diff --check` | Pass; clean |

### Browser verification (`verify:home`)

The verifier runs an isolated stack: real inference (fake transport), real
Frige with a synthetic book edited an hour ago, and a labelled Seaxneat stub
with a project building for 10 minutes and one whose build failed 3 days ago.

| Viewport | Masthead art share of height | Still chosen | Brand |
| --- | --- | --- | --- |
| 1920×1080 | 13.9% | 1920w stripe | faded-out zone |
| 1440×789 | 14.2% | 1920w stripe | faded-out zone |
| 1366×657 | 17.0% | 1920w stripe | faded-out zone |
| 1280×689 | 16.3% | 1280w stripe | faded-out zone |
| 1100×700 | 16.0% | 1280w stripe | faded-out zone |
| 1024×768 | 15.6% | 1280w stripe | own row |
| 768×1024 | 11.7% | 960w window | own row |
| 390×844 | 8.5% | 960w window | own row |
| 320×568 | 12.7% | 960w window | own row |

At every viewport there was no horizontal overflow, the face, fingertips, and
sun were inside the masthead, Home was the only current tab, and no stray
"null", "undefined", or "NaN" text appeared.

- **Real data.** Continue working showed "Fixture Site (verification stub)",
  linking to `/seaxneat/?project=fixture-site`, with the Seaxneat accent.
  Recent projects ran in order: Building · 10 minutes ago, Edited 1 hour ago
  (linking to `/frige/?book=fixture-book`), Build failed · 3 days ago. Studio
  counts showed 1 project and 2 projects, and the Projects table had 3 rows.
- **Unavailable studio.** With the stub failing, one note read "Seaxneat is
  not responding…" and the Frige project remained.
- **Igor.** A real round trip through Pantheon and the inference service
  returned the deterministic reply, labelled "Simulated reply · fake
  transport".
- **Keyboard.** Skip to content → STEX Pantheon → Home → Projects → Studios →
  Graph → Activity.
- **Motion.** The 1920w AV1 loop played with "Pause motion" offered. Reduced
  motion made zero masthead loop requests and offered "Play motion".

Defects found by the verifier and screenshots, then fixed:
- the 320 px page overflowed by 35 px (grid panels sized to the input's
  intrinsic width);
- the unavailable note appeared twice;
- a literal "null" rendered under Continue working (`Element.append(null)`);
- Graph and Activity were hidden off-screen on phones.

## Independent review

One round by a separate read-only reviewer agent: no blockers, six should-fix
items, and nits. Each was confirmed against the code, fixed, and re-verified
from the affected tier upward. One of the two allowed rounds was used.

| Finding | Fix |
| --- | --- |
| Igor stopped answering after about 13 turns: the page sent its whole history, and the server rejected anything over 32 KB before trimming it. Multi-byte text could also exceed the inference service's byte budget | The page keeps 10 messages; the server counts bytes, admits 96 KB, then drops the oldest context until it fits 20 KB. A test with ten 2,000-character multi-byte messages still gets an answer |
| A real remote reply naming its own transport would be labelled "simulated" | Only `fake` is labelled simulated; otherwise "Reply from Igor". The static note now reads "Each reply says whether it was simulated" |
| Any website could POST to `/api/igor/turn` (no preflight for `text/plain`), letting it spend paid remote turns once Hermes is configured | JSON body, loopback `Host`, and same-origin `Origin` and `Sec-Fetch-Site` are required; tests cover `text/plain`, a foreign Origin, cross-site fetch metadata, and a rebound Host |
| Frige walked `.git`, so a `git fetch` could read as an edit and use up the entry budget | Every hidden folder and `node_modules` is skipped; files are stat-ed in parallel; the test now includes a newer `.git` file |
| "Yesterday" was shown for anything 12–24 hours old | Under a day is always hours |
| The verifier's brand check could pass without testing position; crops were copied from the build | The page resolves `--brand-inset` and `--clear` to pixels and checks the brand lies between them; crops come from the manifest |
| Nits | `cancelled` replies and body timeouts are named; Seaxneat consumes `?project=` (and says when an id is unknown); the schema allows additive fields and rejects `//` and `..` in `openPath`, as Pantheon does; studio counts show a failure state; the derivative count and bit-exact claim are corrected |

Not changed: the motion preference key moved from `stex.splash.motion` to
`stex.pantheon.motion`, so an earlier pause choice is forgotten once.
`STEX_INFERENCE_URL` is local configuration and is not restricted to loopback,
matching Frige.

## Limitations

- Headless Chrome only; Safari and Firefox were not run.
- Igor uses the deterministic fake transport; remote Hermes is unverified.
- The studio emblems are carved from a 1536-pixel comp; the 2x derivatives are
  upscaled and slightly soft. Their dark shading is transparent, so they suit
  dark surfaces only.
- In the masthead loop's 1 s crossfade, the fast hair and drapery show a soft
  double exposure (in the faded left third).
- The Seaxneat states in `verify:home` come from a labelled stub; the real
  mapping is covered by `test:seaxneat`.
- The registry lists Frige's reference kind as `book` while Frige emits
  `stex://frige/project/…` (recorded in `protocol/projects`).
- Pantheon's legacy `/api/books` routes remain; the new contract makes them
  removable in a later milestone.
- Nothing was committed or pushed.
