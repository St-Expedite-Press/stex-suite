# Pantheon presentation charter

**Scope:** this application, including platform-owned Frige and Seaxneat
workspaces. Supplements the [root charter](../../AGENTS.md). Read the
[application README](README.md), [visual charter](../../packages/design-system/AGENTS.md)
and contracts crossed by a change.

Pantheon owns the common user environment, navigation, workspace composition
and presentation state. Engines retain canonical source, Git history,
operations and validation. Use versioned HTTP APIs; never import private engine
modules or open engine files. Igor's private renderer is composed over HTTP,
not copied into this public repository. The optional knowledge journal is
owned by its service, not a replacement project store.

Preserve the approved Blakean splash and byte-identical artwork, responsive
composition, masthead/motion behavior, Romantic Instrumentalism, typography
and shared design tokens. Do not regenerate art, add account flows, or redesign
approved navigation during integration. Local Sign in remains credential-free;
hosted Igor's authentication is a separate boundary. Deferred studios stay
honestly deferred; never invent data or operations.

TypeScript/React is appropriate for frontend work; Frige's existing plain
JavaScript workstation remains supported. Its presentation must also preserve
the [Frige invariants](../frige/AGENTS.md): source bytes, visible proposals,
explicit acceptance, stale-write refusal and real compiler-derived proofs.
Python/FastAPI is the future backend target in the root plan, not a release
rewrite. Obsidian is the first-class future knowledge interface; do not build
sync or move engine state into a vault as part of presentation work.

Keep generated previews opaque/sandboxed, Markdown inert, credentials
server-side, API paths bounded and foreign origins refused. Preserve unsaved
draft protection, global navigation, focus restoration, keyboard operation,
reduced motion and honest unavailable states.

From the suite root run `corepack pnpm test:pantheon` and
`corepack pnpm build:pantheon`; follow with affected disposable browser checks
(`verify:splash`, `verify:home`, `verify:frige`, `verify:platform`, `verify:igor`
or `verify:knowledge`) and the root integration gates. Report actual results
and limits; a screenshot alone is not workflow evidence.
