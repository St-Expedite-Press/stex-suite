# Next-wave reconciliation

The baseline below was checked before the 2026-11-25 release.
See the [release checks](#hosted-release-on-2026-11-25) and [current status](../STATUS.md).

| Surface | Authoritative revision and evidence | State |
| --- | --- | --- |
| stex-suite | Remote `main` `20c7984` pins Igor `a9b187f`. PR 23 at `47d5acb` pins Igor `8b7a789`. Local setup revision `10232ab` uses the same pin. [PR 23](https://github.com/St-Expedite-Press/stex-suite/pull/23) · [CI](https://github.com/St-Expedite-Press/stex-suite/actions/runs/45653927938) | PR candidate integrated on its branch and tested in CI. Suite main and the installed Pantheon release have separate identities. |
| stex-igor | Remote `main`, suite candidate pin, checked-out submodule, and production all match `8b7a789`. The deployed revision includes the Frige summary-forwarding adapter `c5f3da3`. [Igor PR 14](https://github.com/St-Expedite-Press/stex-igor/pull/14) · [Deploy run](https://github.com/St-Expedite-Press/stex-igor/actions/runs/45653289301) | Deployed generation 24, independently read back. Igor's local setup reconciliation `57f8bb7` is a separate worktree. |
| Hosted Pantheon and Frige | VM reports generation 2 at `1350391`, which precedes suite PR 23. Igor, inference, Hermes, Pantheon, Frige, the isolated document converter, document relay and worker were active. VM Node is 22.23.4. Hermes matches the Git pin `e76fbd80`. | Installed revision and active services verified. D-028 settings are staged for the application release. |
| Named stex-press | Private `main` `df49115`, legacy Astro and Node implementation. Local synthetic PGlite checkout passed the Astro build, 71 tests, charter and vendor checks, and type check. [Charter](https://github.com/St-Expedite-Press/stex-press/blob/df49115c7604b68fb7d5fbd2b3800e2fbc5dcbdc/AGENTS.md) | Separate repository, zero open PRs or GitHub deployment records. Active release revision unverified. |
| Desktop Press checkout | The worktree called `stex_press` tracks `stex-workspace` `main` at `f269526`, the newer React and FastAPI application. Recorded CI passed 60 web tests and 237 backend tests with provider cases skipped. [CI](https://github.com/St-Expedite-Press/stex-workspace/actions/runs/43347010810) · [Integration boundary](https://github.com/St-Expedite-Press/stex-workspace/blob/f269526441157e93879fcb88bfd8e05ecdcce72f/docs/INTEGRATION-CONTRACTS.md) | Distinct repository, zero open PRs or GitHub deployment records. Confirm future Press repository authority before changes. |

Public probes to the Press apex and health path returned HTTP 403 from
this host. That observation establishes neither a deployed revision nor
general service availability. Press retains its independent publishing
and commercial boundary. Its manuscript submissions are outside suite
and Igor knowledge flows. [D-001](../program/DECISIONS.md)

This wave uses `stex-suite` as the platform repository. The two separate
Press codebases are identified by their actual remotes. Choosing a Press
release source remains a separate decision.

## Reconciled ownership and limits

- D-027 aligns states, summaries and continuation. Frige owns shared
  editorial records and preserves prior summary revisions. Igor owns
  private working sessions and preserves the saved summary snapshot
  used by a continuation. Their retention policies serve different
  workflows. Frige's current summary draft associates some editorial
  decisions by scope and time. An explicitly linked evidence record is
  required before using that association for a shared contribution.
- D-028 carries a verified actor after Pantheon strips browser actor
  headers and checks Igor's session. The suite tests exercise forged
  headers, attribution, journal selection, and separate user journals.
  Frige owns the book access check. The host has a matching secret in
  both configurations and a legacy-owner selection. Generation 2 lacks
  the D-028 application change. Hosted multi-user acceptance is pending
  the suite upgrade.
- MarkItDown conversion and Igor's approved-document execution are
  separate services. Frige owns original upload bytes, extraction state,
  and excerpt approval. The existing approved-prefix mechanism is distinct
  from the proposed permission-aware full-document index.
- The legacy and publishing upload entry points are two interfaces to
  the same Frige manifest and lock. Common resource references and
  shared lifecycle vocabulary can be adopted while keeping canonical
  records with their owners. [Resource model](../architecture/resource-model.md)

## Verification

- Suite preflight passed on Node 22.23.5, with the Igor pin and all 55
  runtime media checked. The existing full suite passed at the baseline,
  with the Unix-socket converter test and two symlink tests skipped on
  Windows. Static syntax and Git checks were also exercised.
- Frige passed its disposable Chrome workflow with a LuaLaTeX proof.
  Knowledge passed with synthetic sources at four viewports.
- The first Igor browser run exposed a close-and-reopen race in the
  test harness. The check now waits for the native close event before
  reopening and requires an enabled confirmation before clicking. The
  rerun passed with 12 stub turns and zero failures. The command-center
  browser workflow also passed. Platform acceptance passed across five
  widths and exercised a built and mounted Next.js workspace, a validated
  edit and a restored revision.
- Igor's disposable password sign-in browser workflow passed at 15
  viewports, including 320 px and landscape mobile dimensions.

The responsive checks cover the existing Chrome workflows, including
session summary and continuation at 390 px and the knowledge views at
four widths. On-device touch, virtual keyboard behavior, and signed-in
multi-user workflows remain separate acceptance cases.

## Hosted release on 2026-11-25

| Surface | Active revision | Verification |
| --- | --- | --- |
| Pantheon and Frige | Generation 3, `d3f995ea3910defd0d48356d9a8ac619ba5b7cda` | Both suite CI jobs passed with the exact Igor pin. The approved merge commit was packaged with `corepack pnpm release:pantheon`. Remote checksums and two consecutive installer health checks passed. VM release metadata confirmed the activation. [Suite PR 23](https://github.com/St-Expedite-Press/stex-suite/pull/23) · [Suite CI](https://github.com/St-Expedite-Press/stex-suite/actions/runs/45705214987) |
| Igor, inference and Hermes | Igor generation 25, `0455f82148abf25513f988d252f56de52d97a636` | Igor CI and the production workflow passed. The VM reported the expected release and active Igor, inference, and Hermes services. [Igor PR 15](https://github.com/St-Expedite-Press/stex-igor/pull/15) · [Igor CI](https://github.com/St-Expedite-Press/stex-igor/actions/runs/45704838535) · [Igor deploy](https://github.com/St-Expedite-Press/stex-igor/actions/runs/45705148844) |

- Public HTTPS checks passed on both hosts. Both sign-in pages returned HTTP
  200. The Igor workspace and Pantheon's root, home and Frige workspace
  redirected signed-out visitors to sign-in. The tested conversation, session,
  Frige and knowledge APIs returned HTTP 401 without a session. The knowledge
  check included untrusted actor headers. Chrome opened the public Frige
  sign-in at 390 × 844 pixels and rendered it without horizontal overflow.
  [Pantheon](https://pantheon.stexpedite.press) · [Igor](https://igor.stexpedite.press)
- Frige reported healthy over loopback and returned `401 ACTOR_REQUIRED`
  for a diagnostic POST to a nonexistent route without an actor. The VM check
  confirmed the matching actor secret and assignment of the legacy journal to
  the sole active owner. Cloudflared, both app stacks, and the document
  converter, relay and worker services were active.
- The previous Pantheon release and latest studio backup were present before
  activation. The first installer bundle stopped on CRLF shell syntax before
  switching versions. The corrected bundle's 13 files were verified against
  the committed bytes before the second install. The VM Node readback was
  `v22.23.4`. Local and CI verification used `v22.23.5`.
- The public checks covered signed-out access. Submitting an actual login,
  signed-in multi-user workflows, and paid provider turns remain unverified in
  this release. The Frige and Seaxneat browser workflows ran locally with real
  LuaLaTeX and Next.js builds. Hosted Seaxneat remains deferred.
