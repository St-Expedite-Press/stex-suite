# Verification evidence

This directory separates current acceptance evidence from dated historical
reports. Read [the status table](../STATUS.md) first for the current claim;
then use a report here to inspect the command output and limits behind it.

## Evidence by area

| Area | Report | Current limit |
| --- | --- | --- |
| Next-wave reconciliation | [Baseline and hosted release checks](next-wave-a-reconciliation.md) | Public signed-out checks and exact VM revisions verified. Signed-in production workflows and live model calls remain unverified. |
| Hosted Pantheon and Frige behind Igor sign-in | [Hosted Pantheon evidence](hosted-pantheon.md) | Suite PR 13, stex-igor PR 6; hand-installed build of `main` (no CI deploy); Seaxneat and the platform API not hosted; no live model turn |
| Frige and Igor shared gateway launch | [Gateway verification](frige-igor-gateway.md) | Disposable local services, simulated transport and no live model calls |
| Frige editorial systems foundations | [Phase A evidence](frige-editorial-foundations.md) | Source-save safety and baseline checks on disposable manuscripts |
| Frige single-piece revisions and editorial decisions | [Phase B evidence](frige-editorial-state.md) | Local publishing API and proof workflow on disposable manuscripts |
| Frige history interface and Igor document excerpts | [Release evidence](frige-editorial-release.md) | Verified source and attachment workflows with synthetic documents. |
| Igor document search, read and MarkItDown MCP | [VM staging evidence](igor-document-tools-stage.md) | Native Hermes staging used a synthetic model and disposable documents. |
| Frige uploads through MarkItDown | [Conversion evidence](frige-markitdown-uploads.md) | Synthetic VM acceptance; real conversions of synthetic PDF and DOCX |
| Frige original-byte identity | [Upload evidence](frige-source-identity.md) | Synthetic books, local HTTP/browser checks, and independent review |
| Frige editorial sessions (program A1) | [Sessions evidence](frige-sessions-a1.md) | Deployed in Pantheon generation 3. Local Chrome used synthetic books and fake or stub transport. |
| Igor working sessions (program A2) | [Sessions evidence](igor-working-sessions-a2.md) | Deployed in Igor generation 25. Browser workflow used stub inference locally. |
| Seaxneat preview and vault adapter hardening (program S0 + K0) | [Hardening evidence](security-hardening-s0-k0.md) | No OS isolation for builds (S1); two symlink tests skipped where symlinks cannot be created |
| Platform actor and personal knowledge (program D2) | [Actor evidence](platform-actor-d2.md) | Host configuration and Frige's missing-actor rejection verified. Signed-in production journal isolation remains unverified. |
| Igor document runtime in production | [Activation evidence](igor-document-runtime-activation.md) | Synthetic VM acceptance (31 checks) before activation; no paid verification turn |
| Separation milestone 1 (containers, Python knowledge, passages, Hermes/Obsidian evaluation) | [Milestone evidence](separation-m1.md) | Local candidate: synthetic data, local containers, recording inference stand-in; hosted sign-in and the VM not exercised |
| Phase I readiness (reconciliation, gate runner, candidate review fixes, parity matrix, continued-session fix, A5 offline Hermes, backup, restore and recovery) | [Readiness evidence](phase-i-readiness.md) | Release evidence from trusted CI (Node 22.23.5); VM inventory, a 2-second backup window and an isolated restore were owner-authorized; bare-machine rebuild not rehearsed |
| Public source release | [Preparation and approval gates](public-source-release.md) | Local candidate for source reading |
| Igor free mode, model prices and descriptions | [Free mode evidence](igor-free-mode-pricing.md) | Generation 15 read-back and profile verification; feature checks use stub catalog and fake transport |
| Frige interface increment 1: navigation and passage selection (program Wave F) | [UI-1 evidence](frige-ui-1-navigation-passages.md) | Suite merge and generation 15 release are recorded in Status; workflow checks use stub and fake transports |
| Frige anchored edits and passage review (program Wave F) | [Wave F evidence](frige-wave-f-anchored-edits.md) | Merged (suite PR 8) and released (stex-igor `c5af494`); stub and fake transports only; one review round, findings fixed; no live turn |
| Director proposals for Frige (program Wave 4b) | [Wave 4 evidence](director-proposals-w4.md) | Records the initial timeout, later hosted release, and a second live turn accepted byte-exact in Frige |
| Frige change contracts (program Wave 2) | [Wave 2 evidence](frige-change-contracts-w2.md) | Merged to suite `main`, not deployed; simulator and stub proposals; element scope in the browser; Chrome only |
| The Company: agent configuration (program Wave 4a) | [Wave 4a evidence](agent-config-w4a.md) | Company shipped in bd8b3b0; the feature checks used fake and stub transports |
| Frige stable section identity (program Wave 3e) | [Wave 3e evidence](frige-section-identity-w3e.md) | Merged to suite `main`, not deployed; synthetic books; no browser check specific to renames |
| Frige hierarchical context (program Wave 3c) | [Wave 3c evidence](frige-hierarchical-context-w3c.md) | Adapter shipped in bd8b3b0; the feature checks used fake and stub transports |
| Frige all-or-nothing acceptance (program Wave 3d) | [Wave 3d evidence](frige-atomic-acceptance-w3d.md) | Merged to suite `main`, not deployed; failures and stops simulated in tests |
| Frige layout change contracts (program Wave 3b) | [Wave 3b evidence](frige-layout-contracts-w3b.md) | Merged to suite `main`, not deployed; simulator and stub proposals; Chrome only |
| Frige layout overrides (program Wave 3a) | [Wave 3a evidence](frige-layout-overrides-w3a.md) | Merged to suite `main`, not deployed; author-set overrides only; Chrome only |
| Engineering program baseline | [2026-11-13 baseline](program-baseline-2026-11-13.md) | Read-only audit; no browser or live verification |
| Platform release / instruction reconciliation | [Release audit and evidence](platform-release.md) | Records the initial access blocker and subsequent passing CI; see Status for merge and deployment |
| Pantheon consumes the platform API M2a | [M2a report](platform-m2a-pantheon-consumption.md) | Project pages only; browser fallback retained; Chrome only |
| Python platform foundation M1 | [M1 report](platform-m1-python-foundation.md) | Additive FastAPI service beside Node; read-only project list; see Status for subsequent CI |
| Platform transition P0/P1 | [P1 report](platform-transition-p1.md) | First composed workspace; subsequent stages have separate reports below |
| Platform publishing P2 | [P2 report](platform-transition-p2.md) | Mature Frige UI composed in Pantheon; real PDF and stub inference, Chrome only |
| Contextual Igor / knowledge foundation P3/P4 | [P3/P4 report](platform-transition-p3-p4.md) | Local composed interface, exact explicit context and metadata projections; fake/stub inference, Chrome only; no production release |
| Hermes / Igor H1 | [H1 preparation](hermes-h1-preparation.md) | Direct runtime evidence; later I1/I2 reports establish bounded Igor integration/hosting, not Frige remote behavior |
| Pantheon consolidation | [Consolidation report](pantheon-consolidation-report.md) | Fake inference and local workflows only |
| Frige design system (D4) | [D4 report](frige-d4-design-system.md) | Chrome only; conversation cards and a typeset proof not rendered in the browser |
| Deployment hardening (D1) | [D1 summary](stex-deployment-d1.md) | Public summary only; the full report is private in stex-igor |
| stex-igor split (I3) | [I3 report](stex-igor-split.md) | Later D1 evidence records exercised rollback and restore; see current status |
| Hosted Igor (I2) | [I2 report](igor-i2-hosted.md) | Historical Access-era report; current password sign-in is verified, egress/owner-run hardening remains pending in STATUS |
| Igor application (I1) | [Igor I1 report](igor-i1-application.md) | Browser evidence on stub inference; five live turns on a local Windows gateway |
| Command center | [Command-center report](command-center-report.md) | Browser evidence uses the fake transport |
| Splash and identity | [Identity and splash](identity-splash-report.md) | Chrome coverage; Safari and Firefox remain unrun |

