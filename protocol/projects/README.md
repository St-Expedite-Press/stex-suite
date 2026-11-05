# Project summary contract v1

`stex.projects.summary.v1` lets Pantheon list a studio's projects without
reading the studio's storage. Each studio owns its endpoint and its data;
Pantheon only reads and renders. The schema is
[`summary.v1.schema.json`](summary.v1.schema.json).

## Ownership and endpoint

| Studio | Endpoint (served by the studio) | Through Pantheon |
| --- | --- | --- |
| Frige | `GET /api/stex/projects` | `/frige/api/stex/projects` |
| Seaxneat | `GET /api/stex/projects` | `/seaxneat/api/stex/projects` |

Deferred studios (Ēostre, Woden) do not serve it; Pantheon shows them as
deferred, not as empty.

The endpoint is read-only, unauthenticated on loopback like the rest of each
studio's API, and must not create, migrate, or touch project files (Frige
reads file times only; protected manuscripts are never opened for writing).

## Response

```json
{
  "schemaVersion": "stex.projects.summary.v1",
  "application": "frige",
  "projects": [
    {
      "reference": "stex://frige/project/field-notes",
      "id": "field-notes",
      "title": "Field Notes",
      "kind": "book",
      "updatedAt": "2026-11-05T17:02:11.000Z",
      "status": { "state": "ready", "label": "Manuscript" },
      "openPath": "/?book=field-notes"
    }
  ]
}
```

- `reference` is the studio's own `stex://` reference, as it already emits it.
- `kind` is a lower-case noun the studio chooses (`book`, `website`).
- `updatedAt` is the last real change the studio knows of (ISO 8601, UTC), or
  `null` when it cannot tell. Consumers sort by it and show relative time; they
  never invent a time.
- `status.state` is one of `ready`, `working`, `attention`, `failed`;
  `status.label` is short, specific display text written by the studio
  ("Build failed", "Building"). Consumers never pair colour alone with state.
- `openPath` starts with a single `/`, contains no `..` segment, and is
  relative to the studio's mount; Pantheon prefixes the registry route
  (`/frige/` + `?book=…`) and drops entries that break these rules.

### Studio mappings

| Studio | `kind` | `updatedAt` | `status` |
| --- | --- | --- | --- |
| Frige | `book` | Newest modification time among the book's files, from metadata only. Hidden folders (`.git`, `.texgraph`, `.obsidian`) and `node_modules` are skipped as tooling; symlinks are not followed; at most 5,000 entries per book are visited | `ready` / "Manuscript" |
| Seaxneat | `website` | The project's `updatedAt` | From the operation: `running` → `working` "Building" (or "Applying edit", "Restoring"); `failed` → `failed` "Build failed" ("Setup failed" for provisioning); `needs_attention` → `attention` "Needs attention"; otherwise from the project: `provisioning` → `working` "Setting up", `failed` → `failed` "Setup failed", `ready` → `ready` "Build ready" |

## Failure behaviour

A consumer that cannot reach a studio within 2 seconds, or receives anything
other than a valid v1 document, shows that studio as **unavailable** and keeps
the other studios' projects. It never caches summaries into its own storage
and never falls back to reading studio files.

## Versioning

Additive optional fields may be added to v1. Removing or changing the meaning
of a field requires `stex.projects.summary.v2`, served alongside v1 until every
consumer has moved.

## Known conflict

The application registry lists Frige's reference kinds as `book`, `node`, and
`proof`, while Frige emits `stex://frige/project/<id>` references. This
contract reports what Frige emits; reconciling the two is left to a registry
version change.
