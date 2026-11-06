# Packaged Hermes runtime

`hermes-agent/` is the pinned upstream Hermes Agent source submodule for the
STEX suite. It is fixed at upstream commit
`e76fbd80be65ea5c1b89831f8d7aaedb713f5cac`. Initialize it after cloning with:

```powershell
git submodule update --init --recursive
```

The source checkout is intentionally separate from STEX application code.
Upstream installation, Python environments, sessions, caches, logs, and
credentials stay under the upstream user's local runtime location. On native
Windows, use the upstream-supported installer from the pinned source's
README; it installs under `%LOCALAPPDATA%\hermes`.

H1's local runtime is an **Igor-only** API boundary. The checked-in
[`../hermes/runtime-profiles.json`](../hermes/runtime-profiles.json) declares
the one active profile and seven inactive specialists. Reconcile it without
changing runtime state:

```powershell
corepack pnpm run check:hermes-runtime
```

On this workstation the profile-scoped configuration is under
`%LOCALAPPDATA%\hermes\profiles\igor`. All runtime profiles are pinned to
OpenRouter, but only its ignored `.env` holds `OPENROUTER_API_KEY`,
`API_SERVER_KEY`, and loopback API settings; STEX's
ignored `.env` holds the matching `STEX_HERMES_API_KEY`. No credential belongs
in this repository or its `.env.example`.

Igor runs with all upstream toolsets disabled on both the CLI and API-server
platforms. Its dormant Docker terminal
configuration uses no forwarded environment variables, no host volume mounts,
an air-gapped container network, and ephemeral state; it must remain so unless
a separately authorized tool-execution milestone supplies new evidence. The
current upstream `gateway.standalone` compatibility setting is intentional:
`hermes -p igor gateway run` serves only Igor, while all specialists are
parked. STEX calls this loopback API only through `services/inference`.

Before a live turn, make the Docker boundary ready without invoking a provider:

```powershell
docker pull nousresearch/hermes-sandbox:desktop
docker run --rm --network none --entrypoint /bin/sh nousresearch/hermes-sandbox:desktop -c 'echo sandbox-ready'
```

Starting the local API and reading `/v1/models` does not invoke a model. A
provider-backed completion, direct OpenRouter verification, or enabling the
STEX remote transport requires explicit authorization and a bounded paid test
budget.
