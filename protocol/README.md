# STEX protocol

This directory contains the shared contracts between the independent STEX
applications. Product code must not use another product's private storage,
runtime memory or implementation modules as an integration API.

- `vault/` defines the user-wide knowledge-base boundary.
- `texgraph/` defines the existing, product-specific editorial turn contract.
- `hermes/` defines the product-neutral v1 remote-Hermes turn envelope.
- `projects/` defines `stex.projects.summary.v1`, the read-only project
  summaries each studio serves for Pantheon's project lists.
- `applications/` holds the versioned application registry (v2 is current).
- `igor/` defines `stex.igor.conversations.v1`, the Igor application's
  conversation API, including Pantheon's handoff.

Contracts are versioned before two products rely on them. They describe data
ownership and failure behavior; they do not grant authority.
