# STEX

STEX is a local monorepo for three independent graph applications:

- **ScreenLab** — visual work and print production.
- **TexGraph** — mathematical books, poetry and compilation.
- **NovelGraph** — fiction, manuscripts and story structure.

The products share a user-wide Obsidian knowledge base and a controlled
inference service. They do not share a database, runtime memory, credentials,
or internal implementation modules.

Read [MONOREPO.md](MONOREPO.md) for the architecture being rebuilt and
[protocol/vault](protocol/vault/README.md) for the knowledge-base boundary.

## Current migration state

This is a clean-slate repository. The legacy cluster is deliberately excluded:
its source, history, credentials, and runtime assumptions are not part of this
repository and are not authoritative here. Recover a legacy capability only
through an explicit, evidence-based migration decision.

The initial workspace is declared in `pnpm-workspace.yaml`. It is intentionally
minimal: no package installation, cloud provisioning, OpenRouter call, or
Replit publication is part of setup.

## Direction

Development is local first. The inference module will later run on a dedicated
GCP machine. Individual applications may eventually deploy to Replit through
the same contracts they use locally.
