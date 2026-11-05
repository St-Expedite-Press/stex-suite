# STEX Pantheon monorepo

## Ownership

Pantheon routes local HTTP and reads the versioned application registry. Each
application owns its UI, canonical data, and workflow state. No product
imports another product's private storage as an integration shortcut.

`services/inference` is the only application-facing Hermes boundary.
`hermes/` holds STEX-owned configuration only; an upstream runtime remains an
external, separately authorized dependency. `vault/` is an optional
Obsidian-compatible User Graph. `services/knowledge` is a replaceable,
read-only adapter; applications continue to work without it.

## Layout

```
apps/pantheon   loopback shell
apps/frige      publishing and typesetting
apps/seaxneat   website workspaces
apps/eostre     deferred visual production domain
apps/woden      deferred narrative domain
hermes          roster, profiles, skills, and policies
vault           optional portable User Graph
services        inference and knowledge boundaries
protocol        versioned public contracts
```

## Compatibility and extraction

`/texgraph/`, `TEXGRAPH_*`, and `STEX_LAB_PORT` remain compatibility inputs at
their respective boundaries. New code uses Frige and Pantheon identifiers.
Existing ignored data at legacy source paths is not moved automatically:
configure the canonical Frige data variables if a user chooses a new location.

Hermes and the User Graph can be extracted later because neither owns product
state, credentials, or application modules. A future extraction needs a
versioned integration contract and authorization; physical colocation alone
does not grant cross-subsystem authority.
