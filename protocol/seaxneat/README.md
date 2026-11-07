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

Generated content responses carry sandbox CSP without `allow-same-origin`.
Platform preview iframes likewise permit scripts only. Browser isolation is
not a claim of OS-level safety for arbitrary generated code or dependencies.

## Migration

The pre-existing `/api/projects…` endpoints remain unversioned compatibility
inputs over this same router/store, with raw successful result shapes.
The `/seaxneat/` UI entry redirects to `/workspaces/seaxneat/`, preserving query
parameters. Registry v2 and project-summary v1 retain their existing values;
Pantheon follows the compatibility entry to its composed workspace. Breaking
this new boundary requires a parallel v2 and an explicit consumer migration.

Evidence: [P1 acceptance](../../docs/verification/platform-transition-p1.md).
