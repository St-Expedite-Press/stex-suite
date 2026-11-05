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
