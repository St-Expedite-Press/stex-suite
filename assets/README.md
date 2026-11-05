# STEX brand assets

A deliberately small library of authored artwork: a recognisable identity
without turning working studios into galleries. The user should recognise
Pantheon through typography, palette, framing, and illustration technique even
when the celestial figure is absent. Visual rules are in
[docs/DESIGN-SYSTEM.md](../docs/DESIGN-SYSTEM.md); this file covers the
inventory, naming, storage, and production pipeline.

Plan for roughly 40–50 assets over time; 12–15 complete the first Pantheon
release. Never generate unrelated artworks to fill space.

## Art direction

- Engraved linework with visible hatching and contour, deep indigo-black
  shadow, warm parchment and ochre highlights, muted studio accents, minimal
  background ornament.
- Blake's formal intelligence — figures at different scales, light against
  darkness, nature as force, negative space — not an inventory of suns,
  angels, wings, and sacred geometry.
- One master per subject; crops and small variants derive from it.
- No generated lettering, controls, or interface text inside images. All text
  ships as live HTML.
- Studio emblems form one authored family:
  - **Frige** — an open book or composed page in fine engraved line.
  - **Seaxneat** — a drafting instrument, compass, or architectural
    construction, not code brackets.
  - **Ēostre** — a printmaker's plate, rising sun, or botanical engraving.
  - **Woden** — a raven, branch, or restrained mythological sign.

## Inventory

Status is **recorded** (in `manifest.json` and verified), **planned**, or
**later** (not needed before the command center).

### Pantheon institutional (P)

| ID | Asset | Format | Status |
| --- | --- | --- | --- |
| P01 | Splash still: seated youth, tree, river, mountains, celestial figure | PNG master, WebP derivatives | Recorded |
| P02 | Command-center masthead still: frame 24 of P11 | PNG master; derivatives with the command center | Recorded |
| P03 | Pantheon emblem: hairline engraved cross-star, plus small variant | SVG | Recorded |
| P04 | Laurel rule ornament | SVG | Recorded |
| P05 | Pantheon wordmark (outlined, for contexts without web fonts) | SVG | Planned |
| P06 | Compact wordmark | SVG | Planned |
| P07 | Favicon | SVG | Recorded |
| P08 | Open Graph image, 1200×630 | PNG/WebP | Later |
| P09 | Light-engraving texture (rare institutional use) | PNG/WebP | Later |
| P10 | Splash animation | MP4 master; AV1 WebM and H.264 MP4 derivatives | Recorded |
| P11 | Command-center masthead animation: the celestial figure reaching for the sun, in a 3.18:1 band | MP4 master; derivatives with the command center | Recorded |

**Approved exception.** The doctrine asks for the masthead to be a crop of the
splash master. The owner chose a separate panoramic render (P11) instead, on
2026-11-05. It shares the splash's figure, palette, and engraving, so the
family resemblance holds; future derived art should still come from P01 or
P11 rather than new scenes.

### Reference comps (R)

| ID | Asset | Status |
| --- | --- | --- |
| R01 | Splash entrance panel comp (wordmark, star, laurel, tagline, buttons) | Recorded; reference only, never shipped |
| R02 | Command-center comp (masthead, Continue Working, assistant box, studios, Recent Projects) | Recorded; reference only, never shipped |

### Studio identities (F, S, E, W)

For each studio, three assets from one source design: **04** primary emblem,
**05** small icon (simplified SVG), **06** identity illustration
(transparent PNG/WebP) — F04–F06, S04–S06, E04–E06, W04–W06.

| ID | Emblem | Status |
| --- | --- | --- |
| F04 | Frige: open book | Recorded |
| S04 | Seaxneat: drafting compass on a set square | Recorded |
| E04 | Ēostre: sun rising over clouds | Recorded |
| W04 | Woden: raven beside an oak branch | Recorded |

The four emblems were carved out of R02 at the owner's direction (2026-11-05).
Each has a transparent background, colour un-blended from the comp's dark
ground, and published at native width and 2x as WebP. They are raster rather
than SVG because their tonal engraving is the point; the provenance notes
record each crop box and the method. Dark shading becomes transparent, so use
them on dark surfaces only. The 05 small icons and 06 illustrations are still
planned.

### Studio illustrations (later library)

| Studio | 01 Landing | 02 Empty state | 03 Process emblem |
| --- | --- | --- | --- |
| Frige (F) | Publishing cover engraving | Empty manuscript library | Proof / press |
| Seaxneat (S) | Architectural construction engraving | No project selected | Execution / verification |
| Ēostre (E) | Printmaker's plate engraving | Empty canvas | Registration / halftone diagram |
| Woden (W) | Narrative / woodland engraving | Empty story world | Narrative relationship |

