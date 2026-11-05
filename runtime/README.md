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

H1 does not authorize enabling Hermes's built-in terminal, filesystem,
network, delegation, scheduling, messaging, memory, or plugin capabilities.
Do not start its API for STEX until a least-privilege OS/container boundary is
verified, `API_SERVER_ENABLED=true` and a unique `API_SERVER_KEY` are set in
the upstream environment, and an OpenRouter credential and bounded test
budget are explicitly authorized. STEX calls its loopback API only through
`services/inference`.
