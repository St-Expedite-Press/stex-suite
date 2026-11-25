# Seaxneat workspace v1

`stex.seaxneat.workspace.v1` is the HTTP boundary consumed by Pantheon's
website workspace. Seaxneat owns all project state, source, Git history,
proposal validation, builds and preview lifecycle. Pantheon holds presentation
state only. Neither side imports the other's private modules or files.

## Endpoints

Engine prefix: `/api/stex/workspace/v1`; through Pantheon:
`/seaxneat/api/stex/workspace/v1`. Paths below are relative to that prefix.

| Method | Path | Input | Successful result |
| --- | --- | --- | --- |
| GET | `/projects` | None | Project summaries |
| POST | `/projects` | `title`: nonblank string, at most 120 characters | `201` project summary, including failed setup |
| GET | `/projects/<id>` | None | Project summary |
| GET | `/projects/<id>/proposal` | None | Pending proposal, or `null` |
| POST | `/projects/<id>/proposal` | `message`: nonblank string, at most 800 characters | `201` deterministic proposal |
| POST | `/projects/<id>/apply` | `proposalId`: nonblank string, at most 80 characters | Project summary after validation |
| POST | `/projects/<id>/dismiss` | Same decision input | Project summary |
| GET | `/projects/<id>/diff?revision=<revision>` | Known revision id | `{diff: string}` against current HEAD |
| POST | `/projects/<id>/restore` | `revision`: known revision, at most 80 characters | Project summary with a new validated revision |
| POST | `/projects/<id>/preview` | `{}` | `{state, path}` after a successful build |
| POST | `/projects/<id>/preview/stop` | `{}` | `{state: "stopped", path}`; idempotent |

Every successful response is `{schemaVersion: "stex.seaxneat.workspace.v1",
result: ...}`. Every routed error is `{schemaVersion, code, error}`. A summary
includes `id`, `title`, `ref`, `status`, `operation`, timestamps, `revisions`,
`revisionCount`, `messageCount`, `hasPendingProposal`, `lastValidatedRevision`,
and nullable `preview`. `lastValidatedRevision` is `null` when initial setup
failed; a Git seed alone is not a successful build. Revision records include
`id`, `kind`, `createdAt`, and `sourceHash`. The `seed` kind can be unvalidated
on failed setup. A proposal includes `id`, `path`, `baseHash`, `source`,
`request`, timestamps and the `deterministic` simulator label.

Preview results and summary preview fields contain only a relative mounted
path, state and, in summaries, update time. Private preview origins are not
part of this versioned response. The preview content still uses the existing
`/seaxneat/api/projects/<id>/preview/…` route because generated Next assets are
built with that base path.

## Authority, bounds and failures

This is a local single-user boundary, not a permission grant. The engine binds
to loopback, refuses non-loopback Host values, and accepts a present browser
Origin only when it equals the engine's origin or configured loopback
`STEX_PANTHEON_URL`. Opaque (`null`) and foreign origins and cross-site browser
requests are refused with `403` for engine APIs. The explicit exception is
GET/HEAD of project preview content/assets: sandboxed documents may load their
own resources, with `Access-Control-Allow-Origin: null` for opaque-origin
requests. This never opens project-data or mutation routes and forwards no
credentials/cookies to the generated server. Local CLI calls without Origin remain allowed.
Those pre-routing denials use `{code,error}` without a version envelope.
Pantheon forwards its own Host as metadata but it grants no new authority.

Requests are limited to 200,000 characters; ids match
`[a-z0-9][a-z0-9-]{0,62}`. POST bodies must be JSON objects. Existing engine
path validation, proposal base hashes, revision lookup and build checks remain
authoritative. Builds bound each install/build command to 180 seconds; Git
commands to 30 seconds. The platform waits at most 390 seconds and never
automatically retries a mutation. Disconnecting does not cancel or roll back
an already started engine operation; inspect durable operation state first.

