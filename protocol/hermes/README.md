# Hermes turn contract v1

`stex.hermes.turn.v1` is the product-neutral, server-side contract for a turn
sent to a separately hosted Hermes service. It is not a provider contract and
does not grant Hermes filesystem, vault, shell, database, or canonical-state
authority.

The STEX inference service is the only application-facing client. Browsers
send requests to their product server; product servers call the authenticated
inference service; only that service may contact a remote Hermes host. The
default local transport is deterministic and never makes a network request.

## Request

The JSON request schema is in `schema.v1.json`; the response schema is in
`response.schema.v1.json`. A request has a stable `requestId`, a
lower-case product id, a bounded conversation, an operation (`conversation`,
`proposal`, `edit`, or `cancel`), untrusted structured context, and explicit
`budget.maxContextChars`, `budget.maxOutputChars`, and `budget.timeoutMs`.
The gateway refuses values above its local limits before choosing a transport.

## Response and failures

Responses repeat the contract and request id, return `completed` or
`cancelled`, ordered events (`message`, `proposal`, or `status`), and usage
metadata. The gateway rejects malformed, unordered, or over-budget replies.

`UNAUTHORIZED`, `INVALID_REQUEST`, `UNKNOWN_CONTRACT`, and
`CONTEXT_TOO_LARGE` are local validation results. Remote failures are
classified as `UNCONFIGURED`, `CANCELLED`, `HERMES_TIMEOUT`, `HERMES_AUTH`,
`HERMES_UNREACHABLE`, `HERMES_UNAVAILABLE`, `HERMES_MALFORMED`, or
`HERMES_OUTPUT_TOO_LARGE`. No error includes an authentication token.

The v1 contract does not replace TexGraph's versioned scope-turn contract.
