# D4 — Frige design-system adoption

**Status:** complete locally; not pushed. **Base:** `1b20534`.
**Scope:** `apps/frige` interface and server static routes, the asset
manifest and pipeline, and `verify:frige`. No manuscript, typesetting, proof,
API, or stex-igor file changed.

## What changed

- **Design system.** Frige depends on `@stex/design-system` (`workspace:*`)
  and serves only its `src`, `fonts`, `brand`, and `icons` folders under
  `/design-system/`. Pages set `data-stex-app="frige"` (Dusty Garnet accent)
  and load `stex.css` first. `living.css`, `palette.js`, and
  `startFrigePalette()` are removed; `style.css` and `lobby.css` use role and
  status tokens only.
- **Masthead.** The project library has the full P11/P02 masthead; the
  workstation a compact 88 px one. `masthead.js` follows Pantheon's motion
  policy (the `stex.pantheon.motion` preference, reduced motion, Save-Data,
  an always-present pause/play control). Frige serves its own byte-identical
  copies of the masthead media and F04 emblem; it never reads Pantheon's files.
- **Layout.** The `min-width: 960px` overflow is gone. Three columns at
  1024 px and wider; 640–1023 px puts the contents tree in a modal drawer
  (scrim, Escape, focus return, covered panes inert); below 640 px one view
  at a time (Contents, Editor, Proof). Every element ID the scripts use is
  kept. Preflight items carry a written status, not colour alone.
- **Static files.** A new `staticFile()` serves interface files with an ETag,
  `no-cache`, `nosniff`, and single byte ranges (for video), and refuses
  anything but a regular file. API responses, proof PDFs, and the pdf.js
  files keep their previous caching.
- **Assets.** Manifest derivatives may carry `copyOf`; `test:assets` fails
  when a copy's hash, size, codecs, or file name drift from its source.
  `assets:build` re-copies and re-records Frige's copies (syntax-checked only;
  FFmpeg was not run).

## Verification

| Check | Result |
| --- | --- |
| `node --check` on touched modules; `git diff --check` | Clean |
| `test:design-system` | 8 pass |
| `test:assets` | 4 pass (1 new: copy drift) |
| `test:pantheon` | 12 pass |
| `test:frige` | 47 pass, 0 skipped (3 new: design-system route and traversal refusals, media bytes and ranges, page markup and references) |
| `corepack pnpm test` | All suites pass |
| `verify:frige` (Chrome) | Pass at 390, 768, 1024, 1280, and 1440 px, standalone and through Pantheon's `/frige/` mount: no overflow, masthead still and motion control, reduced motion keeps the still, accent and fonts from the design system, no control under 40 px, keyboard focus visible, drawer and phone views |
| `verify:home` | Pass (it mounts Frige) |
| `git status -- apps/frige/books` | Clean |

## Independent review

A separate reviewer read the diff and probed a live server with 31 edge-case
requests (traversal, encodings, device names, ranges, ETags, the mount). No
blocking defects. Fixed: the NTFS `::$DATA` alias on Windows (paths with `:`
are refused), the tablet drawer is now modal (`inert` on covered panes), and
the skip link shows the editor first on a phone. Open, low: `If-Range` is not
honoured and `If-None-Match` lists never match — shared with Pantheon's
server, so both should change together.

## Limits

- Conversation content (messages, change and diff cards, prompts, artifacts)
  was restyled but not rendered in a browser, because no inference ran. A
  typeset proof was not viewed in the restyled viewer, though the proof tests
  compile PDFs.
- Chrome only; Safari, Firefox, real touch devices, and screen readers were
  not run. Composed colour pairs (for example text on the 20% garnet row
  tint) have no automated contrast check.
- `packages/design-system/AGENTS.md` still calls `living.css`/`palette.js`
  legacy pending migration. That file is mirrored into stex-igor, which D4
  must not modify, so the line is updated with the next stex-igor sync.
- The motion policy now exists in three places (Pantheon, Igor, Frige).