Only one mutation per project is admitted at a time (including compatibility
routes); creation is serialized separately. Busy requests fail `409 BUSY`.
Stale proposals fail `409 STALE_PROPOSAL`; build failures fail `422
BUILD_FAILED` and do not advance validation. Failed apply restores the exact
pre-edit bytes. Unknown routes/projects/revisions fail `404 NOT_FOUND`,
unsupported methods `405 METHOD_NOT_ALLOWED` with Allow, other invalid input
`400 INVALID_REQUEST`. Interrupted operations remain `needs_attention` after
restart and are not replayed. A failed initial build returns `201` with a
failed project and null validated revision so it remains inspectable.

Generated content responses carry this CSP (exported as
`PREVIEW_CONTENT_SECURITY_POLICY`): `sandbox allow-scripts` (no
`allow-same-origin`), `frame-ancestors 'self'`, `default-src 'self'`,
`connect-src 'self'`, `img-src 'self' data: blob:`, `style-src 'self'
'unsafe-inline'`, `script-src 'self' 'unsafe-inline'`, `font-src 'self' data:`,
`form-action 'none'`, `base-uri 'none'`, `object-src 'none'`. Inline scripts
stay allowed because the Next.js runtime bootstraps with them. Platform preview
iframes likewise permit scripts only.

What remains possible for generated code: run inline script and style; load
resources and `data:`/`blob:` images from its own mount; fetch/XHR/WebSocket to
its own mount only (opaque-origin requests to any engine route other than
preview GET/HEAD are refused by the origin checks above, though a CORS "simple"
cross-origin POST is still sent and then refused); navigate its own frame
(CSP does not govern frame navigation, and the sandbox blocks only top
navigation and popups). Connections, images, fonts, forms and plugins to other
origins are blocked; `verify:platform` checks an external fetch and image.

### Preview lifecycle

States reported in `preview.state`: `starting`, `running`, `stopped`,
`failed` (`not_started` when the engine has no starter). Rules:

- The preview port starts at a hash of the project id inside 4400-5399. A port
  that is taken (another project, or any foreign loopback listener) is skipped,
  and an `EADDRINUSE` race moves to the next candidate, over a bounded range of
  25 ports; exhaustion fails with `NO_PREVIEW_PORT`.
- `POST .../preview/stop` terminates the preview process tree, records
  `stopped` with no target and the proxy then refuses requests. Same Host and
  Origin checks and per-project busy lock as other mutations.
- A build, apply or restore stops a running preview before building and starts
  it again only after a successful build, so a preview never serves a stale or
  half-written build. If the build fails, the preview stays `stopped`; a
  failed restart is recorded as `failed`. Stored live states become
  `stopped` when the engine restarts, because the processes died with it.
- A restore whose build fails returns the draft to its exact pre-restore
  bytes, like apply; it records a failed operation and never advances
  `lastValidatedRevision`.

### Isolation limits (S1 is not done)

There is no OS-level isolation. Generated code and its dependencies (installed
and built by `pnpm`, then run by `next start`) execute as the signed-in OS
user with an allow-listed environment that still includes `HOME`. There are no
CPU, memory, disk or process limits, no network namespace or egress filter for
the build/preview processes (the CSP above constrains only browser-side
requests), and no filesystem confinement beyond the working directory. Build
and install steps can reach the network and the user's files. The CSP, sandbox
and environment allow-list reduce browser-side exposure only; OS/container
isolation (milestone S1) is required before this is safe for untrusted input.

## Migration

The pre-existing `/api/projects…` endpoints remain unversioned compatibility
inputs over this same router/store, with raw successful result shapes.
The `/seaxneat/` UI entry redirects to `/workspaces/seaxneat/`, preserving query
parameters. Registry v2 and project-summary v1 retain their existing values;
Pantheon follows the compatibility entry to its composed workspace. Breaking
this new boundary requires a parallel v2 and an explicit consumer migration.

Evidence: [P1 acceptance](../../docs/verification/platform-transition-p1.md).
