# Platform transition P2 — publishing presentation

**Objective:** compose Frige's existing library and manuscript workstation in
Pantheon without replacing canonical state, editorial authority or the proof
pipeline. **Base:** `abb1f617f02758e714a280fb8eae4ebef4b76f15`.
The [full transition plan](../PLATFORM-TRANSITION.md) remains the goal; P2 is
an increment, not a substitute for contextual Igor or knowledge projections.
The suite pins the synced documentation submodule at
`d265894428289c6f42820fa9196974b47e0b9f79`; no hosted runtime code changes
or production deployment are included in P2.

## Behavior and ownership

Pantheon owns `apps/pantheon/workspaces/frige`: the existing editor, thread,
line diff, PDF.js viewer, publication profile, model settings and responsive
workspace controls. It renders the library and workstation at `/frige/`
inside the common shell. The workstation uses a compact shared header and
one set of platform navigation. Duplicate studio masthead code is removed.
There is one implementation of the publishing frontend, not a frame around
an independently rendered application or a rewrite of its mature editor.

Frige remains the sole owner of manuscript and proof state. Its additive
[`stex.frige.publishing.v1`](../../protocol/frige/README.md#publishing-v1)
facade validates finite routes/methods, then calls the existing engine API and
store validators. Unversioned APIs and legacy book compatibility retain their
meaning. Engine UI entries redirect to the configured loopback platform with
queries preserved. PDF.js/design/media compatibility resources remain served
by the engine; it never reads Pantheon's frontend files.

Source hashes and serialized proposal acceptance remain authoritative. A
platform save cannot overwrite a newer source revision. UI fonts, accents
and layout never enter manuscript bytes or the LuaLaTeX preamble. Unsaved
Markdown has native leave-page protection; startup failure is displayed in
the workspace while platform navigation remains available. User-facing
assistant labels say Igor; internal Hermes contracts and names are unchanged.

## Evidence

| Check | Result |
| --- | --- |
| `test:pantheon` / `test:frige` | Tests moved with UI ownership; source-diff coverage is retained in Pantheon. Engine v1 tests cover create/read/save, stale-write refusal, version header, unsupported methods and namespace rejection |
| Final `corepack pnpm test` | PASS: 130 tests, zero failures/skips, plus sync. Assets 4, design system 8, Pantheon 15, Igor 14, Frige 45, inference 21, Seaxneat 14, Hermes 7, knowledge 2 |
| `corepack pnpm verify:frige` | PASS: Chrome, five viewports (1440, 1024, 768, 390, 320px), real LuaLaTeX and PDF canvas, labelled local inference stub only |
| Browser workflow | Create/open a scaffold; preserve indentation, stanza breaks and Unicode on save; reject stale browser source; show an inert proposal and explicitly accept; compile/render a verified page map; change profile and detect stale proof in preflight |
| Accessibility regression checks | Shared navigation, focus ring, tablet drawer inert/Tab/Escape/focus restoration, and model-settings dialog styling/scope/closure |
| Protected source | Only disposable synthetic books were used; zero protected manuscript changes |
| `corepack pnpm build:pantheon` | PASS: TypeScript and production workspace build |
| Static/link checks | PASS: 17 touched JS/MJS modules, whitespace checks, and 101 local links in 17 changed Markdown files |
| Independent review | Two rounds complete. Both confirmed findings fixed and browser-verified; final reviewer independently checked route/URL mapping and found no blocking findings |

Browser evidence is written to the system temp `stex-frige-verification`
folder (or `--out`), never committed. The viewport screenshots were inspected
at desktop and phone widths. PDF pagination comes from actual compiler
shipout markers, not screenshot interpretation. A mapped proof is not
press-ready; the fixture intentionally changes its profile to verify stale
proof/preflight behavior. No provider calls, live runtime tools, credentials,
production operations or real manuscript modifications occurred.

## Review, loop outcomes and limits

Round 1 identified two confirmed UI integration regressions: the new toolbar
remained interactive behind the tablet drawer, and a dialog appended to body
lost workstation style inheritance. The toolbar/skip link now become inert,
Tab wraps in the drawer, Escape restores focus, and the modal dialog mounts
within the workstation. The browser verifies both repairs. A moved diff test
was relocated to its owning UI suite. A browser resize timing assumption and
an incomplete model-settings stub were repaired as harness defects rather
than treated as product evidence.

**Increment status: COMPLETE.** Independent final review and final command
results above precede publication. Both review rounds completed; no repair or
replan budget was exhausted. Local
single-user access is unchanged. Safari/Firefox are not tested; hosted Frige
and provider-backed editorial behavior are not claimed. Igor composition,
explicit shared project context and co-evolving knowledge remain required
later stages of the active goal.
