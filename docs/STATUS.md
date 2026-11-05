# STEX Pantheon status

| Area | Status | Evidence / limit |
| --- | --- | --- |
| Pantheon shell and canonical routes | Implemented and tested | `test:pantheon`; canonical source path `apps/pantheon` |
| Design system (`@stex/design-system`) | Implemented and tested | `test:design-system`; tokens, type, components, specimen |
| Brand asset library and manifest | Implemented and tested | `test:assets`; masters and media in Git LFS |
| Pantheon splash (`/`) | Implemented and tested | `test:pantheon`, `verify:splash` (Chrome, 15 viewports); Safari and Firefox not run |
| Pantheon command center (`/home/`, `/projects/`, `/studios/`) | Implemented and tested | `test:pantheon`, `verify:home` (Chrome, 9 viewports, isolated stack with a synthetic book and a labelled Seaxneat stub) |
| Project summaries (`stex.projects.summary.v1`) | Implemented and tested | Frige and Seaxneat endpoints; `test:frige`, `test:seaxneat` |
| Igor (assistant) in Pantheon | Fake transport implemented; upstream adapter prepared | `test:pantheon` against a stub; browser keeps a stable local conversation id; live Hermes/OpenRouter exchange remains unverified and disabled |
| Graph and Activity tabs | Unimplemented | Honest "not built yet" pages; no sample data |
| Accounts and sign-in | Unimplemented | Splash **Sign in** is a local single-user entry, not authentication |
| Frige and Seaxneat visual identity | Conflict | Still pre-doctrine styles (Frige living palette, Seaxneat light theme); adoption planned |
| Frige migration, proofs, and preflight | Implemented and tested | `test:frige`; protected manuscript bytes preserved |
| Seaxneat workflow | Implemented and tested | `test:seaxneat`, production build |
| Eostre and Woden | Deferred | Canonical directory and honest shell state only |
| Hermes source, roster, and profiles | Local runtime provisioned; configuration tested | Pinned `runtime/hermes-agent` submodule at `e76fbd80be65ea5c1b89831f8d7aaedb713f5cac`; `test:hermes` validates declarative STEX configuration and the read-only `check:hermes-runtime` verifies Igor plus seven parked specialist profiles and OpenRouter-only provider selections locally |
| User Graph and local adapter | Implemented and tested | `test:knowledge`; disabled unless explicitly selected |
| Hermes fake/upstream inference boundary | Implemented and tested with stubs | `test:inference`; translates to Chat Completions and Responses, carries correlation/session isolation, loopback-only API credentials, cancel/no-bill behavior, and a local concurrency cap. The isolation flags are acknowledgements, not proof; no remote host or paid call was exercised |
| Live Hermes/OpenRouter activation | Partially prepared; provider response unverified | Igor-only loopback gateway is configured with all CLI and API-server toolsets disabled; local invalid-key and authenticated metadata checks passed. Two authorized, bounded OpenRouter attempts timed out before completion or usage evidence and were cancelled; diagnose that timeout before another paid call. Pantheon/Frige remote acceptance remains unverified |
| Multiagent execution, deployment, paid provider calls | Unimplemented / unverified | H1 deliberately excludes delegation and tool execution; paid verification needs separate authorization |

Consolidation evidence: [baseline](verification/naming-consolidation-baseline.md)
and [verification report](verification/pantheon-consolidation-report.md).
Identity foundation and splash evidence:
[identity-splash-report](verification/identity-splash-report.md). Command
center evidence: [command-center-report](verification/command-center-report.md).
H1 adapter preparation evidence: [hermes-h1-preparation](verification/hermes-h1-preparation.md).
