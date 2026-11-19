# STEX application registry

The registry defines the identities that the local STEX shell may show. It is a
public navigation contract, not a shared database or authorization mechanism.
The `stex://` forms are `stex://<id>/<reference-kind>/<id>`; the owning
application alone resolves and authorizes them.

## v2 (current)

`registry.v2.json` (schema `registry.v2.schema.json`) adds a required `kind`:

| `kind` | Meaning | Members |
| --- | --- | --- |
| `studio` | A creative studio: owns projects, appears in studio lists, serves `stex.projects.summary.v1` when active | Frige, Seaxneat (active); Eostre, Woden (deferred) |
| `application` | A Pantheon application that is not a studio; never listed or polled as one | Igor (`/igor/`, conversations) |

Pantheon reads v2. Consumers that list studios or projects filter on
`kind === "studio"`.

Registry routes are stable navigation inputs, not frontend ownership. In P1,
`/seaxneat/` redirects to Pantheon's `/workspaces/seaxneat/`; its API subtree
continues to proxy the engine. This does not change v2 or grant capabilities.

## v1 (historical)

`registry.v1.json` (schema `registry.v1.schema.json`) lists only the four
studios and has no `kind`. It is unchanged and no longer read by Pantheon;
keep it until no consumer depends on it.
