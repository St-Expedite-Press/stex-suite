# Vault contract v0

The current v0 boundary is an Obsidian-compatible folder selected by the user.
It carries human knowledge, not engine operational state. Obsidian is the
required direct human-facing knowledge integration target; v0 alone does not
provide actual-vault reconciliation or synchronization.

## Allowed content

- Markdown notes with YAML frontmatter and ordinary Obsidian links.
- Sources and attachments referenced by notes.
- User-authored briefs, preferences, research and cross-product references.

## Prohibited content

- Provider credentials, sessions, access tokens or service-account material.
- Queue state, locks, job leases, request journals or provider billing data.
- The only copy of an artwork, manuscript revision, parse cache or other
  product-owned operational state.

## References

Products emit stable references in the form `stex://<product>/<kind>/<id>`.
Resolving a reference is an application operation; a vault note is never
authority to bypass product authorization or validation.

## Adapter path hardening (K0)

The unexposed reader (`services/knowledge/src/local-adapter.mjs`) reads only a
regular file whose real path is inside the real vault root and that is reached
without a symbolic link or Windows junction in any path component. It refuses
`..`, absolute/drive/UNC paths, alternate data streams, 8.3 short names,
trailing dots or spaces, reserved device names, control characters and the
`.obsidian` directory in any letter case, and its listing omits them. Negative
tests live in `services/knowledge/test/local-adapter-negative.test.mjs`. A
link swapped in between the checks and the read (TOCTOU) and hard links are
not prevented; the vault must not be writable by untrusted code. This does
not expose any vault route.

## Local-first rule

The initial implementation reads a user-selected local vault directory and
remains unexposed to browsers. A future actual-Obsidian integration must
preserve portable notes, human control, stable identities and provenance.
Its authorized reconciliation needs a separately reviewed versioned contract;
this release does not expand v0 into a sync or write-back service.

## Platform direction (specified, not v0 behavior)

The [P4 plan](../../docs/PLATFORM-TRANSITION.md#p4--knowledge-projections)
distinguishes a source/artifact knowledge projection from the User Graph's
user-context projection. Shared scope, canonical references, compatible
provenance and accepted revision events provide co-extensionality,
interoperability and co-evolution. They do not require identical records or
automatic bidirectional overwrite. Assertion/inference, consent, correction,
retention/export/deletion and replay semantics are now defined by the separate
[knowledge v1 contract](../knowledge/README.md). Its local metadata service is
implemented; this v0 read-only vault boundary remains unchanged and unexposed
to browsers. No vault write-back or indexing is implied.

The [direct Obsidian integration gate](../../docs/PLATFORM-TRANSITION.md#direct-obsidian-integration)
is a required future milestone, with real-vault human editing, explicit
conflict/deletion/revocation behavior, replay and privacy evidence. The
metadata projections and legacy reader are foundations for that work.
STEX-owned backend implementation follows the
[Python migration plan](../../docs/PLATFORM-TRANSITION.md#python-backend-migration)
without changing the meaning of this v0 contract during the release.
