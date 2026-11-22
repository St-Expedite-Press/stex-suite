# Verification evidence

This directory separates current acceptance evidence from dated historical
reports. Read [the status table](../STATUS.md) first for the current claim;
then use a report here to inspect the command output and limits behind it.

## Evidence by area

| Area | Report | Current limit |
| --- | --- | --- |
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
