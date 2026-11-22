# Companion code annotations

These annotations cover files whose sources are synchronized to the private
Igor pin or whose data formats require comment-free syntax. Inline
annotations for other first-party code live with their definitions.
[Contribution conventions](../../CONTRIBUTING.md#source-annotations) apply
to both locations.

## Synchronized Pantheon entrance

- `apps/pantheon/public/splash.css` sets the approved entrance layers,
  breakpoint layouts, artwork focus and motion controls. Its historical
  verification-script reference corresponds to `scripts/verify/verify-splash.mjs`.
  Run it through `corepack pnpm verify:splash`.
- `apps/pantheon/public/motion.js` owns shared splash and masthead playback.
  - `remembered()` reads the stored playback choice, returning null when
    browser storage is inaccessible.
  - `remember(value)` saves an explicit playback choice when storage is allowed.
  - `startMotion({ page, video, toggle })` attaches the motion controls and
    visibility listeners. Playback yields to reduced motion and data-saving
    preferences. The visitor can override playback during the visit.
  - `startMotion.preferred()` resolves the session choice, saved choice and
    device preferences in that order.
  - `startMotion.update()` pauses off-screen or hidden artwork and updates
    the control when autoplay is refused.
- `scripts/verify-instructions.mjs` reads tracked or unignored charter files
  from each repository. It checks shim imports, local links and development
  role configuration. It exits on the first invalid assertion. The file has
  no named function definitions.

## Synchronized design system

| Source | Purpose |
| --- | --- |
| `src/stex.css` | Establishes the order of base, token and component layers. |
| `src/fonts.css` | Registers the bundled local font families and weights. |
| `src/tokens.css` | Defines semantic colors, type and spacing plus studio-specific accents. |
| `src/base.css` | Scopes element defaults to a recognized STEX surface. |
| `src/components.css` | Styles reusable native controls and layout components. |
| `specimen/index.html` | Shows the appearance and states across application palettes. |
| `brand/*.svg` and `icons/*.svg` | Hold approved brand and attributed icon vector sources. |
| `package.json` | Declares the workspace package and its owning token tests. |

The design-system token tests check the approved palette, application
accents, contrast ratios and loaded font faces. Their named helpers are:

| Function in `test/tokens.test.mjs` | Purpose |
| --- | --- |
| `declarations(block)` | Reads custom property declarations into a map. |
| `resolve(name, scope)` | Resolves one studio or root token through nested token references. Fails when it is missing. |
| `channels(hex)` | Converts hex bytes to linear sRGB channels. |
| `luminance(hex)` | Computes relative luminance from those linear channels. |
| `contrast(a, b)` | Computes the WCAG contrast ratio of two colors. |
| `lab(hex)` | Converts a color to the CIELAB CIE L\*a\*b\* color space. This mathematical helper is retained in the synchronized test. |
| `lab.f(t)` | Applies the piecewise CIELAB transform to a normalized channel. |
| `deltaE(a, b)` | Measures Euclidean distance between two CIELAB colors. |

## Machine-readable source and configuration

| Files | Owner and purpose |
| --- | --- |
| Root `package.json`, `pnpm-workspace.yaml` and `pnpm-lock.yaml` | Suite development entry points and reproducible workspace dependencies, including the authorized Igor pin for integration. |
| App, knowledge and design-system `package.json` files | The owning component declares its entry points, checks and dependencies. |
| `apps/pantheon/tsconfig.json` | Pantheon type checks for the website workspace and build configuration. |
| `apps/seaxneat/template/package.json` and `pnpm-lock.yaml` | Seaxneat's isolated Next workspace dependencies and scripts. |
| `pyproject.toml`, `.python-version` and `uv.lock` | Platform Python runtime, package entry points and frozen tooling dependencies. |
| `protocol/**/*.json` | Versioned schema, registry and OpenAPI definitions. Each domain README documents its fields and semantics. |
| `assets/manifest.json` | Brand asset ownership, LFS paths, derivative provenance, sizes and digests. |
| `.env.example` | Named configuration settings for authorized local use. |
| `.codex/agents/*.toml` and `.github/workflows/ci.yml` | Development-only roles and trusted verification workflow. |
