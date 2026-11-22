# Contributing to STEX

Start with the [architecture map](docs/WHITEPAPER.md#repository-and-deployment-map)
and [engineering charter](AGENTS.md). Use the owning application's README
and the affected [versioned contracts](protocol/README.md) to scope a change.
The [developer guide](docs/DEVELOPER-GUIDE.md) covers setup and verification.

## Change and review workflow

1. Identify the owner of the route, state or contract. Keep engine data behind
   its boundary and use synthetic fixtures for tests.
2. Keep the change focused. Describe the affected workflows, compatibility
   and verification evidence when proposing it.
3. Run the owning tests before the full suite. Maintainers verify fork changes
   on a trusted branch because the full job requires the private Igor pin.
4. Update the owning README or contract documentation when the workflow or
   interface changes. Record dated evidence for completed milestones.

## Source annotations

Give each first-party source file a short note identifying its purpose and
owner. Document every named function, method and callable binding. In tests,
the case description states the behavior under test. Add parameter, result,
side-effect and failure details where they affect callers. Use JSDoc or
TypeScript doc comments for JavaScript and TypeScript, docstrings for Python,
and section comments for CSS and HTML. Describe why a boundary or invariant
exists when the implementation alone leaves that unclear.

Use the [companion annotations](docs/reference/CODE-ANNOTATIONS.md) for
byte-synced source and comment-free formats. Keep comments close to the
definition they describe and update them when the behavior changes.

## Rights and public release

See [source and asset rights](docs/SOURCE-RIGHTS.md) for the release scope.
Release publication, deployment, and changes to credentials or permissions
are owner-authorized operations.
