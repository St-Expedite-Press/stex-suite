# Platform project list v1

`stex.platform.projects.v1` is served by the Python platform API
(`backend/stex`) at `GET /api/v1/projects`. It merges every active studio's
[`stex.projects.summary.v1`](../projects/README.md) into one read-only list.
The schema is [`projects.v1.schema.json`](projects.v1.schema.json); the
generated OpenAPI document is [`openapi.v1.json`](openapi.v1.json).

Status: introduced in M1; consumed since M2a. Pantheon forwards
`GET /api/platform/v1/projects` here (read-only, no browser headers), and its
home, projects and studios pages render from this list, falling back to
polling each studio from the browser when the platform is unavailable.

## Ownership

The platform owns only this merged read model. Each studio keeps its own
endpoint and data. The platform reads studios over loopback HTTP
(`STEX_FRIGE_URL`, `STEX_SEAXNEAT_URL`) at their registry mount, for example
`/frige/api/stex/projects`, exactly as Pantheon's proxy forwards the browser's
request. It never reads studio files and caches nothing.
Studios polled are those the [application registry](../applications/registry.v2.json)
lists with `kind: "studio"` and `state: "active"`; deferred studios and
non-studio applications such as Igor are never polled.

## Response

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

## Failure behaviour

The endpoint itself answers `200` whenever the platform is running, even if
every studio is unavailable. An invalid registry stops the platform at
startup rather than serving a guessed list.

## Versioning

Additive optional fields may be added to v1. Removing or changing a field's
meaning requires `stex.platform.projects.v2`, served alongside v1.
