# STEX Pantheon Alpha monorepo

```text
apps/lab          local STEX shell and same-origin loopback proxy
apps/texgraph     Frige publishing application (TexGraph compatibility path)
apps/seaxneat     native TypeScript/Node/React website-development application
apps/screenlab    Eostre registry entry only in A0
apps/novelgraph   Woden registry entry only in A0
protocol/         versioned contracts and public references only
services/inference server-side fake/remote Hermes and TexGraph v3 compatibility adapter
```

The application registry is `protocol/applications/registry.v1.json`. It
declares navigation identities; it does not create shared storage or authority.
References use `stex://<product>/<kind>/<id>` and resolve only through their
owning application.

Frige and Seaxneat own their state independently. Lab is a shell/proxy, not a
database. The Obsidian vault is optional human knowledge and is never required
for either deterministic A0 workflow.

Hermes is separately deployed when configured. Applications communicate only
through the versioned server-side boundary in `services/inference`; browser code
never receives provider keys. Existing TexGraph inference endpoints remain a
compatibility surface while `stex.hermes.turn.v1` is additive.

Local development is the supported target. Deployment, paid inference,
Eostre/Woden migrations, user-vault integration, and cross-app workflows are
outside A0.
