# STEX User Graph

This directory is the current optional, directly openable vault scaffold for
portable user knowledge. Obsidian is the required direct human-facing
knowledge integration; the present scaffold and reader are foundations,
not completed integration with a working user vault. It is not an application database, Hermes memory,
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
inferences must carry provenance and user control. The platform's metadata
projections are implemented separately; they do not synchronize this vault.
The required [direct Obsidian milestone](../docs/PLATFORM-TRANSITION.md#direct-obsidian-integration)
must demonstrate authorized reconciliation with an actual user-selected vault,
human edit/conflict handling, stable references, consent, privacy and recovery.
No vault sync, automated write-back or multimodal retrieval is introduced in
this release. Private notes are not test fixtures or material to publish with
engineering documentation. Preserve all existing human-authored content.
