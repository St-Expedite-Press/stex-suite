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
native loopback-only behaviour. In container mode hosted Pantheon drops its
loopback-probe exemption (a peer could claim a loopback Host): probes use
`/healthz`, and every other request needs the published host and a session.
The base stack has no Igor, inference, Hermes or document converter; Pantheon's
Igor pages show Igor as unavailable there, and Seaxneat stays deferred.

## Overlays

| Overlay | Adds | Verifier |
| --- | --- | --- |
| `compose.hosted.yaml` | A TLS edge (Caddy local CA, standing in for the tunnel) published only as `https://pantheon.stex.test:8443` on loopback; hosted Pantheon (no published port, `/healthz` probe, no loopback exemption); real Igor password sign-in with per-run fixture accounts; platform and Frige verifying the actor | `scripts/verify/verify-staging-hosted.mjs` |
| `compose.igor-host.yaml` | Replaces Igor with one Debian 12 "Igor host" like the VM: Igor, inference (remote transport), a Hermes gateway installed by the VM's managed recipe (`setup-hermes.sh --runtime-only`) at the exact pin with STEX's 62 profile settings, the Obsidian connector at its pinned SHA, and a recording fake provider, all on loopback; internal network only | `scripts/verify/verify-staging-igor.mjs [--skip-rollback]` |

Fixture accounts and secrets are generated per run in a temporary directory
outside the repository. The Igor host is staging-only: its single deviation
from the production profile is the model base URL (the fake provider).

Never point these volumes or the vault mount at real books, journals, notes or a VM.
