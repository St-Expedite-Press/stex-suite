# Frige revision history and document excerpts

The Frige writing surface exposes **History** in **Source**. An unlocked
author can compare an earlier revision, record a reason and explicitly
restore a revision. The browser verifier checks the restored source
against the exact hash recorded by LuaLaTeX.

In a Frige conversation, **Review excerpt** shows the exact bounded text
from an uploaded UTF-8 document. **Use this excerpt in chat** approves
the previewed digest. Frige rechecks the digest before a turn. The private
inference adapter revalidates the excerpt, respects the existing context
budget and confirms what was forwarded. See the
[Frige publishing contract](../../protocol/frige/README.md#approved-document-excerpts).

## Evidence

- The synthetic browser workflow covers history, comparison, decision,
  explicit restore and a compiler-verified proof. It also previews and
  approves an excerpt, sends its exact text to stub inference, and checks
  that pending and changed extractions are withheld.
- The hosted access contract applies to history, restore, decision,
  excerpt preview and excerpt approval. HTTP checks use two synthetic
  projects and prove access requires the selected project's unlock.
- The private adapter tests and an independent authenticated stub probe
  exercised digest validation, context budgeting, exact Unicode and CRLF,
  cross-book session separation, and disabled runtime tools.

## Hosted release

- Pantheon switched from `2660dfb` generation 0 to `a3708e1` generation 1
  on November 23, 2026, at 7:30 a.m. Central. Igor switched from
  `e9c0d85` generation 16 to `8ebcfb2` generation 17 at 7:12 a.m. Central.
  [Suite PR](https://github.com/St-Expedite-Press/stex-suite/pull/15),
  [Igor PR](https://github.com/St-Expedite-Press/stex-igor/pull/7),
  [Igor deploy](https://github.com/St-Expedite-Press/stex-igor/actions/runs/45181301796)
- The exact suite PR tree and main commit matched. Trusted PR CI passed
  before Pantheon activation. The main CI rerun was still installing
  system packages at the time and later passed. The local full suite had
  367 Node and 64 Python passes, with zero skips in the Node suites.
  `corepack pnpm run verify:frige` passed on Chrome at five viewports.
  [Suite PR CI](https://github.com/St-Expedite-Press/stex-suite/actions/runs/45182659102),
  [Suite main CI](https://github.com/St-Expedite-Press/stex-suite/actions/runs/45183167227)
- The clean Pantheon archive contained the new engine modules and History
  browser script. The archive inventory excluded manuscripts and local
  state. The VM verified the SHA-256 and used the existing rollback-capable
  installer. The previous release and a current backup were available.
- After activation, both release identities were read back. All five
  services reported active. The History script and engine health returned
  200 through Pantheon loopback. Public signed-out pages redirected to
  sign-in and the API returned 401. Both new types of endpoint refused a
  locked book with 403. The aggregate digest of 102 deployed manuscript
  files matched across the rollout.
- The deployed Frige code saved, recorded a reason and restored exact
  synthetic Markdown, then built a compiler-verified proof with the
  restored hash on the VM. The active Igor adapter admitted a matching
  synthetic digest and excluded a changed excerpt. Both smoke tests ran
  without a live provider turn.
- Independent review fixed a consent race between publishing upload and
  legacy rejection and a History paging race. A repeated HTTP probe proved
  the final manifest kept the new upload and the rejection, and preserved
  corrupt metadata bytes on a 503. The release proceeded after two
  suite-review rounds and one adapter-review round.

## Limits and requested tool scope

Document reading is conversational context in the active Frige project.
PDF and DOCX extraction, protected-book handoff into the standalone Igor
interface, and general model tool calls remain separate work. The native
Hermes tool isolation gate requires executable denial tests before
activation. The owner selected both search across approved project excerpts
and reading an approved excerpt by an opaque reference bound to the active
turn. Staging must prove refusal of unapproved, expired, stale and
cross-project references, along with host files, credentials, network
access and mutation. Production tool activation is gated on that evidence.

The [disposable VM test](igor-document-tools-stage.md) exercises search,
read and MarkItDown conversion through native Hermes with a synthetic model.
The production gateway's approval and isolation checks remain pending.
