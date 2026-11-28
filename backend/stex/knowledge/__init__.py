"""Knowledge journals (``stex.knowledge.projections.v1``) owned by the platform API.

This package is the Python owner of the journals that Pantheon's in-process
Node library (``services/knowledge``) owns on the native path. The journal file
format, version tokens, fingerprints and HTTP behaviour are byte-compatible
with that library, so either runtime can open the other's journal (one writer
at a time, enforced by the shared lock file).
"""
