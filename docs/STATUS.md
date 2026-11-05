# STEX Pantheon status

| Area | Status | Evidence / limit |
| --- | --- | --- |
| Pantheon shell and canonical routes | Implemented and tested | `test:pantheon`; canonical source path `apps/pantheon` |
| Design system (`@stex/design-system`) | Implemented and tested | `test:design-system`; tokens, type, components, specimen |
| Brand asset library and manifest | Implemented and tested | `test:assets`; masters and media in Git LFS |
| Pantheon splash (`/`) | Implemented and tested | `test:pantheon`, `verify:splash` (Chrome, 15 viewports); Safari and Firefox not run |
| Pantheon command center (`/home/`, `/projects/`, `/studios/`) | Implemented and tested | `test:pantheon`, `verify:home` (Chrome, 9 viewports, isolated stack with a synthetic book and a labelled Seaxneat stub) |
| Project summaries (`stex.projects.summary.v1`) | Implemented and tested | Frige and Seaxneat endpoints; `test:frige`, `test:seaxneat` |
| Igor (assistant) in Pantheon | Implemented on the fake transport | `test:pantheon` against a stub, `verify:home` against the real inference service; replies labelled simulated; remote Hermes unverified |
| Graph and Activity tabs | Unimplemented | Honest "not built yet" pages; no sample data |
| Accounts and sign-in | Unimplemented | Splash **Sign in** is a local single-user entry, not authentication |
| Frige and Seaxneat visual identity | Conflict | Still pre-doctrine styles (Frige living palette, Seaxneat light theme); adoption planned |
| Frige migration, proofs, and preflight | Implemented and tested | `test:frige`; protected manuscript bytes preserved |
| Seaxneat workflow | Implemented and tested | `test:seaxneat`, production build |
| Eostre and Woden | Deferred | Canonical directory and honest shell state only |
| Hermes roster and profiles | Implemented and tested | `test:hermes`; declarative configuration, not a runtime |
| User Graph and local adapter | Implemented and tested | `test:knowledge`; disabled unless explicitly selected |
| Hermes fake/remote inference boundary | Implemented and tested | `test:inference`; remote host remains unverified |
| Multiagent execution, deployment, paid provider calls | Unimplemented / unverified | Requires a separate authorized milestone |

Consolidation evidence: [baseline](verification/naming-consolidation-baseline.md)
and [verification report](verification/pantheon-consolidation-report.md).
Identity foundation and splash evidence:
[identity-splash-report](verification/identity-splash-report.md). Command
center evidence: [command-center-report](verification/command-center-report.md).
