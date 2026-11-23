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

## Release gates and limits

Trusted CI, deployment identity and public auth checks are tracked against the
exact release revisions. The initial approval and local tests used
disposable state and a stub provider.

Document reading is conversational context in the active Frige project.
PDF and DOCX extraction, protected-book handoff into the standalone Igor
interface, and general model tool calls remain separate work. The native
Hermes tool isolation gate requires executable denial tests before
activation. The first capability candidate is reading a single approved
snapshot by an opaque reference bound to the active turn.
