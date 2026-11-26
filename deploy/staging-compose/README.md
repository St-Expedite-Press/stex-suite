# Local staging stack

Pantheon, Frige and the Python platform API as three containers, for local
verification only. It uses synthetic data and fake inference, and holds no
secrets. It is not a deployment: the VM keeps its systemd units and release
installers (`stex-igor/deploy`).

```sh
docker compose -f deploy/staging-compose/compose.yaml up -d --build
node scripts/verify/verify-staging-compose.mjs        # HTTP workflow, proof, Frige recreate, knowledge, notes
node scripts/verify/verify-passages-browser.mjs       # Chrome: passage search, citation, approve, withdraw
docker compose -f deploy/staging-compose/compose.yaml down -v   # also deletes the synthetic volumes
```

| Service | Network | State | Notes |
| --- | --- | --- | --- |
| `pantheon` | `studio` and `edge`; published only as `127.0.0.1:4300` | none | `STEX_KNOWLEDGE_SERVICE=platform`: relays knowledge, opens no journal |
| `frige` | `studio` (internal, no outside access) | `frige-data` volume | LuaLaTeX from the same Debian packages as the VM; fake inference; no converter |
| `platform` | `studio` | `knowledge-data` volume; synthetic vault mounted read-only | owns the knowledge journals |
| `seed` | none | writes one synthetic book once | never overwrites a populated volume |

Container mode is opt-in per service: `STEX_BIND_ALL=1` binds every
interface inside the container, and `STEX_INTERNAL_HOSTS` names the fixed
peer services a server may call or answer to. Unset, every service keeps its
native loopback-only behaviour. Hosted Pantheon refuses `STEX_BIND_ALL`,
because its sign-in gate admits loopback probes. Igor, inference, Hermes and
the document converter are not part of this stack; Pantheon's Igor pages
show Igor as unavailable here, and Seaxneat stays deferred.

Never point these volumes or the vault mount at real books, journals, notes or a VM.
