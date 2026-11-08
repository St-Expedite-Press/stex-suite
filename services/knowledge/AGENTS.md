# Knowledge and Obsidian charter

**Scope:** this service package. Supplements the [root charter](../../AGENTS.md).
Read [README.md](README.md), the
[knowledge contract](../../protocol/knowledge/README.md), and applicable
[context](../../protocol/context/README.md) / [vault](../../protocol/vault/README.md)
contracts before changes.

Canonical artifacts and revisions belong to engines. This package owns
derived metadata/provenance and user-context projections from an explicitly
enabled journal. Never become a shared operational database or retain source
text, transcripts, credentials, locks for engine operations, or a second
canonical manuscript/workspace. An accepted reference is not current access;
the host must recheck owner access/revisions before display or context use.

The User Graph and Pantheon Knowledge Base must be co-extensional in relevant
entities, interoperable through stable references/contracts/provenance and
co-evolutionary through authorized updates. Explicit assertions remain
distinct from evidence-backed, confidence-labelled, correctable inferences.
No transcript mining or speculative psychological profiling. Preserve consent,
withdrawal/reacceptance, replay ordering, stale-event refusal, export and
erasure semantics. Fail closed on corrupt journals or ambiguous writer locks;
tests use synthetic journals and never user-authored vault data.

**Direct Obsidian integration is the intended first-class human interface**,
under the [approved future gate](../../docs/PLATFORM-TRANSITION.md#direct-obsidian-integration).
Today's optional metadata projections and separate unexposed read-only vault
adapter are foundations, not completed sync. Preserve portable notes and user
control; do not implement synchronization during this release. Harden linked
paths/Windows aliases and establish consent/provenance/reconciliation before
any browser exposure or write-back. A vault is never an engine journal or queue.

Python/FastAPI is the approved future backend-service target. The current
JavaScript libraries remain supported; do not introduce a new server or port
them during release. From the suite root run `corepack pnpm test:knowledge`
and affected host tests; use `corepack pnpm verify:knowledge` and
`corepack pnpm verify:igor` for changed consent/handoff workflows, followed by
the root verification gates. Never infer semantic/multimodal retrieval from
metadata-only tests.
