# STEX Pantheon Alpha A0 verification report

**Base revision:** `cd20562f34d9dc0607f4e3c235812fe12bb797c6` on
`feat/hermes-conversation-parts`
**Final revision:** this report's commit (`git rev-parse HEAD`)
**Agent Studio reference:** `St-Expedite-Press/agent-studio@94ba5cc799cf40f9223fd3b1cc2bef32adc0ed2e`

## Delivered

- Lab is the local shell with `/frige/`, `/seaxneat/`, deferred `/eostre/` and
  `/woden/`, plus `/texgraph/` compatibility routing.
- Frige remains `apps/texgraph`, including its protected book storage and
  compiler-backed proof workflow, is mount-aware under `/frige/`, and has an
  explicit local selector/create-project page.
- Seaxneat is a Node/React/TypeScript application with isolated ignored state,
  durable atomic records, Git revision/restore, bounded deterministic edits,
  Next provisioning/build, and loopback preview proxying.
- `stex.hermes.turn.v1` provides authenticated fake and remote transports.
  TexGraph v3 routes are now compatibility adapters over it; the active
  inference server does not make direct provider calls.

## Evidence

| Command | Result |
| --- | --- |
| `corepack pnpm --dir apps/lab test` | 5 passed |
| `corepack pnpm --dir apps/texgraph test` | 42 passed, including LuaLaTeX proof/preflight and isolated project-creation cases |
| `corepack pnpm --dir services/inference test` | 18 passed |
| `corepack pnpm --dir apps/seaxneat test` | 8 passed |
| `node --check apps/seaxneat/server.mjs` and `services/inference/server.mjs` | passed |
| `git diff --check` | passed |

The root launcher `corepack pnpm dev:alpha` was started on disposable loopback
ports. Shell, Frige, Seaxneat, deferred routes, and fake Hermes health returned
200; `/texgraph/` returned its compatibility redirect. Browser evidence
confirmed that the splash page opens Frige's local project selector and
Seaxneat's project selector. A disposable Seaxneat project completed
provisioning, Next preview with mounted assets, deterministic edit/apply,
diff, and restore. A root-relative Next asset defect and trailing-slash proxy
redirect found during acceptance were repaired and the final mounted preview
loaded with no browser resource errors.

## Manual acceptance

1. Run `corepack pnpm install --frozen-lockfile` then `corepack pnpm dev:alpha`.
2. Visit `http://127.0.0.1:4300/frige/`; select an existing local book or
   create a disposable book, then edit, build/view a PDF proof, inspect source
   currency, and request a fake proposal.
3. Visit `/seaxneat/`; create a project, wait for provisioning, start preview,
   prepare/apply a heading edit, inspect a diff, and restore the seed revision.
4. Confirm `/eostre/` and `/woden/` honestly report deferred status.

## Limits and rollback

Remote Hermes, deployment, Eostre/Woden, vault integration, and paid/provider
inference are unverified and out of scope. No provider call was made. Roll back
code with ordinary version-control reversion; remove only explicitly created
ignored Seaxneat data directories such as `apps/seaxneat/.local-data` or the
named disposable `%TEMP%` fixtures.
