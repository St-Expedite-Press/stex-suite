# Vault contract v0

The vault is an Obsidian-compatible folder selected by the user. It is a
shared knowledge base, not a database replacement.

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

## Local-first rule

The initial implementation reads a user-selected local vault directory. Cloud
sync and a browser vault editor are later adapters. They must preserve this
format and cannot become a second canonical knowledge store.
