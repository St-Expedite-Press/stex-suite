# Hermes development configuration

This directory is the STEX-specific, source-controlled configuration for the
pinned upstream Hermes source at `runtime/hermes-agent`. It is not the runtime
itself, a provider client, session store, credential store, or autonomous
worker pool.

`roster.yaml` is the single machine-readable authority for Pantheon roles.
It is JSON syntax, which is valid YAML, so the repository can validate it
without adding a YAML parser dependency. Profiles describe bounded reasoning
roles. Tool authority remains in STEX product and service code; profile text
cannot grant filesystem, canonical-state, vault, network, or provider access.

Validate this configuration with `corepack pnpm run test:hermes`. H1's STEX
adapter speaks the upstream OpenAI-compatible API and preserves the
`stex.hermes.turn.v1` boundary; it does not activate the roster or delegation.
Runtime sessions, memories, caches, logs, and credentials remain outside
version control. In particular, `OPENROUTER_API_KEY` and `API_SERVER_KEY`
belong only in the upstream Hermes environment, never here or in STEX `.env`.

`runtime-profiles.json` is the source-controlled map from the eight STEX
profiles to Hermes runtime profile names. Igor alone is marked active; the
seven specialists are provisioned as inactive/parked runtime profiles. The
read-only `corepack pnpm run check:hermes-runtime` command reports a missing
local profile, a non-OpenRouter provider selection, or an enabled Igor toolset
on either the CLI or API-server platform without creating, changing, starting,
or reading credentials.
The source profile JSON files describe proposal and context authority only;
they never grant execution or provider access.
