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
| P02 | Command-center masthead: controlled crop of P01 | WebP/AVIF | Planned (command center) |
| P03 | Pantheon emblem: hairline engraved cross-star, plus small variant | SVG | Recorded |
| P04 | Laurel rule ornament | SVG | Recorded |
| P05 | Pantheon wordmark (outlined, for contexts without web fonts) | SVG | Planned |
| P06 | Compact wordmark | SVG | Planned |
| P07 | Favicon | SVG | Recorded |
| P08 | Open Graph image, 1200×630 | PNG/WebP | Later |
| P09 | Light-engraving texture (rare institutional use) | PNG/WebP | Later |
| P10 | Splash animation | MP4 master; AV1 WebM and H.264 MP4 derivatives | Recorded |

### Reference comps (R)

| ID | Asset | Status |
| --- | --- | --- |
| R01 | Splash entrance panel comp (wordmark, star, laurel, tagline, buttons) | Recorded; reference only, never shipped |

### Studio identities (F, S, E, W)

For each studio, three assets from one source design: **04** primary emblem
(SVG), **05** small icon (simplified SVG), **06** identity illustration
(transparent PNG/WebP) — F04–F06, S04–S06, E04–E06, W04–W06. Planned with the
command center.

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

### Hermes and User Graph (H, G)

H01 Hermes emblem, H02 compact Hermes mark, H03 agent status indicators
(CSS/vector); G01 User Graph emblem, G02 empty-graph illustration, G03
relationship legend. Agents get no mythological portraits: the roster is an
operational system, not a cast of characters.

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
  `frige`, `seaxneat`, `eostre`, `woden`, `hermes`, `graph` (ASCII `eostre`;
  the interface shows Ēostre).
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

## Pipeline: splash media

```powershell
corepack pnpm assets:splash   # requires ffmpeg and ffprobe on PATH
```

`scripts/assets/build-splash.mjs` regenerates every P01 and P10 derivative and
records it in the manifest. Recipe, with the measurements behind it:

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
