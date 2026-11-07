# STEX design doctrine v1.1 — Romantic Instrumentalism

**Scope:** Pantheon, Frige, Seaxneat, Ēostre, Woden, Hermes interfaces, and
User Graph interfaces. **Authority:** the shared visual standard for STEX
application development. Agent rules for applying it are in
[packages/design-system/AGENTS.md](../packages/design-system/AGENTS.md); the
implementation is [@stex/design-system](../packages/design-system/README.md);
artwork is governed by [assets/README.md](../assets/README.md).

> **Blake supplies the visual imagination. Modernist design supplies the discipline.**

The result should resemble a contemporary publishing house, experimental arts
institution, or precision creative workstation — not a fantasy game interface,
a luxury-brand website, or a GPT wrapper.

**Status.** Implemented and tested: tokens, typography, shared components, the
Pantheon splash (`/`), and the command center (`/home/`, `/projects/`,
`/studios/`, with honest Graph and Activity placeholders). Motion
preferences are honoured per component; the design system applies no global
motion override, so proof viewers, editors, and canvases keep their own. Frige
adopted the system in D4 (tokens, Dusty Garnet accent, masthead, responsive
workstation; see the [D4 report](verification/frige-d4-design-system.md)). Not
yet adopted: Seaxneat still carries its pre-doctrine light theme (see
[STATUS](STATUS.md)); Ēostre and Woden are deferred.

---

## I. Design philosophy

STEX Pantheon is a contemporary creative operating environment whose identity
draws from William Blake, illuminated books, neoclassical typography,
historical engraving, Romantic landscape painting, and the material traditions
of artistic production. These influences shape the visual intelligence of the
platform rather than decorate it.

**Classical identity. Contemporary instruments.** Visionary imagery and
literary sensibility are governed by the typographic, functional, and
structural discipline of a modern workstation.

The platform must avoid three failures:

1. Generic AI-generated web design.
2. Historical pastiche or fantasy kitsch.
3. Beautiful but impractical software interfaces.

Every visual decision must contribute to identity, comprehension, hierarchy,
or function.

## II. The three visual registers

**Ceremonial** — public entry, authentication, rare institutional
presentation. Expressive Blakean landscape and figure illustration, strong
classical lettering, deep atmospheric contrast, restrained engraved framing,
minimal navigation and copy, controlled atmospheric animation. The artwork can
dominate because users are not yet performing complex work.

**Editorial** — Pantheon home, studio home pages, project directories,
settings, account pages, general navigation. Flat disciplined surfaces, clear
typographic hierarchy, restrained classical reference, small purposeful
engravings, significant negative space, thin borders, quiet colour variation,
high usability. Editorial is the default register for Pantheon's shared
interface.

**Instrumental** — editing, composition, coding, image production, narrative
construction. Maximum legibility, task-appropriate density, minimal
illustration, precise interaction, stable tool placement, strong keyboard
support, visually distinct working surfaces.

The closer the user gets to the actual work, the less decorative the interface
becomes. The same language must be identifiable in all three registers
without repeating the same celestial artwork everywhere.

**Register targets.**

- *Splash (ceremonial):* the one sanctioned composite. The entrance panel
  carries frame, emblem, laurel rule, and wordmark together; no other
  component may combine them (see VI.4).
- *Command center (editorial):* artistic presentation takes roughly 15–20% of
  the visible height at most (measured 8.5–17% across verified viewports). The
  masthead plays P11, a panoramic render of the celestial figure the owner
  chose over a crop of the splash master (recorded exception). Light text
  never sits on the visible art: the art fades out under the brand. Studio
  entries carry a modest emblem, a title, a precise descriptor, their real
  state, and a clear navigation affordance.

## III. Shared colour system

All applications inherit the Pantheon material palette. Values are binding and
are checked by `packages/design-system/test/tokens.test.mjs`.

### Foundational surfaces

| Token | Value | Purpose |
| --- | --- | --- |
| Abyssal Ink | `#0B1518` | Primary background |
| Cabinet Black | `#111D20` | Default panel surface |
| Raised Slate | `#19272B` | Elevated content surface |
| Mineral Slate | `#25353A` | Hover and secondary states |
| Engraving Slate | `#4D6268` | Atmospheric and supporting details |

### Typography and institutional colours

| Token | Value | Purpose |
| --- | --- | --- |
| Primary Parchment | `#F0E2C8` | Primary text |
| Secondary Text | `#BFC8C2` | Body support and metadata |
| Muted Text | `#9FA9A5` | Lower-priority text |
| Warm Vellum | `#DBC39B` | Primary actions |
| Antique Ochre | `#BA9866` | Institutional accent |
| Oxidized Copper | `#76503D` | Restrained historical detailing |

