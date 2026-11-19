# Seaxneat engine charter

**Scope:** this engine. Supplements the [root charter](../../AGENTS.md).
Read [README.md](README.md) and the
[workspace contract](../../protocol/seaxneat/README.md) before changes.

Seaxneat owns isolated website workspaces, Git history, proposed edits,
validated revisions, builds and preview lifecycle. Pantheon owns the UI at
`apps/pantheon/workspaces/seaxneat`; engine code must not read that frontend
as an integration shortcut or duplicate it here. Preserve compatibility
routes, explicit project selection and existing local data.

The current backend is Node. Python/FastAPI with typed contracts is its
approved future destination; preserve behavior and storage through the root
migration gate, never a release-time rewrite. First-class Obsidian integration
is future knowledge work, not storage for workspaces, operations or Git history.

Changes remain bounded proposals. Validate paths and base revisions; require
explicit apply, build and commit a validated revision only on success. Failed
edits restore exact prior source bytes and never advance validation. Preserve
durable interrupted/failed state, diffs, restoration history and proposal
decisions; never silently replay work or replace user files.

Previews are generated content outside the trusted platform document. Preserve
opaque sandbox/CSP behavior, origin/Host checks and project-confined proxy
paths/redirects. Runtime build isolation is not established by browser
sandboxing. Context exports use allowlisted validated Git objects, excluding
working drafts; knowledge observations retain metadata only. Read
[context](../../protocol/context/README.md) and
[knowledge](../../protocol/knowledge/README.md) contracts when crossing them.

Use disposable `STEX_SEAXNEAT_DATA_DIR` data. From the suite root run
`corepack pnpm test:seaxneat`, `corepack pnpm build:pantheon` and
`corepack pnpm verify:platform` for changed user paths, then root checks.
Claim a real preview/build only after running the actual Next workflow.
