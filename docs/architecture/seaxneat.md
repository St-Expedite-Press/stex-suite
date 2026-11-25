# Seaxneat architecture assessment

Seaxneat is the local website-workspace engine. Pantheon owns the UI.
The existing vertical slice is project creation, deterministic proposal,
explicit apply, a validated Next.js build, mounted preview, revision
restore, and preview stop. The project stays inspectable after a failed
or interrupted operation. [Application](../../apps/seaxneat/README.md) ·
[Workspace contract](../../protocol/seaxneat/README.md)

| Boundary | Existing behavior and next gate |
| --- | --- |
| Domain and persistence | Each project owns isolated source, Git history, pending proposals, build status and the last validated revision. Failed builds leave the prior validated revision authoritative. |
| User journeys | The user opens a project, requests a bounded edit, reviews and applies it, verifies the preview, and can restore a known revision. Preserve project selection, pending actions and visible recovery states. |
| Intelligence | The simulator proposes a bounded heading edit. Real agent proposals require a selected project, an approved input revision, an attenuated capability and a distinct apply action supported by the engine. |
| Knowledge | Read-only context offers a fixed source set from the last validated Git object. The knowledge service can accept an authorized observation with revision provenance. Working drafts and preview output confer no knowledge or tool authority. |
| Shared interfaces | Consume project discovery, context and knowledge contracts through the owner. Hosted identity, generalized sessions and resource search require their applicable access tests. |
| Interface | Pantheon composes the workspace. A mounted preview receives no actor credentials. The presenter should keep operation status, review and stop controls available at mobile widths. |
| Hosting and integrations | The project build currently needs a local Node toolchain and Git. The browser sandbox constrains preview requests. Hosted execution remains gated on OS isolation and controlled dependency access. |

The next deployable vertical slice requires executable tests under the
actual isolated build identity. Verify filesystem and credential denial,
network policy, project separation, resource ceilings, cancellation,
cleanup and preservation of the validated rollback point. Establish the
boundary before enabling hosted Seaxneat or live Igor build work.
[Preview hardening evidence](../verification/security-hardening-s0-k0.md) ·
[Platform transition](../PLATFORM-TRANSITION.md)
