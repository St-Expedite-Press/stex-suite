# STEX developer guide

## Prerequisites

| Tool | Use |
| --- | --- |
| Node.js and Corepack | Use [.node-version](../.node-version) to reproduce CI. Node 24 LTS also works for local development. Corepack selects pnpm 9.15.9 from [package.json](../package.json). |
| uv and Python | CI uses uv 0.11.26. [The Python pin](../.python-version) selects the 3.12 series and [uv.lock](../uv.lock) records the locked dependencies. |
| Git and Git LFS | Git records Seaxneat revisions. LFS retrieves approved media. |
| LuaLaTeX and pdffonts | Install fontspec, microtype and geometry for Frige proof checks. Use pdffonts for font preflight. |
| Chrome or Edge | Browser acceptance. Set STEX_BROWSER to the executable when discovery fails. |
| FFmpeg and ffprobe | Needed only for rebuilding approved media from masters. |

## Authorized checkout

The GitHub release ZIP is a source-reading artifact. To run the integrated
suite, use the repository checkout with read access to the exact private
Igor pin. Initialize Igor and fetch the required LFS media in both repositories.

```powershell
git clone https://github.com/St-Expedite-Press/stex-suite.git
Set-Location stex-suite
git lfs install --local
git submodule update --init stex-igor
git -C stex-igor lfs install --local
git lfs pull
git -C stex-igor lfs pull
corepack pnpm install --frozen-lockfile
uv sync --frozen
corepack pnpm check:prereqs
corepack pnpm dev:alpha
```

Open http://127.0.0.1:4300/. The launcher builds the workspaces and Igor,
starts the loopback services and selects simulated inference. It starts the
FastAPI platform when the locked Python environment is available. Stop the
stack with Ctrl+C. The nested Hermes source is needed for work on the
native runtime itself. Preflight checks that the Igor checkout matches the
suite's committed pin and that both repositories have their application
media locally. Preserve local Igor changes before correcting a mismatched
checkout.

### Connect an existing inference gateway

For an operator-approved live session, start the isolated Hermes runtime
and its STEX inference service separately using the private runtime
runbook. Verify the runtime isolation boundary before activation and
obtain explicit authorization and a call budget.

Export `STEX_INFERENCE_URL` and `STEX_INFERENCE_SHARED_SECRET` from the
ignored local configuration into the workspace launcher shell. Use the
inference service's loopback HTTP origin and its matching shared token. Run
`corepack pnpm dev:alpha --use-inference-gateway`. The launcher checks the
inference service's readiness, then sends both Frige editorial turns and
Igor conversations through that service. Keep upstream Hermes and model
provider credentials in their owning processes.

Regular `corepack pnpm dev:alpha` still uses simulated inference.

## Version and release records

The suite's `stex-igor` gitlink selects the exact private source revision
for integrated builds. Each checkout uses its own `.node-version` for
standalone CI. Verify both workspaces on the intended Node patch before
updating those files. Corepack resolves each workspace's package manager
and each lockfile defines its dependencies. HTTP and stored-data contract
versions are defined under [protocol/](../protocol/README.md).

The hosted Igor and Pantheon releases each have a Git SHA and a separate
generation sequence. Their active records on the VM are
`/opt/stex/ACTIVE.json` and `/opt/stex-pantheon/ACTIVE.json`.
The `0.1.0` values in the private package manifests are package metadata.
See [Status](STATUS.md) for the current deployment and
[verification evidence](verification/README.md) for what ran.

## Configuration

Use the application-specific settings in [.env.example](../.env.example)
and the component READMEs. For a nondefault Pantheon port, use
`STEX_PANTHEON_PORT`. The launcher passes the matching loopback origin to
the engines. Set `STEX_PANTHEON_URL` explicitly when starting an engine
separately with a nondefault shell port.

Set `STEX_FRIGE_PROJECTS_DIR` to the absolute path of an existing Frige
project directory to keep using it in place. The default is
`apps/pantheon/.local-projects`. Set this option before the first launch
after updating a checkout that used a pre-consolidation default.

Graph is opt-in. From PowerShell at the repository root:

```powershell
$env:STEX_KNOWLEDGE_DATA_DIR = Join-Path (Get-Location) 'services/knowledge/.local-data'
corepack pnpm dev:alpha
```

Use disposable directories for verification. `STEX_SEAXNEAT_DATA_DIR` and
`STEX_IGOR_DATA_DIR` let authorized maintainers isolate those applications.
The optional vault reader uses a separately selected path. It is outside the
local Graph workflow.

## Development agents and verification harness

| Area | Development | Product runtime |
| --- | --- | --- |
| Configuration | Root and nested engineering charters, Codex roles in .codex/agents, GitHub documentation reviewer in .github/agents | Private Igor repository, native profiles and skills, and the pinned Hermes gateway |
| Work and permissions | Scoped code investigation, implementation or review with the development session's permissions | Igor conversations and inference governed by runtime configuration and owner-authorized activation |
| Credentials | Authorized Git read access. Full CI checks the private pin on trusted branches. | Product servers keep the inference secret. Provider credentials belong to the ignored runtime environment. |
| Checks | scripts/dev starts the local stack. scripts/verify drives disposable browser and API workflows. CI runs deterministic suites. | Private release workflow owns VM deployment and rollback. Live calls require separate authorization and a budget. |

The development roles inherit their session's model and permissions.
The native Hermes profile catalog is independent. Igor is the default
conversation profile. Seven specialists are parked, and the default
runtime toolsets are empty.

## Integration and verification

| Command | Purpose |
| --- | --- |
| `corepack pnpm test` | Full deterministic suite including charter, platform, asset and private-pin checks |
| `corepack pnpm test:<suite>` | Owning suite for a scoped change |
| `corepack pnpm check:prereqs` and `test:setup` | Check the actual checkout and exercise the missing and mismatched setup cases |
| `corepack pnpm build:pantheon` | TypeScript check and build of the Seaxneat workspace |
| `corepack pnpm build:igor` | Build the private Igor renderer before its browser checks |
| `corepack pnpm verify:splash` and `verify:home` | Public entrance and project pages. Set STEX_VERIFY_PLATFORM=off to exercise project fallback. |
| `corepack pnpm verify:frige` | Disposable writing, proposal review and real LuaLaTeX proof |
| `corepack pnpm verify:platform` and `verify:platform-api` | Mounted Seaxneat preview and read-only FastAPI project aggregation |
| `corepack pnpm verify:igor`, `verify:igor-login` and `verify:knowledge` | Stub inference, disposable sign-in and consent workflows |
| `corepack pnpm check:hermes-runtime` | Read-only reconciliation of the installed runtime catalog |
| `corepack pnpm test:stex-igor-sync` | Compare suite-owned source to the pinned synchronized copies |
| `corepack pnpm sync:stex-igor` | Refresh those copies for a separately authorized integration change |

Run the owning checks first, then full regression. Browser verification uses
disposable data and a simulated or stub transport. See the
[verification index](verification/README.md) for recorded coverage.

Suite CI fails closed when it cannot check out the private pin. Fork code
receives neither the private checkout nor its deploy credential. A trusted
maintainer reviews a fork contribution and verifies it on an authorized
branch. Pushes to private Igor main trigger its deployment workflow. The
private repository owns the operator runbooks and live activation gates.

The [whitepaper](WHITEPAPER.md) covers responsibility and dependency flow.
Follow the [migration gates](PLATFORM-TRANSITION.md) for further backend or
Obsidian integration.
