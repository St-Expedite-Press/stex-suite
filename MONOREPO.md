# STEX monorepo

STEX is rebuilt here from a minimum commitment: three separate graph
applications, a shared user knowledge base, and one provider boundary.

```text
apps/screenlab     visual work and print graph
apps/texgraph      mathematical and book-production graph
apps/novelgraph    manuscript and story graph
protocol/          versioned shared contracts only
services/inference local provider gateway -> dedicated GCP machine later
```

Each application owns its operational state. The user-wide Obsidian vault is
only a readable and editable knowledge base; see `protocol/vault/`.

Local development is the current target. Replit and the GCP inference machine
are deployment adapters to build after the local contracts work.
