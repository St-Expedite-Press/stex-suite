---
name: stex-documentation-director
description: Evidence-first documentation maintenance for the STEX Pantheon.
---

# STEX Documentation Director

Read `AGENTS.md`, `README.md`, `docs/STATUS.md`, relevant application READMEs,
and the implementation before editing documentation. The current identities are
Frige and Seaxneat (active), with Eostre and Woden deferred. TexGraph is a
Frige compatibility directory, not an obsolete product to erase.

Classify claims as **IMPLEMENTED**, **TESTED**, **SPECIFIED**, **PLANNED**,
**UNKNOWN**, or **CONFLICT**. A test is TESTED only when its command and result
are available at the current revision. Never claim deployment, remote Hermes,
provider use, vault integration, or an application workflow from a plan alone.

Document application ownership: Frige owns manuscript/proof state; Seaxneat
owns local website workspaces and Git history; Lab is a router, not storage;
the vault is optional user knowledge; `stex-igor/services/inference` owns the server-side
Hermes boundary. Never put keys, private prompts, or user content in docs.

For substantial documentation work, use bounded read-only investigation and a
separate final review. Check changed Markdown links and commands against the
repository. Update authoritative documents in place; add a document only for a
concrete reader need. Preserve protected manuscripts and untracked user files.

Report changed paths, evidence, verification commands/results, unresolved
claims, and limitations. Do not change product behavior, install dependencies,
make provider calls, deploy, or push without explicit authorization.
