# Naming-consolidation inventory

**Captured:** 2026-11-04  
**Authority:** Pantheon C-03 naming migration

This inventory is deliberately scoped to tracked implementation and
documentation. Protected manuscript text, dependency lockfiles, and generated
or ignored state are excluded from mass replacement.

| Former identifier | Canonical identifier | Classification | Affected areas | Compatibility / risk | Verification |
| --- | --- | --- | --- | --- | --- |
| `Lab`, `apps/lab`, `@stex/lab` | Pantheon, `apps/pantheon`, `@stex/pantheon` | A/B | shell, scripts, tests, docs | Internal source move; no public route change | Shell route tests and alpha launcher |
| `TexGraph`, `apps/texgraph`, `@stex/texgraph` | Frige, `apps/frige`, `@stex/frige` | A/B/C/D | protected publishing app, scripts, docs, tests | Preserve `TEXGRAPH_*`, `/texgraph/`, and v3 inference adapters | Frige tests, PDF fixture, legacy-route test |
| `ScreenLab`, `apps/screenlab` | Eostre, `apps/eostre` | A/B | deferred app README and shell presentation assets | No implementation or public legacy route was established | Registry and deferred-route tests |
| `NovelGraph`, `apps/novelgraph` | Woden, `apps/woden` | A/B | deferred app README and shell presentation assets | No implementation or public legacy route was established | Registry and deferred-route tests |
| `Agent Studio`, `agent-studio` | Seaxneat | E | Seaxneat history and documentation | Retain as read-only provenance; never import its runtime | Documentation review |
| `STEX Suite` | STEX Pantheon | A/E | title and explanatory documentation | Historical A0 reports remain evidence | Canonical UI/title checks |
| `texgraph` protocol and sidecar IDs | `frige` in new contracts only | C/D/E | `/v1/texgraph/*`, `.texgraph`, schemas, tests | Existing persisted/public identifiers stay unchanged; alias at boundaries | Inference and Frige compatibility suites |

## Rules applied

- Protected manuscript Markdown is not renamed, normalized, or rewritten.
- Compatibility names remain only when they identify a public route, a
  documented environment variable, persisted user state, or historical
  evidence.
- New configuration prefers `STEX_PANTHEON_*` and `STEX_FRIGE_*`; a canonical
  value wins over a supported legacy alias, with a non-secret warning on
  conflict.
