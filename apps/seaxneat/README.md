# Seaxneat Alpha

Seaxneat is Pantheon's local website capability engine. Its existing Node
server owns workspace state, Git history, proposals, builds and previews.
The TypeScript/React presentation now belongs to Pantheon at
`apps/pantheon/workspaces/seaxneat`; there is one implementation of that UI.
The engine does not run the legacy Agent Studio Python/cloud/orchestrator stack.

Run `corepack pnpm --dir apps/seaxneat test` for deterministic state tests.
After root dependencies are installed, run:

```powershell
corepack pnpm --dir apps/seaxneat build
corepack pnpm --dir apps/seaxneat dev
```

Use `corepack pnpm dev:alpha`, then open
`http://127.0.0.1:4300/workspaces/seaxneat/`. The old `/seaxneat/` entry redirects
there, preserving `?project=<id>`. The engine's standalone root also redirects
to `STEX_PANTHEON_URL` (default `http://127.0.0.1:4300`); Pantheon must run for
the UI. `build:seaxneat` remains an alias for the Pantheon workspace build.
Create a project to seed
an isolated Next.js workspace, start its preview, request a heading edit,
inspect/apply it explicitly, and restore a validated revision when needed.
State defaults to ignored `.local-data/`, or set `STEX_SEAXNEAT_DATA_DIR`.
`?project=<id>` opens that project directly (Pantheon's project lists use it).

`GET /api/stex/projects` serves the projects as
[`stex.projects.summary.v1`](../../protocol/projects/README.md) for Pantheon
(mapping in `src/project-summary.mjs`): status labels come from the real
operation and project state ("Building", "Build failed", "Needs attention",
"Build ready").

The deterministic simulator is not a claim of real Hermes/model behavior.
Builds and previews run loopback-only; a failed build never advances the last
validated revision.

The platform uses the versioned
[`stex.seaxneat.workspace.v1`](../../protocol/seaxneat/README.md) HTTP facade;
unversioned project routes remain compatibility inputs over the same store.
Pending proposals can be read after reload, explicit dismissal is durable,
mutations on the same project are refused while busy, and failed edits restore
the exact pre-edit source bytes. Failed setup remains visible with a null
validated revision. A timeout does not replay an operation automatically.

The server binds to loopback, rejects non-loopback Host values, and accepts
browser origins only from its own address or the configured loopback
`STEX_PANTHEON_URL`. Missing Origin remains available to local CLI clients.
Opaque and foreign browser origins are refused for engine APIs. Read-only
preview content/assets admit the sandbox's opaque requests, with
`Access-Control-Allow-Origin: null` only when requested from that opaque
origin; no engine credentials or cookies are forwarded to the preview.
Preview responses carry
`Content-Security-Policy: sandbox allow-scripts; frame-ancestors 'self'`, and
the platform iframe omits `allow-same-origin`. This protects the trusted
platform document; it does not establish OS isolation for generated builds.
Run `corepack pnpm verify:platform` for a disposable real Next.js workflow.