Frige stays typographic (no image behind manuscript text); Seaxneat is the
least pictorial (code, previews, and diffs are never decorated); Ēostre needs
little ornament because it shows user imagery.

### Igor and User Graph (H, G)

The assistant is called **Igor** in the interface (Hermes internally), so its
files use the owner `igor`.

| ID | Asset | Status |
| --- | --- | --- |
| H01 | Igor emblem: ring around a unicursal hexagram, redrawn as SVG from R02 (`packages/design-system/brand/igor-emblem.svg`) | Recorded; owner-approved exception to the occult-symbol rule |
| H02, H03 | Compact Igor mark; agent status indicators (CSS/vector) | Planned |
| G01–G03 | User Graph emblem, empty-graph illustration, relationship legend | Planned |

Agents get no mythological portraits: the roster is an operational system,
not a cast of characters.

### Not in this library

- **Functional icons** come from one consistent vector set (Lucide, ISC), not
  commissioned art. Vendor only the icons a screen uses.
- **Project thumbnails** are derived from real project content (Frige
  covers and proofs, Seaxneat screenshots, Ēostre artwork) through a thumbnail
  pipeline with fallback states. Demonstration fixtures are clearly labelled
  synthetic data.

### Production batches

- **A — Pantheon launch:** splash art and motion, masthead crop, emblem,
  wordmarks, favicon, rules, four studio emblems and small icons.
- **B — Studio identities:** landing illustration, empty state, and process
  emblem per studio.
- **C — Extended:** Hermes and User Graph marks, sharing artwork, optional
  animation, project templates.

## Naming

```
<owner>-<subject>[-<variant>][-<width>w].<ext>
```

- Lowercase ASCII, hyphen-separated. `owner` is one of `stex`, `pantheon`,
  `frige`, `seaxneat`, `eostre`, `woden`, `hermes`, `igor`, `graph` (ASCII
  `eostre`; the interface shows Ēostre; `igor` is the user-facing assistant).
- `subject` names the content, not the screen: `splash-still`, `emblem`,
  `laurel`. `variant` names a separately drawn version: `emblem-small`.
- A derivative is its master's name plus its pixel width:
  `pantheon-splash-still.png` → `pantheon-splash-still-1280w.webp`.
- The container implies the codec: `.webm` is AV1, `.mp4` is H.264.
- No UUIDs, dates, `v2`, `final`, `new`, or tool seeds in names; the revision
  and original filename live in the manifest.
- Asset IDs are a family letter and two digits (`P01`). They are permanent and
  never reused.

## Storage

| Content | Location | Git |
| --- | --- | --- |
| Raster and video masters | `assets/masters/<owner>/` | LFS |
| Approved comps and references | `assets/reference/` | LFS |
| Served raster and video derivatives | `apps/<app>/public/media/` | LFS |
| Vector masters (also served) | `packages/design-system/brand/` | Ordinary Git |
| Manifest | `assets/manifest.json` | Ordinary Git |

`.gitattributes` routes the LFS paths; it must exist before a binary is added,
or the file enters ordinary history permanently. Every clone needs Git LFS
(`git lfs install` once per machine; `corepack pnpm check:prereqs` checks
it). A clone without it gets pointer files, which `test:assets` reports by
name. Check the hosting account's LFS storage and bandwidth before pushing
large masters. LFS file locking is not enabled while the library has a single
editor; turn it on (`lockable`) when collaborators join.

## Manifest

`assets/manifest.json` (`stex.assets.manifest.v1`) has one record per asset
ID: `title`, `owner`, `kind`, `revision`; `master` (`path`, `sourceName`,
`sha256`, `bytes`, dimensions); optional `variants`; `provenance` (`author`,
`rights`, `notes`); `usage`; `alt` guidance; `focal` regions for
illustrations; and `derivatives` (`path`, `sha256`, `bytes`, dimensions,
`budgetBytes`, `recipe`).

Focal regions are fractions of the frame, `[x0, y0, x1, y1]` (or a point, or
a segment for `gaze`). For P01/P10, `panelLimit` is the hard boundary for
interface overlays — at or below y 0.52, right of x 0.42 — and `panelZone` is
the preferred, calmest region (measured motion 26.7 against a frame mean of
57.7).

```powershell
corepack pnpm test:assets
```

