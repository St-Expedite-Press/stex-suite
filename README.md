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

The checked-in ScreenLab code and the TexGraph/NovelGraph repositories under
`texgraph_integration/` are migration inputs. Their existing development
instructions and test suites remain authoritative until each module has moved
behind a tested replacement boundary. This avoids converting a repository move
into a claim that the application still works.

The initial workspace is declared in `pnpm-workspace.yaml`. It is intentionally
non-destructive: no package installation, cloud provisioning, OpenRouter call,
or Replit publication is part of setup.

## Direction

Development is local first. The inference module will later run on a dedicated
GCP machine. Individual applications may eventually deploy to Replit through
the same contracts they use locally.