### Studio signature colours

| Studio | Signature | Value |
| --- | --- | --- |
| Pantheon | Antique Ochre | `#BA9866` |
| Frige | Dusty Garnet | `#C58F96` |
| Seaxneat | Azurite | `#8CAEC4` |
| Ēostre | Burnished Amber | `#D69B65` |
| Woden | Juniper | `#A9B998` |

A studio may apply its signature to active navigation, selected controls,
specialised tools, small strokes, and focus indicators. Accents must not
become broad background fills. The platform's character comes from
proportion, tone, typography, and composition — not saturation.

### Status colours

Success, warning, error, and information use shared tokens independent of
studio colours, always paired with text or an icon, never colour alone.

| Token | Value | Notes |
| --- | --- | --- |
| Success | `#6CC3A8` | ≥ 20 ΔE (CIELAB) from every accent and status |
| Warning | `#E8C55A` | |
| Error / destructive | `#EF7F72` | |
| Information | `#86A9F5` | |

### Measured contrast

WCAG 2 ratios on the four surfaces (Abyssal Ink, Cabinet Black, Raised Slate,
Mineral Slate):

| Colour | Range | Use |
| --- | --- | --- |
| Primary Parchment | 14.5–10.0 | Text |
| Secondary Text | 10.8–7.4 | Text |
| Muted Text | 7.7–5.3 | Text, control borders |
| Warm Vellum | 10.8–7.5 | Text, primary action (Abyssal Ink label on Vellum: 10.8) |
| Antique Ochre | 6.9–4.7 | Text, frames, focus |
| Studio accents | 8.9–4.7 | Text, focus |
| **Engraving Slate** | **2.9–2.0** | **Decoration only** — never a control boundary or text |
| **Oxidized Copper** | **2.6–1.8** | **Decoration only** |

Darkness is a compositional material, not an excuse for illegibility: test
warm text on muted slate on the real surface.

## IV. Typography

Typography is a primary identity system. Chosen after rendering the candidates
against the approved panel comp (R01):

| Role | Face | Use |
| --- | --- | --- |
| Display serif | Cormorant Garamond (variable) | Wordmarks, page titles, major headings — **28 px and above** |
| Text serif | EB Garamond (variable, real italic) | Studio and project names, italics, serif at text sizes |
| Functional sans | Inter (variable) | Navigation, controls, forms, tables, labels, metadata, notices |
| Technical mono | IBM Plex Mono | Code, terminal output, file paths, identifiers, logs |

Cormorant matches the comp's light, wide, high-contrast capitals but thins out
below display sizes; EB Garamond holds its italic at 18–21 px. All four are
SIL OFL 1.1, self-hosted, Latin plus Latin Extended-A (Ē in Ēostre).

Rules:

1. Serif for identity and hierarchy, not every interface element. Controls use
   the sans.
2. Use actual italic typefaces, never synthetically slanted roman
   (`font-synthesis: none`).
3. No arbitrary letterspacing in paragraphs; widely spaced capitals only for
   brief institutional labels such as the wordmark.
4. Limit display sizes to a coherent scale.
5. Generous line height for prose, compact for data.
6. Never sacrifice clarity to reproduce a historical effect.
7. Preserve application-specific document typography inside creative work.
8. Avoid excessive ornament, distressed lettering, and faux-antique display
   type.

## V. Layout, geometry, and composition

Prefer a clear spatial hierarchy with large, meaningful regions. Pantheon Home
stays sidebar-free by default; studio workspaces may use sidebars, inspectors,
split panes, toolbars, and dockable panels when their functions require them.

- Rectangular surfaces, 2–4 px corner radii, thin quiet borders, few
  overlapping panels, clear alignment, no unnecessary nesting.
- Spacing on a 4 px base: `4 / 8 / 12 / 16 / 24 / 32 / 48 / 64`.
- Coherent content widths, control heights (44 px), and breakpoints.
- Design each page around its primary task. No ornamental header, metric
  card, information block, or sidebar unless it performs a real function.
- Never choose spacing solely to match a generated mockup.

### Rejected direction: "Romantic voice" restyle

On 2026-11-05 the command center was restyled to soften its angularity:
engraved double-rule plates instead of boxes, italic serif for descriptors and
metadata, artwork dissolving into the page, a faint warm light wash, centred
studio entries, and an ornamental rule between sections. The owner judged the
result too sanitary and kept the bolder boxed editorial treatment. Do not
reintroduce these devices as a set without the owner asking for them.

