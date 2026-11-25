# Frige original-byte identity

Wave C first increment. Frige keeps each upload as a separate document
with its own original, conversion state, and approval. The two upload
routes share the per-book write queue and the same original writer.
New records store `sourceSha256`. An upload response may acknowledge an
earlier byte-identical original in the same book. The workstation
announces the match and keeps the new file independently reviewable.
[Upload contract](../../protocol/frige/README.md#approved-document-excerpts)

## Boundaries and recovery

The lookup is advisory. It checks at most 64 candidate records whose
combined declared size is at most 32 MB per file. It checks a real file
at the exact path before comparing bytes. Missing, linked, or out-of-book
originals are skipped. Older records retain their original IDs and
metadata. An exact available digestless file can still match.
A changed modern original returns
`409 ATTACHMENT_CHANGED` before deferred conversion and leaves its
stored receipt and review state intact. Digestless originals retain the
existing conversion path.

Manuscripts, excerpts, and conversion authorization keep their existing
owners. An advisory match has no effect on context use or prior review.
The existing interrupted-upload limitation remains documented under the
[legacy attachment contract](../../protocol/frige/README.md#legacy-books-compatibility-v1).
Passage indexing, guided retrieval, and subsequent deletion and
reconciliation work have their own acceptance requirements in the
[resource model](../architecture/resource-model.md#selective-passages).

## Review and verification

- Four focused HTTP regressions passed on Node 22.23.5. They exercise
  both APIs, concurrent uploads, digestless files, separate books,
  exact filename handling, refusal of a linked source directory, and
  rejection of changed bytes before converter invocation.
- Independent review found the legacy trailing-character and deferred
  conversion cases. Both regressions failed before the fix and passed
  afterwards. Follow-up review cleared both findings.
- The Chrome publishing workflow reported a duplicate selected through
  the file input, confirmed equal original digests and separate document
  IDs, and verified the second upload remained pending review. The same
  workflow produced a real LuaLaTeX proof at five viewports.

## Proof promotion follow-up

The failed browser fixture retained a newly compiled PDF and a staged
page map with the expected piece layout. The active map was still from
the previous proof. A separate Windows check reproduced `EPERM` when a
reader held the replacement destination.

Frige now uses the existing bounded replacement retry for proof promotion.
It publishes the map first and restores it if the PDF replacement fails.
Preflight reads its evidence under the same in-process lock, including
font inspection, which returns unavailable after a five-second limit.
The live-build handoff waits for promotion and requires the active page
map to match the verified build record before copying its PDF. Its
deterministic test reproduced a mixed-generation handoff before the
repair and passed after it. New maps record the compiler PDF digest so
preflight and handoff can refuse mismatched bytes, including an interrupted
replacement. Restoring an interrupted proof on restart remains separate.

Independent review and focused failure tests confirmed queued handoffs
wait for promotion, both file-replacement failures preserve prior
evidence, and mismatched bytes fail preflight and handoff. The final full
`corepack pnpm test` run passed on Node 22.23.5, with the three existing
Windows skips. The final Chrome Frige workflow passed with real LuaLaTeX
and five viewports.
