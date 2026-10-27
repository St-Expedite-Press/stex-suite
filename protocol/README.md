# STEX protocol

This directory contains the shared contracts between the independent STEX
applications. Product code must not use another product's private storage,
runtime memory or implementation modules as an integration API.

- `vault/` defines the user-wide knowledge-base boundary.
- Future protocol surfaces define typed references, inference requests and
  application events.

Contracts are versioned before two products rely on them. They describe data
ownership and failure behavior; they do not grant authority.