## VI. Avoiding generic AI web design

Mandatory for all Pantheon frontend work.

1. **Reject the GPT-wrapper composition.** Hermes is a shared capability, not
   the template for the platform. Frige looks like a publishing instrument,
   Seaxneat like a serious development environment, Ēostre like an
   image-production studio, Woden like a narrative construction environment.
2. **Reject generic SaaS dashboard conventions:** KPI cards without
   operational relevance, decorative analytics, artificial activity feeds,
   fictional statistics, gradient hero cards, identical repeated tiles,
   excessive rounded rectangles, animated counters, empty balancing panels.
   A sparse interface beats a balanced but meaningless one.
3. **Avoid gradient dependence.** Prefer flat mineral colour, slight tonal
   separation, fine engraved lines, selected illustration, typographic
   contrast, and negative space. Gradients only for actual lighting,
   atmosphere, or ceremonial artwork — never default button backgrounds.
4. **Eliminate decorative redundancy.** Do not combine engraved illustration,
   emblem, gold frame, gradient, shadow, ornament, accent stripe, and animated
   effect on one component. Choose one identifying feature. (The splash panel
   is the single sanctioned exception; see II.)
5. **Use credible, specific content.** Not "unlock your creativity",
   "supercharge your workflow", "unleash the power of AI", "reimagine what's
   possible", "elevate your productivity", or "transform your ideas into
   reality". Prefer *Compile proof*, *Open manuscript*, *Review revision*,
   *Inspect build*, *Export separation*, *Open story graph*.
6. **Reject decorative fake complexity.** No fictitious diagrams, meaningless
   node networks, artificial logs, or invented statistics. Placeholder data is
   labelled during design; production renders real state. A useful empty
   state beats a fabricated busy one.
7. **Avoid indiscriminate AI imagery.** A small library of art-directed
   images, engraved marks, and historical references used consistently.
8. **Keep effects subordinate to purpose.** No glassmorphism, neon borders,
   luminous orbs, particle fields, neural-network backgrounds, infinite
   animated gradients, cursor trails, excessive parallax, or pulsating
   controls. That also excludes the generic four-point "AI sparkle": the
   Pantheon emblem is a hairline engraved cross-star for this reason.
9. **Avoid formulaic component repetition.** Lists for sequences, canvases
   for spatial relationships, tables for comparison, documents for sustained
   reading, cards only for discrete objects that benefit from them.
10. **Prefer authored asymmetry over artificial symmetry** — in page
    composition, never in the behaviour of buttons, fields, or menus.

## VII. Keeping Blakean influence without becoming kitsch

1. **Borrow formal intelligence, not iconography indiscriminately:** light
   against darkness, human figures at different scales, nature as expressive
   force, negative space, fine engraved contour, monumental but controlled
   composition, tension between individual imagination and larger systems.
2. **Distinguish the image from the interface.** Blakean figures belong in
   artworks and selected institutional illustration, never behind editors,
   tables, or forms. The splash may be openly visionary; a code editor stays
   a code editor.
3. **Engraving as material vocabulary.** Fine rules, hatching, stippling, and
   etched contours may shape decorative assets. No noisy overlays on every
   surface; simplify to crisp vectors at small sizes.
4. **Classical motifs sparingly:** small laurel marks, restrained botanical
   engraving, fine architectural rules, inscriptional letterforms, purpose
   designed studio emblems. Nothing appears just to feel antique.
5. **Do not imitate a museum website.** Influence emerges in material,
   proportion, letterform, and image — not obsolete interaction conventions.
6. **Avoid fantasy and occult kitsch:** magic circles, alchemical diagrams,
   glowing runes, arcane terminology, celestial borders, tarot cards,
   pseudo-sacred buttons. *Recorded exception:* Igor's emblem (H01), a ring
   around a unicursal hexagram, was kept at the owner's direction
   (2026-11-05). It is used only beside the Igor label, never as ornament.
7. **Distinguish atmosphere from darkness.** Dark, not uniformly black; keep
   the distinctions between Abyssal Ink, Cabinet Black, Raised Slate, and
   Mineral Slate.
8. **Avoid anachronistic mixing.** Principal references: late-18th and early
   19th-century engraving, classical and neoclassical typography, Romantic
   landscape, contemporary editorial design, precise modern instruments.

## VIII. Components and interaction standards

Shared components (added to the package as screens need them): buttons, text
fields, textareas, menus, tabs, dialogs, tables, lists, breadcrumbs, alerts,
progress states, navigation, empty states, inspector panels, approval
interfaces. Every one supports keyboard use, visible focus, accessible
contrast, adequate targets, and reduced motion.

