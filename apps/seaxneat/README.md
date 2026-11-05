# Seaxneat Alpha

Seaxneat is STEX’s local website-development application. It is a native
TypeScript/React interface backed by a Node server; it does not run the legacy
Agent Studio Python/cloud/orchestrator stack.

Run `corepack pnpm --dir apps/seaxneat test` for deterministic state tests.
After root dependencies are installed, run:

```powershell
corepack pnpm --dir apps/seaxneat build
corepack pnpm --dir apps/seaxneat dev
```

Use the shell route `http://127.0.0.1:4300/seaxneat/`. Create a project to seed
an isolated Next.js workspace, start its preview, request a heading edit,
inspect/apply it explicitly, and restore a validated revision when needed.
State defaults to ignored `.local-data/`, or set `STEX_SEAXNEAT_DATA_DIR`.

The deterministic simulator is not a claim of real Hermes/model behavior.
Builds and previews run loopback-only; a failed build never advances the last
validated revision.
