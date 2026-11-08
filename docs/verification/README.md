# Verification evidence

This directory separates current acceptance evidence from dated historical
reports. Read [the status table](../STATUS.md) first for the current claim;
then use a report here to inspect the command output and limits behind it.

## Current evidence

| Area | Report | Current limit |
| --- | --- | --- |
| Platform release / instruction reconciliation | [Release audit and evidence](platform-release.md) | BLOCKED on permitted CI access; preparation verified, no main merge/deployment or post-merge acceptance claimed |
| Python platform foundation M1 | [M1 report](platform-m1-python-foundation.md) | Additive FastAPI service beside Node; read-only project list; no Pantheon route switched; CI step unrun |
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

- [A0 baseline](alpha-baseline.md) and [A0 report](alpha-report.md)
- [Naming-consolidation baseline](naming-consolidation-baseline.md)
- [Machine-readable A0 report](alpha-report.json)

Repository-wide deterministic checks are documented in the
[developer guide](../DEVELOPER-GUIDE.md); the current local Hermes profile and
tool policy are checked with `corepack pnpm run check:hermes-runtime`.
