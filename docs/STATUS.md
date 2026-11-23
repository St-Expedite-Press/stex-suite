# STEX Pantheon status

## Product and platform

| Area | Current state | Evidence and limits |
| --- | --- | --- |
| Pantheon shell and project pages | Implemented and tested locally | Public splash, local single-user entry, project list, studio navigation and API fallback. [Splash](verification/identity-splash-report.md), [command center](verification/command-center-report.md), [platform aggregation](verification/platform-m2a-pantheon-consumption.md) |
| Frige publishing | Implemented and tested locally | Composed workspace, guarded source edits, reviewed proposals and real LuaLaTeX proofs. [Publishing](verification/platform-transition-p2.md), [change contracts](verification/frige-change-contracts-w2.md), [atomic acceptance](verification/frige-atomic-acceptance-w3d.md) |
| Frige passages and anchored edits | Suite changes merged. The private adapter is released. | Exact passage selection shipped in suite PR 10. An anchored edit to a 38,674-character synthetic piece was accepted using stub inference. [Passages](verification/frige-ui-1-navigation-passages.md), [anchored edits](verification/frige-wave-f-anchored-edits.md) |
| Frige layout and context | Scoped layout and hierarchical context merged. The context adapter shipped in private release bd8b3b0. | Layout validation, inherited overrides and contextual revision metadata were verified with synthetic or fake inputs. [Layout](verification/frige-layout-contracts-w3b.md), [context](verification/frige-hierarchical-context-w3c.md) |
| Frige editorial systems | Source-save foundation, single-piece history and approved document excerpts | The History dialog exposes comparison, exact restore and author reasons. Review an attached UTF-8 excerpt before Igor can use it in Frige. [Foundation](verification/frige-editorial-foundations.md), [editorial state](verification/frige-editorial-state.md), [release evidence](verification/frige-editorial-release.md) |
| Seaxneat development | Implemented and tested locally | Isolated validated revisions, proposal review, restore and a running Next preview through the Pantheon sandbox. [Integration](verification/platform-transition-p1.md) |
| Igor conversation and project context | Implemented and tested locally | Same-origin composition, explicit revision preview and approval, session epochs, retry and withdrawal. [Conversation workflow](verification/igor-i1-application.md), [project context](verification/platform-transition-p3-p4.md) |
| Frige and Igor shared gateway launch | Implemented and tested locally with simulated transport | The opt-in launcher checks a separately started inference service and routes both interfaces through it. Frige's handoff preserves source preview and consent. [Gateway verification](verification/frige-igor-gateway.md) |
| Optional Graph | Implemented and tested locally | Opt-in local metadata journal, consent, provenance, reviewed relationships, export and erasure. [Knowledge evidence](verification/platform-transition-p3-p4.md) |
| Shared interface and approved media | Implemented and tested | Design roles, tokens, fonts and asset lineage. [Design system](DESIGN-SYSTEM.md), [asset book](../assets/README.md) |
| FastAPI migration | M1 and M2a implemented and tested | Read-only project aggregation beside Node. M2b awaits the identity decision. [Foundation](verification/platform-m1-python-foundation.md), [roadmap](PLATFORM-TRANSITION.md#milestone-roadmap) |
| Ēostre, Woden, Activity, local accounts | Deferred or unimplemented | The shell shows honest availability. Hosted Igor has its own sign-in. |
| Igor document tools | Shipped switched off in Igor generation 18 (`7aa7b25`) after disposable VM staging | Signed-in approval binding, exact text search and read, and native Hermes cancellation exercised with a synthetic model. Separate staging converted approved PDF and DOCX with MarkItDown. Production activation still needs the serving worker, model relay and binary approval path. [Staging evidence](verification/igor-document-tools-stage.md) |
| Direct Obsidian and engine execution | Future work | The existing journal and unexposed read-only vault adapter are foundations. [Obsidian gate](PLATFORM-TRANSITION.md#direct-obsidian-integration), [platform transition](PLATFORM-TRANSITION.md) |

## Hosted Igor and integration

| Area | Latest recorded state | Evidence and limits |
| --- | --- | --- |
| Hosted Pantheon and Frige | Live behind Igor sign-in and existing project passwords. Pantheon generation 1 (`a3708e1`) includes Frige History and document excerpt review. Igor generation 18 (`7aa7b25`) forwards verified excerpts and carries the document tools switched off. | Trusted CI, active revision read-back, sign-in and project-password checks, and a synthetic LuaLaTeX proof on the VM. Frige state remains shared across signed-in accounts. [Editorial release](verification/frige-editorial-release.md), [original hosting](verification/hosted-pantheon.md) |
| Hosted conversations and deployment | Live with password sign-in, per-account conversation ownership and durable sign-out | Owner-run identity, egress and related hardening continue. [Hosted evidence](verification/igor-i2-hosted.md), [security remediation](verification/security-remediation-2026-11.md), [hardening](verification/stex-deployment-d1.md) |
| Company and director proposals | The Company and Frige context/proposal adapters shipped in private release bd8b3b0 on 2026-11-20. Suite PRs 6–7 merged. | One live turn exceeded the earlier 30-second budget. A later hosted turn streamed in 29 seconds and Frige accepted its proposal byte-exactly. Whole-piece replies are constrained by the output budget. [Company](verification/agent-config-w4a.md), [director proposals](verification/director-proposals-w4.md) |
| Free mode, prices and passage selection | Private release 5db7e51 active as generation 15 on 2026-11-21. Suite PRs 10–12 merged. | Active revision was read back. Hermes memory and background review were disabled on the VM. The free-mode and passage interaction tests used stubs or fake transport. [Release and limits](verification/igor-free-mode-pricing.md) |
| Hermes profiles and tool policy | Igor plus seven parked specialists. Runtime configuration is verified locally. | Live tools and persistent specialist delegation remain unaccepted. [H1 evidence](verification/hermes-h1-preparation.md) |
| Suite CI and private pin | Suite PR 5 merged as ce7f8f5 after the trusted job passed. | Restricted private checkout gates full CI. Earlier skipped or blocked runs have separate dated evidence. [Integration evidence](verification/platform-release.md) |
| Public source release | Local review candidate | [Preparation and approval gates](verification/public-source-release.md) |

See the [verification index](verification/README.md) for dated reports and
the [program records](program/HANDOFF.md) for maintainer progress and decisions.
