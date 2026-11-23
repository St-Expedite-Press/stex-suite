# Program handoff

## Resume work

1. Read the [engineering charter](../../AGENTS.md) and the charter for the
   owning application.
2. Check [current product status](../STATUS.md), [program progress](PROGRESS.md)
   and the [integration ledger](INTEGRATION-LEDGER.md) before choosing a base.
3. Review [decisions](DECISIONS.md) and [risks](RISKS.md) for pending authority.
   The [baseline](../verification/program-baseline-2026-11-13.md) provides
   historical context for the program.

## Current work

The public source candidate is prepared for owner review. Its contents,
verification and publication gates are in the
[release preparation report](../verification/public-source-release.md).

Wave F's next product increment is editorial review, followed by long-form
context. See the [master plan](MASTER-PLAN.md#waves) and the
[work packages](PROGRESS.md#work-packages). Hosted follow-up checks and
credential renewal are tracked in the [risk register](RISKS.md) and private
runbook. Each live check needs explicit authorization.

Igor's approved-document tools have been active since Igor generation 20
([activation evidence](../verification/igor-document-runtime-activation.md)).
Generation 21 (stex-igor PR 11) restarts the document units on each release
and logs one outcome code per turn. Binary (PDF and DOCX) approval is the
next document increment.

If review was interrupted, resume from the original diff, verification
outputs and a self-contained review brief. For an older checkout, read the
[project directory migration](../archive/naming/project-directory-migration.md)
before starting the updated stack.

## Working boundaries

Stage named paths. Keep author files and ignored local state in place, and
use synthetic material in disposable directories. The Press website remains
outside the program ([D-001](DECISIONS.md)). The
[developer guide](../DEVELOPER-GUIDE.md#integration-and-verification) owns
the current command list. Private Igor main triggers deployment and needs
separate release authorization.
