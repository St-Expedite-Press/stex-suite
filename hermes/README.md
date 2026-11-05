# Hermes development configuration

This directory is the STEX-specific, source-controlled configuration for a
future external Hermes runtime. It is not a Hermes runtime, provider client,
session store, credential store, or autonomous worker pool.

`roster.yaml` is the single machine-readable authority for Pantheon roles.
It is JSON syntax, which is valid YAML, so the repository can validate it
without adding a YAML parser dependency. Profiles describe bounded reasoning
roles. Tool authority remains in STEX product and service code; profile text
cannot grant filesystem, canonical-state, vault, network, or provider access.

Validate this configuration with `corepack pnpm run test:hermes`. A separately
installed Hermes runtime may consume this configuration only after a later,
authorized compatibility and remote-verification milestone. Runtime sessions,
memories, caches, logs, and credentials must remain outside version control.
