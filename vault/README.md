# STEX User Graph

This is an optional, directly openable Obsidian vault for portable user
knowledge. It is deliberately not an application database, Hermes memory,
execution queue, credential store, or substitute for Git history.

Applications do not import this directory. `services/knowledge` provides a
replaceable, read-only local adapter when a user explicitly configures
`STEX_VAULT_PATH`. Without that setting, all STEX applications remain
functional and vault access is disabled.

Keep private Obsidian workspace state and attachments out of version control.
Use `stex://<product>/<kind>/<id>` links only as references; the owning product
still resolves and authorizes each object.

The [platform transition](../docs/PLATFORM-TRANSITION.md) specifies a broader
User Graph as a persistent digital twin and second brain. It and the Pantheon
source/artifact knowledge base are coordinated projections over canonical
references, not duplicate engine databases. Explicit assertions and revisable
inferences must carry provenance and user control. This vault is currently a
portable optional adapter; no co-evolving projection, automated write-back,
or multimodal retrieval is implemented. Private notes are not test fixtures
or material to publish with engineering documentation.
