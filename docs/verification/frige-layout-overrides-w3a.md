# Frige layout overrides — Wave 3a evidence

**Objective:** typed layout settings at three levels, as specified in
[the master plan](../program/MASTER-PLAN.md#3a--typed-layout-overrides): a
section or a piece may override the book's body size and leading, whether it
opens on a recto, and (for a section) its recto running head. The nearest
level wins. No raw LaTeX at any level.

**Status:** implemented and tested locally; one independent review round,
confirmed findings fixed. Not pushed, not merged, not deployed.

| Item | Value |
| --- | --- |
| Branch | `feat/frige-change-contracts` (local), on top of `8397b6c` |
| stex-igor | `d0598d8`, unchanged |
| Date | 2026-11-17 |
| Environment | Windows 11, Node 24.18, LuaHBTeX 1.24 (MiKTeX), Chrome |
| Data | Synthetic books in temporary directories only |

## What changed

| Path | Change |
| --- | --- |
| `apps/frige/src/design-settings.mjs` | Override model: allowed keys per level, strict validation on save, lenient per-override fallback on read, `resolveLayout` |
| `apps/frige/src/book-assembler.mjs` | Applies a resolved size inside a group around that piece only; decides recto openings from the nearest setting; uses a section's head text; records `layout` per page-map node |
| `apps/frige/src/project-store-vault.mjs` | `saveDesign` merges overrides by key, clears with `null`, refuses targets not in the reading order |
| `apps/pantheon/workspaces/frige/` | The Design panel shows the selected section's or piece's own settings |
| `apps/frige/test/production.test.mjs` | Five tests, one with real LuaLaTeX proofs |
| `scripts/verify-frige.mjs` | Browser step: set a piece override, typeset, confirm the page map, clear |
| `protocol/frige/README.md`, `apps/frige/README.md` | [Layout overrides](../../protocol/frige/README.md#layout-overrides) |

Contract touched: `stex.frige.publishing.v1`, additively: new optional
`sections` and `nodes` in the profile, and a `layout` field on page-map
nodes. A profile without overrides is unchanged and keeps its hash.

## Acceptance criteria and evidence

| Criterion (from the master plan) | Evidence |
| --- | --- |
| A book size change reaches every piece | Existing profile tests; the real-proof test's baseline build |
| A section override reaches only its pieces | "a real proof follows the overrides…": the section's two pieces span more pages; the other section's piece is unchanged |
| A piece override beats its section | Same test; also "the nearest level that sets a value wins…" |
| Clearing an override restores inheritance | Same test: page spans equal the original build exactly |
| Pagination stays compiler-verified | Every build in that test asserts `pagination.verified` |
| An invalid override is refused with the rule's message | "overrides validate strictly…"; "saving overrides merges by key…" |
| No raw LaTeX at any level | Values pass the book's rules; a LaTeX value is refused; head text is escaped ("the assembled document applies an override…") |
| Shown and usable in the workstation | `verify:frige`: set, typeset into a real proof with `sizeFrom: element` in the page map, cleared; screenshot `design-override.png` |

## Commands and results

| Command | Result |
| --- | --- |
| `node --test apps/frige/test/production.test.mjs` | 14 pass, including real LuaLaTeX proofs |
| `corepack pnpm run test:frige` | 91 pass |
| `corepack pnpm test`, as one command | **Passes** (exit 0): 196 Node tests across nine suites, Ruff, mypy, 64 pytest, stex-igor sync. `test:platform` now runs mypy and pytest as Python modules, which this machine's Application Control allows |
| `test:stex-igor-sync`, `build:pantheon` | Pass |
| `corepack pnpm run test:pantheon` | 19 pass |
| `corepack pnpm run verify:frige` | PASS, including the override step and five widths |
| `git diff --check` | Clean |

## Independent review

One round, by a separate reviewer agent given the diff and the charters. It
ran real LuaLaTeX builds of edge cases through the store.

**Confirmed safe:** profiles without overrides keep byte-identical hashes
and normalized forms; it compared the old and new code on eight profiles, so
no existing proof turns stale. The hash ignores key order, and isolated
proofs still find their book-order reference. The size group behaved
correctly with long continued footnotes, section-note openers, front matter
at 8pt, and special characters in folder names and head text; pagination was
verified in both modes. Folder names never reach TeX.

| Finding | Disposition |
| --- | --- |
| Medium: a line break in a section's head text, sent through the API, broke the build | Fixed: head text must be one line. Test: "override edge cases found in review…" |
| Medium: a section's recto setting was ignored when its first piece prints nothing | Fixed: it applies to the first piece that prints. Test: "a section setting reaches the first piece that prints…" |
| Medium: an unchanged override whose piece had left the table of contents blocked every Design save from the workstation | Fixed: an unchanged override is kept; changing it is refused, naming the piece by title; such pieces no longer show override controls. Test: "an unchanged override whose piece left the table of contents…" |
| Low: a folder that appears in separate runs gets the override in each run, undocumented | Documented; tested |
| Low: a folder name over 120 characters could not be named | Limit raised to 255; tested |
| Low: overrides whose target was renamed stay in the profile and the UI cannot clear a renamed section's | Recorded as a limit below |
| Docs: "affected proofs" go stale; every page-map node has `layout` | Corrected: every proof under the previous profile goes stale; only pieces that print have `layout` |
| Also adopted from the review | Own-property lookup for override keys; the empty half of a size pair reported as "set together"; profile checks read the current table of contents; the blank recto choice reads "As its section" for a piece; the note is linked to its fieldset; the two exported helpers with no outside caller made module-private |

Fixes were verified by the tests named and by `verify:frige`; they were not
re-reviewed (one round was used of the charter's two).

## Limits

- **Overrides are set by the author only.** Proposing them through a
  conversation is Wave 3b.
- **Renamed targets.** Node ids derive from file paths, so renaming a piece
  or a section folder leaves its override inert but still in the profile and
  its hash. A renamed section's override can be cleared only through the API
  with `null`. Listing such overrides with a clear action is future work.
- **Any override change makes every proof stale**, including proofs of
  pieces it does not touch. Conservative, not wrong.
- **Footnotes do not scale** with an overridden piece; they keep the book's
  note size.
- **Switching scope with the Design panel open** discards unsaved override
  edits but keeps unsaved book-field edits.
- **Chrome only**, local machine only; CI has not run this branch.