The check fails on a misnamed file, a checksum or size mismatch, a derivative
over its byte budget, an unresolved LFS pointer, a file under a managed folder
that is not in the manifest, a duplicate ID, or missing provenance or alt
guidance.

## Pipeline

```powershell
corepack pnpm assets:build                     # all jobs; requires ffmpeg and ffprobe
corepack pnpm assets:build masthead emblems    # or named jobs: splash, masthead, emblems
```

`scripts/assets/build-media.mjs` regenerates every derivative from its master
and records it in the manifest, including the exact RFC 6381 codec string of
each video (read from the encoded profile and level). Pages must declare that
string; a Pantheon test compares them. With the same FFmpeg build, output is
bit-exact: unchanged masters reproduce every hash (verified across rebuilds
with FFmpeg 8.1.2, including after the refactor from the earlier splash-only
script). A different FFmpeg build may produce different bytes, so rebuild only
when a master or recipe changes.

### Splash (P10, P01)

Recipe, with the measurements behind it:

- **Seamless loop.** The 12.04 s source does not loop: its last→first frame
  change (SSIM 0.894) is about ten times a normal frame step (median 0.993).
  The build drops the first 24 frames and blends the last 24 toward source
  frames 0–23, reaching 100% on the final frame. The loop therefore ends on
  source frame 23 and restarts on frame 24 — one natural step (identity
  verified at SSIM 1.000). Loop length: 265 frames, 11.04 s.
- **Still.** P01 is source frame 24, the loop's first frame, so the still and
  the motion meet without a jump.
- **AV1 (WebM):** SVT-AV1 CRF 42, preset 4, 10-bit (no banding in the sun
  halo), temporal filter off — it smoothed away the engraved hatching, which
  is the artwork's identity.
- **H.264 (MP4):** CRF 26, High profile, `+faststart`, for browsers without
  AV1 decode (Safari on older hardware).
- **Widths:** 1920, 1280, 960. No audio track, no metadata, and `bitexact`
  muxing, so a rebuild from unchanged masters reproduces every hash and adds
  no new LFS objects (verified across two builds).

| Derivative | Budget | Built |
| --- | --- | --- |
| Loop 1920w WebM / MP4 | 2.5 MB / 3.5 MB | 2.05 MB / 3.40 MB |
| Loop 1280w WebM / MP4 | 1.4 MB / 1.8 MB | 1.04 MB / 1.61 MB |
| Loop 960w WebM / MP4 | 0.8 MB / 1.0 MB | 0.67 MB / 0.99 MB |
| Still 1920w / 1280w / 960w WebP | 420 / 240 / 150 KB | 327 / 192 / 124 KB |

AVIF stills were tested and were no smaller than WebP on the engraved texture,
so only WebP ships. The masters are 1920×1080 and no higher-resolution
original exists, so larger screens see the artwork upscaled.

### Masthead (P11, P02)

- **Same seamless loop** as the splash. The source's last→first change (SSIM
  0.787) is about 15 times a normal step (0.986). Loop length: 168 frames,
  7.0 s. During the 1 s crossfade the fast-moving hair and drapery show a soft
  double exposure; it falls in the left third, which fades out under the
  wordmark.
- **Crop to what is shown.** The art fills rows 220–821 between near-black
  bars. Desktop widths (1920, 1280) use a 6.7:1 stripe around the face, arm,
  and sun (rows 300–587); the 960 phone width uses a 4:1 window (rows
  220–699) for its taller header. Encoding the whole band cost 3.7 MB at 1920.
- **Weighted as editorial.** Dense engraving and fast motion cost more bits
  than the splash, and the masthead loads on every visit. AV1 CRF 48 (H.264 CRF
  28, WebP quality 72). On the stripe, AV1 CRF 48 measured SSIM 0.971 at
  1.55 MB against 0.940 for H.264 CRF 29 at 1.41 MB, so AV1 stays first.

| Derivative | Budget | Built |
| --- | --- | --- |
| Loop 1920w WebM / MP4 | 1.8 MB / 2.0 MB | 1.34 MB / 1.56 MB |
| Loop 1280w WebM / MP4 | 0.9 MB / 1.0 MB | 0.58 MB / 0.65 MB |
| Loop 960w WebM / MP4 | 0.65 MB / 0.75 MB | 0.47 MB / 0.53 MB |
| Still 1920w / 1280w / 960w WebP | 230 / 115 / 110 KB | 196 / 93 / 87 KB |

### Studio emblems (F04, S04, E04, W04)

WebP with alpha at native width and 2x (lanczos), quality 90, 60 KB budget
each; built sizes are 5–48 KB.
