# Platform contracts

This directory holds two contracts: the project list (`stex.platform.projects.v1`,
below) and the [platform actor](#platform-actor-v1) (`stex.platform.actor.v1`).

## Project list v1

`stex.platform.projects.v1` is served by the Python platform API
(`backend/stex`) at `GET /api/v1/projects`. It merges every active studio's
[`stex.projects.summary.v1`](../projects/README.md) into one read-only list.
The schema is [`projects.v1.schema.json`](projects.v1.schema.json); the
generated OpenAPI document is [`openapi.v1.json`](openapi.v1.json).

Status: introduced in M1; consumed since M2a. Pantheon forwards
`GET /api/platform/v1/projects` here (read-only, no browser headers), and its
home, projects and studios pages render from this list, falling back to
polling each studio from the browser when the platform is unavailable.

### Ownership

The platform owns only this merged read model. Each studio keeps its own
endpoint and data. The platform reads studios over loopback HTTP
(`STEX_FRIGE_URL`, `STEX_SEAXNEAT_URL`) at their registry mount, for example
`/frige/api/stex/projects`, exactly as Pantheon's proxy forwards the browser's
request. It never reads studio files and caches nothing.
Studios polled are those the [application registry](../applications/registry.v2.json)
lists with `kind: "studio"` and `state: "active"`; deferred studios and
non-studio applications such as Igor are never polled.

### Response

```json
{
  "schemaVersion": "stex.platform.projects.v1",
  "studios": [
    { "id": "frige", "state": "available" },
    { "id": "seaxneat", "state": "unavailable" }
  ],
  "projects": [
    {
      "studio": "frige",
      "reference": "stex://frige/project/field-notes",
      "id": "field-notes",
      "title": "Field Notes",
      "kind": "book",
      "updatedAt": "2026-11-05T17:02:11.000Z",
      "status": { "state": "ready", "label": "Manuscript" },
      "openPath": "/?book=field-notes",
      "href": "/frige/?book=field-notes"
    }
  ]
}
```

- `studios` lists every polled studio in registry order. `unavailable` means
  the studio did not answer within 2 seconds, answered with a non-2xx status
  or redirect, sent a compressed body (the platform asks for `identity`),
  sent more than 2 MB, or sent anything other than a v1 summary whose
  `application` is that studio. The other studios' projects are kept.
- The body is decoded like a browser's `response.json()`: UTF-8 with any BOM
  removed and invalid bytes replaced by U+FFFD. Lone surrogate escapes in
  string values are replaced with `?` so the reply is always valid UTF-8.
- `projects` contains studio entries that satisfy the consumer rules of
  summary v1 (non-empty `title`, string `id`/`kind`, valid `status`, and an
  `openPath` that starts with one `/` and has no `..` segment); others are
  dropped. `href` is the registry route joined with `openPath`.
- `reference` and `updatedAt` are `null` when the studio omitted them or sent
  a non-string. Unknown studio fields are not passed through.
- Order is newest `updatedAt` first; missing or unparsable times sort last,
  keeping studio order. Times are parsed as ISO 8601 (Python
  `datetime.fromisoformat`); a time without an offset is read as UTC. This
  differs from JavaScript `Date.parse` for non-RFC 3339 forms (for example
  `Nov 5, 2026` sorts last here; `20261105` is accepted here). Studios emit
  RFC 3339 UTC times, where the two agree.

### Failure behaviour

The endpoint itself answers `200` whenever the platform is running, even if
every studio is unavailable. An invalid registry stops the platform at
startup rather than serving a guessed list.

### Versioning

Additive optional fields may be added to v1. Removing or changing a field's
meaning requires `stex.platform.projects.v2`, served alongside v1.

## Platform actor v1

`stex.platform.actor.v1` tells an engine which signed-in person made a
request that came through hosted Pantheon ([D-028](../../docs/program/DECISIONS.md#d-028--a-verified-actor-reaches-the-engines)).
It is attribution and personal-state ownership only. It grants no access
that the engine did not already allow.

### Headers

| Header | Value |
| --- | --- |
| `x-stex-actor` | The actor ID uses 1 to 128 visible ASCII characters (0x21–0x7e). It carries the Igor username directly if it fits and falls outside the reserved digest format. Other valid usernames use the digest described below. |
| `x-stex-actor-role` | `owner` or `member` |
| `x-stex-platform-token` | The shared secret `STEX_PLATFORM_ACTOR_SECRET` (at least 32 characters) |

Pantheon reserves actor IDs matching `^sha256-[0-9a-f]{64}$`. A username
that matches this pattern, or cannot travel directly in the header, is
encoded as a JSON string, including its quotes and escapes. Pantheon hashes
that string's UTF-8 bytes with SHA-256 and prefixes the lowercase hex
digest with `sha256-`.

### Pantheon (the only sender)

- It deletes all three headers from **every** incoming request, in every
  mode, before routing. A browser can never supply them.
- In hosted mode, for a request its gate admitted with a signed-in user, it
  sets all three headers on requests to engines that verify them. Today that
  is Frige alone, including the legacy `/api/books` proxy and the knowledge
  API's server-to-server calls to Frige.
- An engine that does not verify the actor (Seaxneat today) never receives
  the token.
- It never sends them to Igor, which has its own session, or to generated
  preview content.
- With no secret configured, it sends none.

### Engines (receivers)

Each engine resolves one actor per request:

| Engine configuration | Request | Actor |
| --- | --- | --- |
| No `STEX_PLATFORM_ACTOR_SECRET` (local mode) | Any; actor headers are ignored | `{ id: "local", role: "owner", verified: false }` |
| Secret set | Token matches (constant-time comparison) and the actor and role are valid | `{ id, role, verified: true }` |
| Secret set | Token missing or wrong, or the actor or role is invalid | none |

With the secret set, a request that changes state and has no actor is
refused: `401 { code: "ACTOR_REQUIRED" }`. Reads without an actor keep
today's behaviour, so Igor's loopback context reads still work. Engines
record `actor.id` as attribution on the records they create. They must not
log the token.

### Versioning

New optional headers may be added. Changing a header's meaning needs
`stex.platform.actor.v2`.
