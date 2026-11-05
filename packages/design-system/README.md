# @stex/design-system

The shared STEX interface foundation, delivered as plain CSS, self-hosted
fonts, and SVG marks. No build step is needed to consume it, and React,
vanilla, and server-rendered pages use the same class names. The doctrine it
implements is [docs/DESIGN-SYSTEM.md](../../docs/DESIGN-SYSTEM.md); agent rules
are in [AGENTS.md](AGENTS.md).

| Path | Contents |
| --- | --- |
| `src/stex.css` | Entry point: declares the layers and imports everything below |
| `src/tokens.css` | Palette, role tokens, type, spacing, geometry, motion; `[data-stex-app]` accents |
| `src/base.css` | Zero-specificity defaults scoped to `[data-stex-app]`: colours, sans, box sizing, focus ring (no global motion or typography rules) |
| `src/components.css` | `stex-button`, `stex-frame`, `stex-wordmark`, `stex-emblem`, `stex-laurel`, `stex-rule`, `stex-meta`, `stex-visually-hidden` |
| `src/fonts.css` | `@font-face` for Cormorant Garamond, EB Garamond, Inter, IBM Plex Mono |
| `fonts/` | WOFF2 files (Fontsource 5.3.0 builds, Latin and Latin Extended-A) and their OFL licences |
| `brand/` | P03 emblem (and small variant), P04 laurel, P07 favicon, H01 Igor emblem — recorded in `assets/manifest.json` |
| `icons/` | Functional icons vendored from Lucide (`lucide-static@1.61.0`, ISC, `LICENSE-lucide.txt`): `book-open`, `code-xml`. Add an icon only when a screen uses it. |
| `specimen/` | Specimen page proving tokens, type roles, controls, and all five accents |
| `test/` | Token, contrast, status-distinctness, and font-coverage checks |

## Using it

```html
<html lang="en" data-stex-app="frige">
<link rel="stylesheet" href="/design-system/src/stex.css">
```

Serve the package from the application's own origin. Pantheon maps
`/design-system/*` to the package's `src`, `fonts`, `brand`, and `specimen`
folders only (see `apps/pantheon/server.mjs`); a Vite application imports
`@stex/design-system/stex.css` and lets the bundler resolve the font and brand
URLs. Add `"@stex/design-system": "workspace:*"` to the consuming package.

Write application CSS unlayered (or in a layer declared after
`stex.components`) so it always overrides the shared layers. Use role tokens
(`--stex-surface`, `--stex-text-muted`, `--stex-border-control`, …); palette
tokens exist to define roles.

## Checks

```powershell
corepack pnpm run test:design-system
```

The tests fail when a palette value drifts from the doctrine, a text, accent,
action, or status colour falls below 4.5:1 on any surface, a control border,
frame, or focus colour falls below 3:1, a status colour comes within 20 ΔE of
an accent or another status, an application scope loses its accent, or a font
file or the Ē (U+0112) range goes missing. View the specimen at
`http://127.0.0.1:4300/design-system/specimen/` while Pantheon runs.

## Fonts

| Family | Package | Files |
| --- | --- | --- |
| Cormorant Garamond | `@fontsource-variable/cormorant-garamond@5.3.0` | roman, weight 300–700 |
| EB Garamond | `@fontsource-variable/eb-garamond@5.3.0` | roman and italic, weight 400–800 |
| Inter | `@fontsource-variable/inter@5.3.0` | roman, weight 100–900 |
| IBM Plex Mono | `@fontsource/ibm-plex-mono@5.3.0` | 400 roman |

Files are vendored, not installed, so pages work offline and the served URLs
stay stable. To update, take the WOFF2 files and `LICENSE` from the new
package versions and update the table. Add a cut (for example Inter italic)
only when a screen uses it.
