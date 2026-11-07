# Platform transition P0/P1 acceptance

**Date:** 2026-11-07. **Scope:** architecture/documentation foundation and the
first working platform composition for existing capabilities. The owner
clarified that development concentrates on Frige, Seaxneat and Igor, keeping
future extensibility and Ēostre/Woden's deferred state. The ordered destination
and later gates are in [the plan](../PLATFORM-TRANSITION.md).

**Suite base:** `5800920a1ab67266e3be5b941be7605ea12d541e`.
**Submodule at session entry:** `96a47de33f65c16e95d53887854b171c59e8967d`, a
clean checkout two documentation commits ahead of the suite's recorded
`462bf60ee5bf12a83d3eba02df1f78100fb351dd`. Those existing commits were
preserved. **Final submodule:** `2f9b43d17629d19bef80179eac2ed78289e6d486`.
The suite commit containing this report pins that reviewed revision.

## Delivered behavior

- Pantheon owns Seaxneat's workspace presentation under
  `apps/pantheon/workspaces/seaxneat`, rendered inside the existing platform
  shell at `/workspaces/seaxneat/`. The former engine-owned frontend is removed.
  `/seaxneat/?project=…` remains a compatibility entry with the query preserved.
- Seaxneat owns all workspace/Git/operation state behind
  `stex.seaxneat.workspace.v1`; unversioned inputs use the same router/store.
  Create, select, simulated proposal review, explicit apply/dismiss, diff,
  restore, build and preview remain deterministic engine operations.
- Failed initial setup is inspectable with no validated revision. Pending
  proposals survive refresh. A failed edit preserves the previous validated
  revision and restores the exact pre-edit source bytes. A regression test
  initially failed because Git checkout normalized LF to CRLF on Windows;
  replacing checkout with byte-preserving restoration repaired it.
- Pantheon's historical book workflow moves to Frige's legacy v1 boundary.
  Pantheon now proxies; it has no product filesystem access or second store.
  Interview-ticket, upload/extraction/review shapes and the legacy directory
  alias are retained. Synthetic integration fixtures verify creation and review.
- Preview frames and response CSP omit `allow-same-origin`. Frige and Seaxneat
  reject opaque/foreign browser origins for engine APIs and non-loopback Host values; the
  configured platform origin works through the proxy. The preview proxy
  preserves redirects only inside the same project mount.
  Read-only preview resources admit opaque-frame loads without forwarding
  credentials, so Next runtime scripts and generated styles can still execute.
- Current architecture, ownership, manuals, charters, active/deferred app
  READMEs, protocol boundaries, knowledge documentation and verification index
  describe the same transition. Stale conversation ownership, Igor verification,
  hosted sign-in and rollback claims are corrected in current documents.

## Verification

**Increment status: COMPLETE.** Final verification results follow. Tests and
browser work use disposable synthetic data and fake/stub inference only.

| Check | Result / limit |
| --- | --- |
| Session-entry `corepack pnpm test` | PASS: 125 tests, zero skipped, plus asset sync |
| `corepack pnpm install --frozen-lockfile` | PASS after moving existing frontend dependencies to Pantheon; no new dependency versions |
| `corepack pnpm build:pantheon` | PASS: TypeScript and production workspace bundle |
| Focused Pantheon / Frige / Seaxneat suites | PASS before final integrated run; new origin, failure and versioned workflow tests included |
| Final `corepack pnpm test` | PASS: 130 tests, zero failures/skips, plus shared-asset sync. Assets 4, design system 8, Pantheon 12, Igor 14, Frige 48, inference 21, Seaxneat 14, Hermes 7, knowledge 2 |
| `corepack pnpm verify:platform` | PASS: real creation, proposal refresh/apply/dismiss, diff, restore with pending proposal retained, mounted preview, executing Next runtime/CSS, and five Chrome viewports (1440, 1024, 768, 390, 320px). No horizontal overflow; controls at least 44px. A script inside the real preview cannot read the parent document or create an engine project |
| `node --check` on touched JS/MJS modules; `git diff --check` | PASS |
| Documentation link/command audit | PASS: 35 changed Markdown files, 117 local links, no broken local targets; 29 documented command names resolve in suite/submodule scripts or pnpm built-ins |
| Protected-source diff | PASS: zero changed files under protected manuscript trees |
| Independent review | Two rounds complete. Reviewer independently ran four new API/security tests: all pass. Origin protection, directory alias, private preview origin, pending-proposal display and preview-asset evidence findings are repaired and reverified |

The browser verifier runs the actual `scripts/dev-alpha.mjs` stack, real
Next.js install/build commands and mounted preview, with all data in system
temporary directories. It writes `report.json` and five viewport screenshots
to the system temp folder (or `--out`), not the repository. It never uses real
manuscripts or private notes. An initial run exposed the dropped preview
redirect; a diagnostic rerun isolated it, and the repaired workflow is rerun
as acceptance. A subsequent review exposed opaque-frame asset loading; the
final verifier proves both real Next runtime execution and stylesheet loading,
alongside actual in-frame denial checks. No failed run is counted as a pass.

## Review and loop outcomes

Orientation identified the mismatch between application-owned interfaces and
the requested platform destination, plus the incoming submodule advancement.
The work increment preserves existing stores and crosses only additive engine
boundaries. Static, owning, integration and full-suite checks precede browser
acceptance. Two independent review/fix rounds completed with no unresolved
confirmed findings. No failure exhausted its three-attempt repair budget;
the preview redirect and opaque-asset faults were diagnosed separately from a
DevTools out-of-process-frame assumption in the harness. No replan or
escalation budget was exhausted. Delegation was limited to read-only
investigation and independent review; the principal agent integrated and
reverified all repairs.

Documentation coverage includes the root README/charter/monorepo guide,
whitepaper, transition plan, status, user/developer/design guides, owning app
READMEs and charters, protocol overview and affected protocol docs, design
system docs and synced copies, knowledge/vault boundaries, and evidence index.
Unrelated manuscript instructions, source-library material, licenses and
upstream documents are not architecture documentation and are unchanged.
Dated historical acceptance reports preserve their original evidence.

## Limits and next increment

This accepts the first platform-composition increment, not the entire target
architecture. Frige and Igor retain their frontends; shared project context,
platform identity, engine runtime tools, evolving knowledge projections,
embeddings and multimodal retrieval are planned. The knowledge adapter's
symlink/junction/Windows alias hardening is a prerequisite for future browser
exposure, not a feature of this increment. Arbitrary generated build code has
no newly verified OS isolation boundary. Safari and Firefox are not tested.

Existing hosted Igor operations, passwords, credentials and deployment are
unchanged. Review branches are published to GitHub; no push to
`stex-igor/main`, production deploy, provider call or cloud change is part of
this increment. The next smallest product milestone is P2's publishing
presentation contract/library slice, with the mature workstation and revision
authority preserved until its own acceptance gate.
