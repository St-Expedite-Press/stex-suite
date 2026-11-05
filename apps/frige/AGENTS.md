# Frige engineering instructions

These rules govern agents that build Frige (`apps/frige/`). The root
`AGENTS.md` stays authoritative; this file adds Frige-specific
requirements. Developer agents are not Hermes: Hermes is the runtime director
inside the product, reached only through `services/inference/`.

Frige's goal is a graph-native literary typesetting and publishing
workstation in which textual integrity, typographic quality, reproducibility
and editorial authority are demonstrable properties of the software.

## Evidence standard

A capability is complete only when its behavior is demonstrated, its
invariants hold, its failure conditions are tested, and its integration into
the product is verified. Source existence is not execution; a unit test is not
an integration test; a screenshot is not a working user path; a successful
compile is not press readiness. A test that could not run has not passed.
Never report a tool result, test, review or remote action that did not occur.

## Protected material and approval

- `books/*/manuscript/` is protected creative source. Never rewrite,
  normalize, reformat, rename, reorder or delete it to simplify an
  implementation. Tests use synthetic fixtures or temporary copies, never a
  real manuscript that is changed and restored.
- An editorial change to literary text needs explicit author authorization
  for that operation. If a typographic fix would need one, propose it.
- Ask first before deleting canonical material or user data, destructive
  repository operations, infrastructure with ongoing cost, public deployment,
  changes to credentials or permissions, or replacing a cross-application
  contract. Extend contracts in `protocol/` with a new version instead.
- `books/*/.texgraph/` is local application state, not canonical source.

## Invariants

1. Canonical text is independent of presentation: fonts, trim, page breaks
   and editions never change a manuscript's text.
2. Literary units are not pages. A piece may span pages; a page may hold
   several pieces. Never equate a file or node with a printed page.
3. Typesetting preserves verse line breaks, stanza divisions, indentation
   (including typographic spaces), Unicode and inline emphasis. Text that
   cannot print is flagged, never dropped silently.
4. Page numbers come from the compiler and are validated against the PDF.
   Provisional numbering is labelled as such and kept distinct from verified.
5. Builds record source hashes, scope, settings and compiler output; claim
   cross-environment reproducibility only when tested.
6. AI edits are proposals: target node, base hash, intended change and diff.
   Writes go through one serialized path that rejects stale bases.
7. Publication readiness is its own state, established by preflight and
   printer requirements, never by a successful build.

## Working loop

Observe the current files, tests and contracts → diagnose the smallest cause
→ plan a verifiable increment → implement → test narrowest first, then
broader → have the result critiqued → integrate and rerun → decide: accept,
repair, replan or escalate. Allow three repair iterations before replanning;
stop early when the same failure repeats without new evidence, the scope or a
protected boundary would be crossed, or a required tool is missing. Never loop
until "perfect", and never call a loop successful because its budget ran out.

## Delegation

Delegate only for a distinct domain, substantial independent investigation,
separable parallel work, or independent review; a narrow change needs one
agent. Limits unless authorized: three concurrent implementers, one verifier
for substantial changes, one delegation level, no parallel writers to the same
files without isolated worktrees. Each assignment states its objective,
context, owned files, constraints, inputs, acceptance criteria, verification
commands, budget and required output. Subagents report status (COMPLETE,
PARTIAL, BLOCKED or FAILED), changed files, interfaces, tests run with
results, unverified assumptions and remaining defects, separating observation
from inference. The principal agent keeps accountability and re-verifies
integrated work; a subagent's claim is not proof.

## Verification and review

Verify in tiers: static checks, unit tests, integration (store, compiler,
API, inference contract), end-to-end browser workflows, adversarial cases,
then publishing acceptance against a real PDF. Never report a higher tier from
lower-tier evidence. For consequential changes an independent verifier tries
to find manuscript corruption, lost whitespace or Unicode, wrong
piece-to-page mapping, false "current" or "verified" states, unsafe file
access, unvalidated inference output, cross-project leakage, races, interface
regressions and non-reproducible builds. Critical (data loss, unauthorized
mutation, materially false output) and High findings block acceptance;
Medium findings are repaired or deferred with explicit approval.

## Repository discipline

- Minimum structural commitment: extend an appropriately owned module before
  adding a file, directory, dependency or abstraction; add one only with a
  concrete caller and a tested failure model.
- Tests: one principal suite per cohesive subsystem, shared fixtures,
  parameterized variations. A regression test goes into the suite that owns
  the behavior and should fail before its fix. No committed throwaway scripts;
  diagnostics live in temporary directories.
- Never create versioned duplicates of code or directories (`new/`,
  `final/`, `*-v2` copies); replace and remove instead of keeping old and new
  implementations side by side.
- The target layout (`src/document/`, design settings, preflight, inspector)
  is a destination, not an instruction to move stable files for appearance.
  Migrate a module when its capability is being built.
- Keep the browser app framework-free until a demonstrated requirement says
  otherwise.

## Commands

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm --dir apps/frige test   # LuaLaTeX proof tests skip without lualatex on PATH
```

## Completion report

Return: objective, implementation, exact files, verification commands with
actual results, independent review findings and their disposition, remaining
risks, and the next smallest milestone. Use COMPLETE only when every gate
passes; otherwise PARTIAL, BLOCKED or FAILED with the evidence.
