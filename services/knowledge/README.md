# STEX knowledge adapter

This service package supplies a replaceable local adapter for an explicitly
selected User Graph. It has no server, write operation, or application data
access. The adapter only enumerates safe relative Markdown paths and reports
disabled when no `STEX_VAULT_PATH` is provided.

In the [target architecture](../../docs/PLATFORM-TRANSITION.md#p4--knowledge-projections),
the User Graph is the user's persistent second brain/digital twin, coordinated
with a source/artifact knowledge projection through canonical references,
provenance, and deliberately accepted changes. That model is specified only:
this package has no graph server, events, write-back, embeddings, retrieval
index, or demonstrated application integration. The vault stays optional and
never owns engine operational state. Before exposing this reader to browsers,
P4 must close symlink/junction and Windows path-alias escapes and establish
consent, source access, retention, correction, export, and deletion semantics.
