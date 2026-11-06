# Verification evidence

This directory separates current acceptance evidence from dated historical
reports. Read [the status table](../STATUS.md) first for the current claim;
then use a report here to inspect the command output and limits behind it.

## Current evidence

| Area | Report | Current limit |
| --- | --- | --- |
| Hermes / Igor H1 | [H1 preparation](hermes-h1-preparation.md) | One direct, tool-free OpenRouter turn is verified; product remote workflows are not |
| Pantheon consolidation | [Consolidation report](pantheon-consolidation-report.md) | Fake inference and local workflows only |
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