## Developer setup and release identity

Read back on 2026-11-25, hosted Igor was generation 24 at `8b7a789` and
hosted Pantheon and Frige were generation 2 at `1350391`. Suite PR 23 pins
that Igor release. The VM's Hermes checkout matched Igor's runtime pin
`e76fbd80`. CI used Node 22.23.5 for both repositories, while the VM was on
22.23.4. The developer setup selects 22.23.5 for reproducible local checks.

- The suite preflight checked the committed Igor revision and 55 runtime
  media files across both checkouts. `test:setup` exercised mismatched and
  missing Igor checkouts and unresolved and missing LFS media.
- The full suite and standalone Igor tests ran locally on Node 22.23.5.
  The suite had the three existing Windows skips. Standalone Igor had
  twelve platform-dependent document tests skipped and one upstream
  auxiliary-task check skipped without the nested Hermes source.
- The standalone type check and build passed. A disposable HTTP smoke
  check started the built renderer and completed a simulated reply.
- Independent review reran preflight and checked both release command
  blocks. The steps now verify the approved SHA against freshly fetched
  main before packaging. The pinned installer archive had the expected layout.

## Historical records

The following files preserve the evidence and limits at their recorded
revisions. They are not current-state claims and are intentionally not revised
to describe later H1 work:

- [A0 baseline](../archive/naming/alpha-baseline.md) and [A0 report](../archive/naming/alpha-report.md)
- [Naming-consolidation baseline](../archive/naming/naming-consolidation-baseline.md)
- [Machine-readable A0 report](../archive/naming/alpha-report.json)

Repository-wide deterministic checks are documented in the
[developer guide](../DEVELOPER-GUIDE.md); the current local Hermes profile and
tool policy are checked with `corepack pnpm run check:hermes-runtime`.
