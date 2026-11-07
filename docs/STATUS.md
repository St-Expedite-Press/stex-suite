# STEX Pantheon status

| Area | Status | Evidence / limit |
| --- | --- | --- |
| Pantheon shell and canonical routes | Implemented and tested | `test:pantheon`; canonical source path `apps/pantheon` |
| Design system (`@stex/design-system`) | Implemented and tested | `test:design-system`; tokens, type, components, specimen |
| Brand asset library and manifest | Implemented and tested | `test:assets`; masters and media in Git LFS |
| Pantheon splash (`/`) | Implemented and tested | `test:pantheon`, `verify:splash` (Chrome, 15 viewports); Safari and Firefox not run |
| Pantheon command center (`/home/`, `/projects/`, `/studios/`) | Implemented and tested | `test:pantheon`, `verify:home` (Chrome, 9 viewports, isolated stack with a synthetic book and a labelled Seaxneat stub) |
| Project summaries (`stex.projects.summary.v1`) | Implemented and tested | Frige and Seaxneat endpoints; `test:frige`, `test:seaxneat` |
| Igor application (`stex-igor/apps/igor`, `stex.igor.conversations.v1`) | Implemented and tested; I1 accepted | `test:igor`, `verify:igor` (Chrome, 5 viewports, stub inference). Pantheon hands home-composer messages to Igor and holds no inference secret; the `/api/igor/turn` relay is retired. Five provider-backed turns through Pantheon → Igor → inference → Hermes verified continuity, session isolation, an auth failure, and retry ([I1 report](verification/igor-i1-application.md)). Seaxneat previews can still reach Igor same-origin (open review finding) |
| Graph and Activity tabs | Unimplemented | Honest "not built yet" pages; no sample data |
| Accounts and sign-in | Unimplemented | Splash **Sign in** is a local single-user entry, not authentication |
| Frige visual identity (D4) | Implemented and tested | Frige serves `@stex/design-system`, the Dusty Garnet accent, and the masthead (full on the project library, compact on the workstation) under Pantheon's motion policy; the living palette is removed. `test:frige`, `verify:frige` (Chrome, 5 viewports, standalone and mounted, synthetic book). Conversation cards and a typeset proof were not rendered in the browser; Safari and Firefox not run ([D4 report](verification/frige-d4-design-system.md)) |
| Seaxneat visual identity | Conflict | Still the pre-doctrine light theme; adoption planned |
| Frige migration, proofs, and preflight | Implemented and tested | `test:frige`; protected manuscript bytes preserved |
| Seaxneat workflow | Implemented and tested | `test:seaxneat`, production build |
| Eostre and Woden | Deferred | Canonical directory and honest shell state only |
| Hermes source, roster, and profiles | Local runtime provisioned; configuration tested | Pinned `stex-igor/runtime/hermes-agent` submodule at `e76fbd80be65ea5c1b89831f8d7aaedb713f5cac`; `test:hermes` validates declarative STEX configuration and the read-only `check:hermes-runtime` verifies Igor plus seven parked specialist profiles and OpenRouter-only provider selections locally |
| User Graph and local adapter | Implemented and tested | `test:knowledge`; disabled unless explicitly selected |
| Hermes fake/upstream inference boundary | Implemented and tested with stubs | `test:inference`; translates to Chat Completions and Responses, carries correlation/session isolation, loopback-only API credentials, cancel/no-bill behavior, and a local concurrency cap. The isolation flags are acknowledgements, not proof; direct runtime verification does not prove this STEX service path |
| Live Hermes/OpenRouter activation | Verified for Igor on a local Windows gateway; Frige remote unverified | A tool-negative turn returned `NO-TOOLS` with no tool calls, but the gateway still prepares a `--network=none` Docker terminal and its cgroup probe briefly uses the bridge network. Operator acknowledgements are passed per process, never stored. `stex-igor/services/inference` no longer cancels remote turns on Node 24. Cost so far about $0.009 on `openai/gpt-4.1-mini` |
| Hosted Igor (`igor.stexpedite.press`, I2) | Live with Igor's own password sign-in; egress lockdown pending | Igor, inference, and the Igor Hermes gateway run as loopback-only systemd services on GCP VM `<hosted-vm>` (no public IP). Since 2026-11-07 Igor admits users with its own email-and-password sign-in on the Pantheon splash (`test:igor`, `verify:igor-login`; two independent security reviews); the two users were migrated with their existing password hashes. The Cloudflare Access application was removed the same day; from outside, `/igor/` redirects to the sign-in page and the API and readiness answer `401`. A VM tool-negative turn showed 0 tool calls (the model fabricated output), and a continuity turn passed. [I2 report](verification/igor-i2-hosted.md), [runbook](../stex-igor/docs/operations/hosted-igor.md) |
| `stex-igor` repository split (I3) | Done; deploys automatically from `stex-igor` `main` | Igor, inference, the Hermes roster, and the runtime pin live in private `St-Expedite-Press/stex-igor`, mounted here as a submodule. Its CI passes on GitHub. `test:stex-igor-sync` guards the design-system and masthead copies. The first automated deploy (run `42261497879`) installed release `3a0a19ce237e` and passed its health check ([I3 report](verification/stex-igor-split.md)) |
| Deployment hardening (D1) | Engineering verified in production; owner-run changes pending | The hardened pipeline is deployed: the workflow verifies the active commit, installs detach from SSH, and a failed health check rolls back. Rollback was exercised in a staging slot, including a dropped session. Daily backups are on, with a verified restore. Independent review: two rounds. Pending owner-run identity, egress, edge, snapshot, and CI-token changes ([public summary](verification/stex-deployment-d1.md)) |
| Multiagent execution and deployment | Unimplemented / unverified | H1 deliberately excludes delegation, tool execution, and deployment. One bounded direct provider verification has occurred; additional paid work needs separate authorization |

Consolidation evidence: [baseline](verification/naming-consolidation-baseline.md)
and [verification report](verification/pantheon-consolidation-report.md).
Identity foundation and splash evidence:
[identity-splash-report](verification/identity-splash-report.md). Command
center evidence: [command-center-report](verification/command-center-report.md).
H1 adapter preparation evidence: [hermes-h1-preparation](verification/hermes-h1-preparation.md).
