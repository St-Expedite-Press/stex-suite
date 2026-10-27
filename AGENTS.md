# STEX development guide

STEX is a new local-first monorepo. Do not restore, import, or imitate the
archived legacy cluster without a specific product requirement and an
evidence-backed decision.

## Product boundaries

- `apps/screenlab/`, `apps/texgraph/`, and `apps/novelgraph/` are independent
  graph applications. Each owns its UI, operational data model, and workflow.
- `protocol/` is the only shared product vocabulary. Add a versioned contract
  here before one product relies on another.
- The Obsidian vault is a user knowledge base. It holds readable notes,
  sources, preferences and `stex://` references; it is never a credential,
  queue, lock, telemetry, or product-state store.
- `services/inference/` is the sole OpenRouter boundary. Product code must not
  call a provider directly or receive provider credentials.

## Development and deployment

Develop every module locally first. The inference service may later move to a
dedicated GCP machine; product applications may later deploy to Replit. Those
are deployment changes, not reasons to weaken local boundaries or bake a host
into domain code.

Do not provision cloud resources, make paid provider calls, publish packages,
or deploy to Replit unless the user explicitly requests that external action.

## Engineering standard

Treat claims as evidence levels: source existence is not execution, a unit
test is not an integration test, and an app screenshot is not a working user
path. Keep one authority for each state transition. Prefer deterministic code
for parsing, rendering, validation, IDs, checksums, packaging and graph
operations. A model may propose content; code validates and commits it.

Before an invasive change, inspect the working tree and preserve unrelated
work. Do not add abstraction, services, agents, or dependencies without a
concrete caller and a tested failure model. Report what was actually tested and
what remains unverified.

## Repository integrity

Use `apply_patch` for source edits. Do not add credentials to tracked files,
logs, tests or browser bundles. Keep local environments, build outputs and
user vaults ignored. The sibling legacy archive is not part of this monorepo
and must not be modified unless the user explicitly asks.
