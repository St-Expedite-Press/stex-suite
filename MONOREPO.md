# STEX Pantheon monorepo

## Ownership

Two repositories:

- **stex-suite (this repository, public)** owns the suite: Pantheon, Frige,
  Seaxneat, the design system, brand assets, contracts, and cross-application
  browser acceptance.
- **stex-igor (private submodule at `stex-igor/`)** owns everything that runs
  on the hosted VM, and deploys itself from its `main` branch.

The suite records which stex-igor commit it was tested with. Pushing to
stex-igor's `main` releases to production; review-branch pushes do not deploy.
The full ownership matrix is in
[the D1 report](docs/verification/stex-deployment-d1.md#3-ownership).


Pantheon owns shared presentation, composes publishing and website workspaces, routes
local HTTP, and reads the versioned application registry. Each engine owns its
canonical data and workflow state. Igor's private renderer is composed through
a versioned HTTP descriptor inside Pantheon's common shell; its standalone
surface remains available. [The transition plan](docs/PLATFORM-TRANSITION.md)
defines the acceptance gates. No product
imports another product's private storage as an integration shortcut.

`stex-igor/services/inference` is the only application-facing Hermes boundary.
`stex-igor/runtime/hermes-agent` pins the upstream runtime source; `stex-igor/hermes/` holds
STEX-owned declarative configuration only. Activation remains separately
authorized because the upstream runtime has powerful tools and owns provider
credentials. `vault/` is an optional
Obsidian-compatible User Graph. `services/knowledge` provides an optional
metadata journal with coordinated source/provenance and user-context views,
plus a separate legacy read-only vault adapter. The platform integration never
opens the vault. Applications continue to work with knowledge disabled.

## Layout

```
apps/pantheon   common web environment and workspace presentation
apps/frige      publishing engine; UI in apps/pantheon/workspaces/frige
apps/seaxneat   website engine; UI in apps/pantheon/workspaces/seaxneat
apps/eostre     deferred visual production domain
apps/woden      deferred narrative domain
vault           optional portable User Graph
services        knowledge boundary
stex-igor       hosted-VM submodule: Igor, inference, Hermes roster and runtime pin
protocol        versioned public contracts
```

## Compatibility and extraction

`/texgraph/`, `TEXGRAPH_*`, and `STEX_LAB_PORT` remain compatibility inputs at
their respective boundaries. New code uses Frige and Pantheon identifiers.
Existing ignored data at legacy source paths is not moved automatically:
configure the canonical Frige data variables if a user chooses a new location.

Hermes and the User Graph can be extracted later without moving engine state.
The Hermes runtime owns its provider credentials; the User Graph never does. A future extraction needs a
versioned integration contract and authorization; physical colocation alone
does not grant cross-subsystem authority.
