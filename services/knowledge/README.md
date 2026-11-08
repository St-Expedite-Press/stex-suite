# STEX knowledge

This package has two independent, optional local libraries. It has no HTTP
server, engine filesystem access, provider integration, or embeddings.

`src/projections.mjs` implements the bounded P4 foundation: a durable metadata
journal from explicitly accepted engine revision events, with coordinated
source/provenance and User Graph views. User assertions are distinct from
evidence-backed inferred relationships, which can be corrected or rejected.
The [versioned contract](../../protocol/knowledge/README.md) specifies consent,
ordering, replay, revocation, export, deletion, and host access checks.

```js
import { openKnowledge } from './src/projections.mjs';
const knowledge = await openKnowledge({ directory: selectedIgnoredDirectory });
const { version } = knowledge.view();
// verifiedOwnerEvent was fetched and checked by the host immediately before
// explicit approval. The library never accepts browser URLs or opens sources.
await knowledge.accept({ idempotencyKey, expectedVersion: version, event: verifiedOwnerEvent });
await knowledge.close();
```

Without a selected directory the projection library reports disabled. When
enabled, its single writer stores `knowledge.v1.json` in that directory and
rebuilds both views from the ordered journal after restart. It retains source
identities/revisions and provenance, not source text or operational state.
The host must revalidate owner access and revisions before exposing sources
or offering context. `view()` alone describes locally accepted knowledge;
it does not prove that a source still exists or remains accessible.

Pantheon hosts the optional `/api/knowledge/v1` boundary and `/graph/` view.
Select `STEX_KNOWLEDGE_DATA_DIR` before starting it; an absolute path to ignored
`services/knowledge/.local-data` is the documented local setup
in the [developer guide](../../docs/DEVELOPER-GUIDE.md). The host fetches
engine-owned observation events, checks selected revisions, and revalidates
source access before offering references. Access checks cover at most 40
sources, four concurrently, within six seconds; unchecked references remain
unavailable. This is deliberate bounded access checking, not automatic indexing.

The Graph UI supports explicit source acceptance, user assertions,
evidence-backed inferences, correction/rejection, withdrawal and renewed
consent, export and erasure. Project selection uses real engine summaries;
relationship subjects use accepted projects. Frige and Seaxneat provide
**Project knowledge** links into that selection. Accepted relationships with current evidence can
be previewed and explicitly sent to Igor as the exact normal user message
shown, after another access check. It never mines transcripts, generates
inferences automatically, or mutates engine files. These paths are implemented
and tested locally; the hosted deployment is unchanged.

`src/local-adapter.mjs` is the separate legacy read-only Markdown vault
adapter, disabled without `STEX_VAULT_PATH`. It is not used by the projection
library. It must remain unexposed to browsers until symlink/junction and
Windows path-alias handling are hardened. The vault stays optional, portable,
and independent of engine workflows.

Run `corepack pnpm test:knowledge` from the repository root. Tests use
disposable directories and cover accepted revisions, both views, stale and
duplicate events, consent withdrawal, evidence invalidation, inference
correction/rejection, restart/rebuild, detached export, deletion generation,
writer locking, malformed journal preservation, and failed-write rollback.
`corepack pnpm verify:knowledge` covers the real disposable engine/Graph
workflow, including four Chrome viewports. `verify:igor` checks exact project
source approval, context withdrawal/session separation and the knowledge
message handoff with stub inference. Neither command calls a paid provider.
