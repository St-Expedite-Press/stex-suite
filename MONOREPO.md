# STEX Pantheon monorepo

## Ownership

Two repositories:

- **stex-suite (this repository, public)** owns the suite: Pantheon, Frige,
  Seaxneat, the design system, brand assets, contracts, and cross-application
  browser acceptance.
- **stex-igor (private submodule at `stex-igor/`)** owns everything that runs
  on the hosted VM, and deploys itself from its `main` branch.

The suite records which stex-igor commit it was tested with. Pushing stex-igor
is what releases to production. The full ownership matrix is in
[the D1 report](docs/verification/stex-deployment-d1.md#3-ownership).


Pantheon routes local HTTP and reads the versioned application registry. Each
application owns its UI, canonical data, and workflow state. No product
imports another product's private storage as an integration shortcut.

`stex-igor/services/inference` is the only application-facing Hermes boundary.
`stex-igor/runtime/hermes-agent` pins the upstream runtime source; `stex-igor/hermes/` holds
STEX-owned declarative configuration only. Activation remains separately
authorized because the upstream runtime has powerful tools and owns provider
credentials. `vault/` is an optional
Obsidian-compatible User Graph. `services/knowledge` is a replaceable,
read-only adapter; applications continue to work without it.

## Layout

```
apps/pantheon   loopback shell
apps/frige      publishing and typesetting
apps/seaxneat   website workspaces
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

Hermes and the User Graph can be extracted later because neither owns product
state, credentials, or application modules. A future extraction needs a
versioned integration contract and authorization; physical colocation alone
does not grant cross-subsystem authority.
