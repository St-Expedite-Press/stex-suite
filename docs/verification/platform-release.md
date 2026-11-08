# Platform release and instruction reconciliation

Status: **IN PROGRESS — release gates have not yet passed**.

## Baseline and pre-correction audit

Owner directive: integrate the existing platform work, reconcile Codex/Claude
guidance and release Igor after verification. Python backend migration and
direct Obsidian integration are binding future targets, not implementation
work in this release. No paid model calls, new public Pantheon endpoint,
canonical-source edits, artwork changes or runtime-tool enablement are allowed.

Baseline suite main: `5800920a1ab67266e3be5b941be7605ea12d541e`;
PR 5 head: `b0581094190c6fa97821193a0d0284576873a9b8`.
Baseline Igor main: `462bf60ee5bf12a83d3eba02df1f78100fb351dd`;
PR 1 head: `c0e4950633963c97393ee15754da7be10783a359`.
Both PRs are open drafts and mergeable at the baseline. Both working trees
were clean. No main merge or production change has occurred during this audit.

| Audit area | Observed state | Correction / release gate |
| --- | --- | --- |
| Instruction hierarchy | Suite four charter/shim pairs; private five, including synchronized design-system copy. Nine sibling imports resolve | Reconcile root authority in each repository, domain constraints and thin shims; verify again after merge |
| Development configuration | One suite `.github/agents` definition; no project `.codex` configuration. Codex CLI 0.144.1 installed; Claude absent | Preserve the GitHub agent's distinct purpose; add only supported minimal Codex review roles. Record actual Claude execution as unverified |
| Architecture | Current Node implementations documented; Python/FastAPI destination absent. Obsidian described only as optional | Update established WHITEPAPER and PLATFORM-TRANSITION authorities, distinguish current code from required future migrations |
| Ownership | Private root delegates authority to parent; suite ownership still calls Igor composition pending | Make both root charters independently authoritative and align composed presentation/state ownership |
| Runtime declarations | Hermes roles/profiles/skills are distinct runtime configuration, not development subagents | Keep runtime tools/delegation gated; do not add development roles to the runtime roster |
| Runtime source | `.gitmodules` declares Hermes but no gitlink exists; manifest names `e76fbd80be65ea5c1b89831f8d7aaedb713f5cac` | Resolve declared-source pin discrepancy without changing the deployed upstream revision |
| CI | Suite run 42440490673 passed gate but skipped tests; Igor CI executed successfully | Fail closed; validate an existing authorized credential can read the private pin and require actual full-suite execution |
| Credential metadata | No repository secret named `STEX_IGOR_READ_TOKEN`; existing organization `HF_GITHUB_WRITE` is available, capability unknown | Probe only exact private revision access in trusted CI, never print token or persist local OAuth credentials; fail if inadequate |
| Preservation | No protected manuscript or approved splash changes at audit baseline | Recheck source/assets, disposable workflows and production record integrity before/after release |

Execution order: reconcile instructions/documentation and CI on existing review
branches; verify; merge Igor and monitor deployment; verify active release,
authentication, data integrity and rollback; pin merged Igor in suite; verify
and merge suite; check clean mains and repeat local/browser acceptance.

Current and final evidence belongs here and in `docs/STATUS.md`. Dated earlier
reports remain unchanged. Missing credentials, incomplete CI or deployment
failure block release completion rather than becoming successful skips.

## Preparation results and current gate

The original organization credential was tested only against the exact private
pin in [CI run 42443231549](https://github.com/St-Expedite-Press/stex-suite/actions/runs/42443231549)
and returned HTTP 401. The gate failed; it did not report skipped tests as
successful verification. The owner then authorized a read-only deploy key.
GitHub rejected key creation with HTTP 422: **Deploy keys are disabled for this
repository**. No deploy key or Actions secret was installed; temporary key
material was removed. An owner decision on a permitted access path is pending.
The prepared SSH workflow has not established usable access. No local broad
OAuth token was copied into Actions and no repository policy was bypassed.

Hosted baseline: active Igor main `462bf60ee5bf12a83d3eba02df1f78100fb351dd`,
generation 11; Igor, inference, Hermes and Cloudflare connector active.
Readiness was healthy, remote inference configured, store readable. One
conversation and two existing users were measured using private integrity
digests without printing records. The backup timer is active and prior release
directories remain available. No model turn was made.

The missing upstream gitlink is restored to the exact already declared
`e76fbd80be65ea5c1b89831f8d7aaedb713f5cac`; recursive initialization succeeds.
This corrects repository reproducibility, not the deployed runtime revision.
No upstream source file is edited. Instruction checks pass seven charter/shim
pairs in each repository, including the synchronized design-system pair.

The restored upstream source contains 15 third-party `AGENTS.md` files and
one lowercase Claude template. They remain unchanged under their upstream pin;
STEX's runtime charter forbids editing that subtree for this release. STEX's
14 owned charters and shims are the reconciled product engineering hierarchy.

## Pre-merge local verification

- Suite frozen install passed. Full suite: **165 tests passed, zero failures,
  zero skips**, plus both repositories' mechanical instruction checks.
- Private frozen install and standalone tests passed: **57 tests**, zero
  failures/skips, plus its instruction check. TypeScript and both production
  frontend builds passed; existing Igor bundle-size/runtime-emblem warnings
  remain visible rather than being suppressed.
- Splash acceptance passed 15 Chrome viewports; command center passed nine.
  The home verifier's stale five-tab expectation was corrected to include the
  already implemented Igor tab. No presentation code or artwork was changed.
- Frige passed its five-width workflow with a real LuaLaTeX proof. Seaxneat
  passed real Next create/edit/restore and sandbox preview at five widths.
  Knowledge acceptance passed four widths. Igor sign-in passed 15 viewports.
  Igor conversation/context/knowledge handoff passed five widths with nine
  local stub turns and no failures.
  All fixtures were disposable; no provider turn was made.
- All local Markdown references in changed current documentation resolve.
  Protected manuscript paths, asset masters and Pantheon's splash HTML, CSS
  and motion script have no diff against the original suite main.
- Independent review closed the standalone runtime-isolation wording and
  obsolete CI fallback description. Both roots are independently authoritative;
  Codex development roles are separate from Hermes roles. Four minimal TOML
  role files match the documented schema and contain no model/permission
  overrides. Codex offline prompt inspection confirms root instructions load
  when entered from either repository. Live custom-agent execution is not
  claimed. Claude CLI is absent; static imports resolve, with direct-reading
  fallback documented rather than an automatic-loading claim.

These are **pre-merge** results. Effective CI, both main merges, the intended
production deployment and post-merge acceptance remain mandatory pending gates.