- **Buttons:** primary uses Warm Vellum (or a tested studio accent); secondary
  uses restrained borders and neutral backgrounds; destructive is
  semantically distinct. No ornamental symbolism for meaning.
- **Forms:** explicit labels, errors next to the control, no placeholder-only
  labels, quiet and legible.
- **Navigation:** global navigation preserves Pantheon identity; application
  navigation may specialise. The user can always tell the current studio,
  project, and working context, and can return to Pantheon without losing
  editing state.
- **Tables and lists:** clear alignment over ornamental rows; do not force
  editorial lists into cards.
- **Igor (the assistant):** an integrated command and conversation capability
  that does not replace specialised interactions. *Igor* is the user-facing
  name; *Hermes* remains the internal layer (`stex-igor/hermes/`, `stex-igor/services/inference`,
  `stex.hermes.turn.v1`). Proposals, pending approvals, running operations,
  and completed tasks are visually distinct, and every simulated reply is
  labelled as simulated.

## IX. Studio-specific design authority

- **Frige — Dusty Garnet.** Publishing, typography, manuscripts, composition,
  proofs. *The editorial atelier.* Strong typographic hierarchy, restrained
  manuscript navigation, excellent reading surfaces; paper-coloured proof and
  document environments are permitted. Decoration never competes with
  manuscript text.
- **Seaxneat — Azurite.** Software construction, code, source control,
  previews, agent-directed development. *The technical instrument and
  architectural drawing.* Dense but disciplined navigation, readable code,
  stable panes, clear execution evidence. Generated websites are never styled
  with Pantheon themes unless explicitly requested.
- **Ēostre — Burnished Amber.** Image production, layers, palettes,
  separations, print preparation. *The printmaker's atelier.* Neutral canvas
  surrounds, precise tools, colour-accurate presentation; the accent never
  contaminates the rendered image.
- **Woden — Juniper.** Narrative creation, characters, scenes, timelines,
  story knowledge. *The literary archive and narrative map.* Readable prose,
  excellent outline navigation, deliberate graph visualisation; no theatrical
  ornament in the writing workspace.

## X. Design review and anti-kitsch audit

Review every major interface against these questions:

1. Can the user identify the primary task immediately?
2. Does the layout reflect the actual information?
3. Is every visible component functionally justified?
4. Would the interface remain coherent without its decorative illustration?
5. Are typography, spacing, and proportions deliberate?
6. Is colour semantic rather than arbitrary?
7. Are illustrations consistent with the Pantheon art direction?
8. Could this be mistaken for a generic AI-generated SaaS dashboard?
9. Does the historical influence feel integrated rather than worn as costume?
10. Is it usable with a keyboard and at smaller viewports?
11. Does it show real product state rather than fabricated activity?
12. Does it preserve the specific identity of its studio?

**Automatic rejection** when a design depends on unnecessary metrics,
invented AI features, decorative filler cards, chatbot-first layouts,
ornament over work surfaces, contradictory historical references, excessive
gradients and glow, unreadable type, copy promising unspecified capabilities,
or effects that reduce usability.

**Required review output** for meaningful changes: functional objective,
design references, shared tokens used, studio overrides, accessibility
checks, removed decoration or structure, remaining usability risks. Never
approve a design because it looks impressive in a static screenshot.

## XI. Engineering implementation

Shared foundations live in [`packages/design-system`](../packages/design-system/README.md):
colour, typography, spacing, borders, focus, control dimensions, status, and
motion preferences, delivered as plain CSS in cascade layers and scoped by
`data-stex-app`. Applications declare their identity and inherit roles; they
own local layouts, editing tools, canvases, and studio-specific components.
No component framework, no CSS files ahead of need, no dependency that
recreates what exists. The system is validated by the
[specimen page](../packages/design-system/specimen/index.html) (served at
`/design-system/specimen/`) and representative screens of each active
application.

## XII. Final doctrine

Pantheon should feel like a place where serious creative work happens. Its
imagery may be visionary, but its interfaces must be precise. Its typography
may be classical, but its behaviour must be modern. Its colours may be
atmospheric, but its information must remain clear. Its applications may
differ, but they must be recognisably related.

**The imagination is Blakean. The interface is instrumental. The execution is
contemporary.**

The strongest test: the result is recognisable as Pantheon on a page with no
engraving, no celestial figure, and no decorative flourish. Personality lives
in typography, material palette, selected artwork, and emblem design; the
operational interface stays disciplined.
