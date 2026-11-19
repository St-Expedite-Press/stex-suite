# STEX Pantheon — Interface Engineering Charter

**Scope:** `packages/design-system/`, `assets/`, `apps/pantheon/`, and every
interface change in `stex-igor/apps/igor/`, `apps/frige/`, `apps/seaxneat/`,
`apps/eostre/`, and `apps/woden/`. The root [AGENTS.md](../../AGENTS.md) routes all interface work
here, because a nested charter otherwise applies only to its own folder.

This charter supplements, never replaces, the root charter and the more
specific application charters. When instructions conflict, preserve security,
data integrity, accessibility, and the owning application's behaviour; report
unresolved conflicts rather than silently overriding them. The visual doctrine
is [docs/DESIGN-SYSTEM.md](https://github.com/St-Expedite-Press/stex-suite/blob/main/docs/DESIGN-SYSTEM.md); artwork rules are in
[assets/README.md](https://github.com/St-Expedite-Press/stex-suite/blob/main/assets/README.md).

Paths describing the platform below are stex-suite-relative. In the synced
stex-igor copy, apply the visual rules to its local Igor renderer and use that
repository's [root charter](../../AGENTS.md). The source of this charter and
its shim remains stex-suite; synchronize vendor copies rather than editing
them independently. Codex reviewers are development roles, not Hermes agents.
Python backend and first-class Obsidian integration are root architectural
targets; neither authorizes a UI redesign or backend rewrite during release.
Preserve the approved splash/artwork bytes and motion/responsive behavior.

## 1. Mission

Implement one coherent, production-quality visual language across Pantheon
and its four studios: **Romantic Instrumentalism**, Blakean imagination and
classical editorial typography disciplined by functional modern software
design. The image introduces the system; the system gets out of the way of the
work. Prioritise legibility, authentic project state, task clarity, and direct
manipulation over decoration. A screen must remain effective with all
illustration removed.

Do not redesign workflows to match a screenshot. Do not invent
authentication, operational state, agent actions, or functionality.

## 2. Identities and ownership

| Product | Path | Accent | Domain |
| --- | --- | --- | --- |
| Pantheon | `apps/pantheon` | Antique Ochre `#BA9866` | Public splash, command center, cross-suite navigation, project discovery, account entry points |
| Frige | `apps/frige` | Dusty Garnet `#C58F96` | Publishing, manuscripts, typesetting, proofs |
| Seaxneat | `apps/seaxneat` | Azurite `#8CAEC4` | Software construction, builds, previews, revisions |
| Ēostre | `apps/eostre` | Burnished Amber `#D69B65` | Image and print production — **deferred** |
| Woden | `apps/woden` | Juniper `#A9B998` | Narrative writing, structures, story graphs — **deferred** |

IDs, paths, and the registry (`protocol/applications/registry.v2.json`) stay
ASCII (`eostre`); the interface displays **Ēostre**. Respect compatibility
routes and protocol aliases. Deferred studios render an honest deferred state
until their workflows exist.

## 3. Interface standard (binding)

The interface type is **CSS-first, platform-native web UI**:

- Shared tokens, typography, and components come only from
  `@stex/design-system` (`src/stex.css`). Never duplicate palette values in an
  application. Seaxneat's platform-owned workspace now uses these tokens.
- Plain CSS in cascade layers `stex.tokens, stex.base, stex.components`;
  application CSS stays unlayered so it always wins. No component framework,
  Tailwind, CSS-in-JS, or runtime theme engine. React apps use the same class
  names.
- Identity via `data-stex-app="<id>"` on `<html>`; use role tokens
  (`--stex-bg`, `--stex-surface`, `--stex-text`, `--stex-accent`,
  `--stex-border-control`, `--stex-focus`, …), not palette tokens.
- Native elements first: `<button>`, `<a>`, `<dialog>`, popover, form
  controls. JavaScript only for what HTML and CSS cannot do; every page must
  work without it where its task allows.
- Each application serves the package from its own origin
  (`/design-system/…`), never through another application.
- Engraving Slate and Oxidized Copper fail 3:1 on every surface: decoration
  only, never text, control borders, or focus.
- Base styles are zero-specificity and scoped to `[data-stex-app]`. Never
  style manuscripts, PDF proofs, generated sites, code highlighting, or image
  canvases through global theme rules.
- Add a component to the package only when a real screen uses it, with its
  focus, keyboard, contrast, and reduced-motion behaviour.

## 4. Three registers

1. **Ceremonial** — the public splash and rare entrance screens: approved
   artwork, strong wordmark, sparse real HTML, minimal motion. Never bake text
   or controls into imagery.
2. **Editorial** — Pantheon home, project libraries, settings, studio landing
   screens: flat surfaces, fine rules, disciplined serif/sans hierarchy. The
   command center is sidebar-free by default. A softer "Romantic voice" restyle
   (plates, italic-serif metadata, dissolving art, warm wash) was tried and
   rejected as too sanitary; keep the boxed editorial treatment unless the
   owner asks otherwise.
3. **Instrumental** — editors, code tools, canvases, story graphs: compact,
   predictable controls, task inspectors, persistent context; decoration
   withdraws almost completely.

## 5. Typography and layout

Cormorant Garamond for display at 28 px and above; EB Garamond for serif at
text sizes and all italics; Inter for controls, navigation, metadata, forms;
IBM Plex Mono for code and identifiers. Real italics only. No widely spaced
paragraph text, all-serif controls, or faux-antique lettering. Spacing scale
4/8/12/16/24/32/48/64; 2–4 px radii; 44 px control height. Provide visible
focus, keyboard access, labels, adequate targets, and reduced-motion support.

## 6. Pantheon page architecture

- `/` — public splash: P10 loop over the P01 still, a real HTML entrance
  panel. **Sign in** is a local single-user entry to `/home/`: no credential
  form, no stored session, labelled *Local workspace · single user*. Do not
  add account creation or present the entry as authentication until an
  identity milestone is authorised.
- `/home/` — command center: P11 masthead, tabs (Home, Projects, Studios,
  Igor, Graph, Activity), Continue working, Igor, the four studios, and Recent
  projects. Project data comes only from each studio's
  `stex.projects.summary.v1` endpoint (`protocol/projects`), with honest empty,
  unavailable, and deferred states. Graph renders optional real knowledge
  metadata and relationships; Activity remains "not built yet". Never fill
  either with sample data. No permanent
  sidebar.
- **Igor** is the user-facing name of the assistant; Hermes stays the internal
  name. Igor turns go browser → the Igor application (`stex-igor/apps/igor`, proxied at
  `/igor/`) → `stex-igor/services/inference` only, and every simulated reply is
  labelled. Igor's reference comp is R03 (`assets/reference/pantheon-igor-comp.png`).
- Settings and account controls belong in a user menu or labelled utility
  navigation, not a decorative card.
- Studio homes: project selection/creation and domain tools. Global
  navigation returns to Pantheon without destroying editing state.
- Pantheon progressively owns workspace presentation while engines own state
  and validation. Seaxneat's UI lives in `apps/pantheon/workspaces/seaxneat`
  and uses the common shell at `/workspaces/seaxneat/`; its engine owns Git,
  proposals, builds and preview lifecycle. Frige's library/workstation now live
  in `apps/pantheon/workspaces/frige`, with the shared header and navigation;
  the instrumental view uses a compact header. Igor's private renderer is
  composed through a versioned HTTP descriptor with a compact toolbar and
  explicit project-context consent. See
  [its migration gate](https://github.com/St-Expedite-Press/stex-suite/blob/main/docs/PLATFORM-TRANSITION.md).
  Generated preview documents remain sandboxed outside the trusted UI.

## 7. Artwork

Every brand asset is recorded in `assets/manifest.json` (ID, owner, master,
provenance, usage, alt guidance, focal regions, derivatives, budgets) and
verified by `corepack pnpm test:assets`. Masters are kept separate from
optimised derivatives; binary media lives in Git LFS. Derive crops from the
same master rather than reimagining scenes. SVG for emblems and rules,
WebP/AVIF for illustration, PNG masters. Never use fuzzy generated lettering,
fake controls, or mismatched independently generated studio illustration.
Motion always has a static fallback, honours reduced motion, offers a pause
control, and never autoplays audio.

## 8. Rejection criteria

Reject chatbot-first layouts; fake KPIs, activity, agent counts, or invented
projects; four equal decorative cards to fill space; gradients, glow,
glassmorphism, large pill controls, particle fields, neural networks, the
generic AI sparkle, or gratuitous celestial motifs; stacked gold borders,
laurels, engravings, textures, and glows on every component (the splash panel
is the single sanctioned composite); vague marketing copy; faux-museum,
blackletter, occult, or rune conventions; theatrical animation; fake parchment
behind working documents; illustration that obscures controls, artifacts, or
status. Use domain labels: *Compile proof*, *Review revision*, *Inspect
build*, *Export separation*.

## 9. Workflow and delegation

Observe → Inventory → Plan → Implement → Verify → Critique → Integrate, inside
the root charter's loops and budgets. Before coding, inspect the real routes,
styles, assets, and tests; report current versus target state; preserve
unrelated edits and protected data.

Delegate only independent, non-overlapping scopes — design-system owner,
Pantheon UI owner, asset owner, studio owners, QA/auditor — each with files,
constraints, outputs, checks, and a stop condition. No parallel writers to the
same files. The integrating agent owns the final review and status evidence.

## 10. Implementation order

| Phase | Scope | State |
| --- | --- | --- |
| A | Baseline, tokens, specimen proving all five accents | Done |
| B | Pantheon public entrance (splash) | Done; real identity deferred |
| C | Pantheon command center from real data | Done; Igor on the fake transport |
| D | Frige and Seaxneat adoption without workflow regressions | Frige done (D4); Seaxneat platform workspace in P1 (see STATUS evidence) |
| E | Ēostre and Woden foundations on authentic placeholders | Planned |
| F | Stabilisation: trim, consolidate, compare to approved art | Planned |

## 11. Verification gates

For each meaningful change:

1. The primary task is immediately identifiable; every control does something
   real or is clearly unavailable.
2. Branding, surfaces, type, and studio colour come from shared tokens;
   illustration is not required for comprehension.
3. Desktop, tablet, and phone layouts have no accidental cropping, overflow,
   or unreachable actions (`corepack pnpm verify:splash`, `verify:home`,
   `verify:frige`).
4. Focus, keyboard order, labels, targets, and contrast work; motion respects
   reduced motion. Contrast and token drift: `corepack pnpm test:design-system`;
   keyboard order, focus, and motion on the splash: `corepack pnpm verify:splash`.
5. Routes and navigation work; account and project state are never silently
   simulated.
6. No style leaks into manuscripts, proofs, generated sites, canvases, or
   authored prose.
7. Hierarchy holds at realistic data density and in empty states.
8. Asset sources, derivatives, sizes, and focal points are recorded
   (`corepack pnpm test:assets`).
9. Existing suites and builds pass (`corepack pnpm test`). Report commands
   actually run; never fabricate browser or live-auth evidence.
10. An independent reviewer checks for generic-AI patterns, kitsch,
    inaccurate copy, excess ornament, and needless complexity.

## 12. Definition of done

Done means the UI, documented behaviour, and tests agree. Hand off affected
files, new or changed tokens and assets, browser observations, routes,
accessibility review, test results, and limitations, distinguishing
implemented, mocked, deferred, and unverified. Stop when the scoped interface
and shared contract work; do not build an agent runtime, knowledge graph,
auth backend, or whole application because a screen references one.
