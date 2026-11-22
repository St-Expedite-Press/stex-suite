# Public source release preparation

Prepared on 2026-11-22 from suite `b669759` and private Igor pin `5db7e51`.
The candidate is for source reading. Running integration requires an
authorized checkout, Igor access and the approved media.

## Source and structure

- Grouped local launch, browser/API verification and submodule sync under
  their owning script directories. Kept public contract versions and
  canonical package commands intact.
- Retired obsolete Pantheon aliases, the port fallback and Frige's automatic
  lookup of a pre-consolidation project path. An explicit absolute project
  directory continues to work in place.
- Reconciled the README, whitepaper, user manual, developer guide and
  current status. Historical evidence remains available in the maintainer
  checkout.
- Added file and callable annotations, using a companion for synchronized
  sources. Kept protected manuscript, approved media and private Igor bytes
  out of the change.

## Verification

| Check | Result |
| --- | --- |
| Static | Node syntax checks for 81 JavaScript files. Pantheon type check and production build passed. Igor's private renderer build passed with its existing asset-resolution and chunk-size warnings. |
| Full suite | `corepack pnpm test` passed 339 Node tests and 64 Python tests, plus instruction, lint, type and synchronization checks. No tests skipped. |
| Annotation coverage | Independent syntax-tree check located 840 annotated JavaScript/TypeScript callable definitions in 81 eligible files, plus 67 documented Python callable definitions. The 13 named callables in synchronized sources are covered in the companion. |
| Local configuration | Pantheon ignored the retired port setting and used the canonical default. Frige opened a synthetic project at the explicitly selected existing root with its manifest unchanged. |
| Browser and API | `verify:splash`, `verify:home`, `verify:frige`, `verify:platform`, `verify:igor`, `verify:igor-login`, `verify:knowledge` and `verify:platform-api` passed locally. The home workflow also passed with platform aggregation disabled. Chrome, synthetic workspaces and fake or stub inference. |
| Real artifacts | Frige generated a real LuaLaTeX proof. Seaxneat built and mounted a real Next preview, committed an explicit edit, and validated a restored revision. Independent review compiled the synthetic Frige example and verified its Programme order. |
| Stack lifecycle | The Seaxneat verifier started the real loopback stack and shut it down with the Windows process-tree cleanup path. All six selected ports closed. Graceful interactive shutdown was outside this check. |

Independent review checked source ownership, code changes versus comments,
configuration migration, instruction preservation, annotation coverage and
the synthetic example. The health handler uses an adjacent comment because a FastAPI route docstring
would change its generated OpenAPI description. The existing project route
docstring remains part of the generated contract.

## Candidate and outstanding approvals

The [source and asset rights](../SOURCE-RIGHTS.md) page identifies the
software and material approvals. The review archive excludes the tracked
manuscript, uncleared brand artwork and derivatives, private Igor, local
state and maintainer-only records. The archive's manifest lists exact
files, sizes and digests. The omitted brand assets leave visual resources
and asset parity checks dependent on the authorized checkout. The
splash and integration checks above used that checkout.

The existing GitHub repository is public and its history includes the
tracked manuscript and brand material. The release download's exclusions
do not alter that history. Publication requires separate owner approval.
