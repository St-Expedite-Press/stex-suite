# STEX protocol

This directory contains the shared contracts between Pantheon presentation,
capability engines, and Igor services. Product code must not use another product's private storage,
runtime memory or implementation modules as an integration API.

- `vault/` defines the user-wide knowledge-base boundary.
- `texgraph/` defines the existing, product-specific editorial turn contract.
- `hermes/` defines the product-neutral v1 remote-Hermes turn envelope.
- `projects/` defines `stex.projects.summary.v1`, the read-only project
  summaries each studio serves for Pantheon's project lists.
- `applications/` holds the versioned application registry (v2 is current).
- `igor/` defines `stex.igor.conversations.v1` and the renderer interface,
  including Pantheon's handoff and HTTP composition.
- `context/` defines engine source exports and explicit Igor context consent.
- `knowledge/` defines metadata observations and reconstructible projections.
- `seaxneat/` defines `stex.seaxneat.workspace.v1`, the composed website
  workspace's engine API.
- `frige/` specifies publishing v1 and the extracted legacy books v1 compatibility boundary.

Contracts are versioned before two products rely on them. They describe data
ownership and failure behavior; they do not grant authority.

The [platform transition](../docs/PLATFORM-TRANSITION.md) records the implemented
publishing, contextual Igor, and optional metadata knowledge boundaries.
Existing registry, project, Igor and Hermes versions keep their meaning.
