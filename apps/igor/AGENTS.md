# Igor — application charter

**Scope:** `apps/igor/`. Supplements the root [AGENTS.md](../../AGENTS.md) and
the interface charter [packages/design-system/AGENTS.md](../../packages/design-system/AGENTS.md);
the more protective rule wins.

## Identity

Igor is the user-facing name of the **Pantheon Director**, the existing
`pantheon-director` role (runtime profile `igor` in
`hermes/runtime-profiles.json`). `apps/igor` is that director's interface, not
another agent. Never create a Hermes role, profile, runtime identity,
orchestrator, model router, provider integration, or agent registry here.

## Ownership

Igor owns conversation records only: ids, titles, messages, ordering, pending
and failed state, and interface preferences, in its ignored data directory
(`STEX_IGOR_DATA_DIR`, default `apps/igor/.local-data/`). It never owns or
reads Hermes profiles, skills, memory, sessions, provider credentials, other
applications' files, protected manuscripts, Seaxneat workspaces, the User
Graph, or the application registry. Transcripts never go into the vault.

## Inference

The only path is `apps/igor` server → `services/inference` →
`stex.hermes.turn.v1` → Hermes (Pantheon Director). The server, never the
browser, starts each turn exactly once and holds the shared secret. Product is
`igor`; `conversation.id` is the Igor conversation id; `requestId` is the
pending reply's message id, reused on retry. Replies say whether they were
simulated (fake transport) and are never presented as live when they are not.
Streaming is not faked: a pending state is followed by the complete reply.

## Contract and interface

- API: [`stex.igor.conversations.v1`](../../protocol/igor/README.md). Pantheon
  uses only conversation creation (the handoff). Version changes to it.
- The visual reference is R03 (`assets/reference/pantheon-igor-comp.png`).
  Compare browser captures with it before accepting interface changes. Its
  sample data and non-functional controls (attachments, Markdown and code
  buttons, feedback thumbs, search) are not features; render only controls
  that work.
- Components emit the markup contract in [README.md](README.md); the
  stylesheet `src/styles/igor.css` styles only those classes. Keep structure
  (TSX) and styling (CSS) changes separate.
- Markdown is rendered without raw HTML; links open with
  `rel="noopener noreferrer"`. No `innerHTML` or `dangerouslySetInnerHTML`.

## Checks

`corepack pnpm run test:igor`, `corepack pnpm run build:igor`,
`corepack pnpm --dir apps/igor exec tsc --noEmit`, and
`corepack pnpm verify:igor` for browser acceptance.
