# Igor document tools on the VM

**Date:** November 23, 2026. **Scope:** a disposable service on the
existing VM, with synthetic documents, an in-namespace model stub and a
zero provider-call budget. The owner selected search and read of approved
excerpts and asked to include Microsoft's MarkItDown MCP converter.

The stage used the live runtime's exact Hermes pin, `e76fbd80`, with a
fresh synthetic profile. The active releases stayed at suite `a3708e1`
and Igor `8ebcfb2`. The official `markitdown-mcp` `0.0.1a8` server ran
over stdio using MarkItDown `0.1.9` with PDF and DOCX support and MCP SDK
`2.1.1`. Only the guarded conversion worker constructed the data URI from
approved bytes. The stock server accepts file and web URIs and runs with
its process privileges. [Microsoft MCP documentation](https://github.com/microsoft/markitdown/blob/main/packages/markitdown-mcp/README.md)

## Results

| Check | Result |
| --- | --- |
| VM process isolation | The dynamic user saw only loopback. The non-loopback connection probe was denied. The protected STEX state paths and a normally readable synthetic canary were inaccessible. The tested credential variables were absent and the staging payload was read-only. |
| Approval boundary | Search returned the approved match. Read preserved the exact excerpt. Pending, stale, unknown, expired and cross-project references were rejected, as were arbitrary URI arguments and mutation requests. |
| Stock MarkItDown MCP | The isolated subprocess advertised `convert_to_markdown` over stdio and converted synthetic PDF and DOCX files offline. |
| Native Hermes dispatch | Pinned `AIAgent` advertised the exact three guarded schemas to a synthetic model. Hermes dispatched the requested MCP tools, returned search and exact read results, converted both document types, and rejected foreign, URI and malformed references. The eight-request synthetic model sequence completed. |
| Production preservation | Each run checked both active-release records and all five services after removing its private staging payload. Production toolsets stayed empty. |

A first run was denied access to Hermes's private home. The retry mounted
only the interpreter and its installed dependencies read-only. A subsequent
run exposed the stage mount's executable-library restriction. Moving the
temporary dependency payload to an executable filesystem allowed the
converter to start under the same isolation policy. The synthetic profile
disabled Hermes's progressive tool discovery so the test could assert
the complete advertised list directly.

## Hosted approval binding and native cancellation

The first harness supplied a synthetic approval at process startup. The
follow-up candidate runs the real Igor sign-in, context preview, turn and
inference handlers with disposable storage and two synthetic accounts.
Igor mints a per-attempt grant for the owned pending reply. The broker
binds it to the project, approved revision, epoch, and digest of the complete
turn. The worker uses a separate Unix socket, and its MCP server resolves
each tool call through the approval broker. Both calls share an eight-call
and 24,000-byte cumulative result limit. That limit covers serialized broker
results. Hermes's model context and model-call budget are separate.

| Check | Result |
| --- | --- |
| Identity and consent | Two signed-in accounts exercised the hosted routes. A missing preview digest, another account's conversation, a changed turn or budget, and attempts to reuse a closed grant were refused. |
| Search and read | The model saw exactly the two MCP schemas. Native Hermes searched the approved text, read the exact excerpt, refused an arbitrary file reference, and produced the synthetic reply. |
| Lifecycle | Completed, expired, withdrawn and cancelled grants were refused. Deleting the conversation closed the disposable worker's established stream and stopped both the native turn and its MCP subprocess. |
| Isolation | The test used a transient systemd unit with a dynamic user, private network, a fresh Hermes home, read-only dependencies and hidden production state. The fixture checked for the production credential variables after importing Hermes and after constructing the agent. The release records and all five services were checked after cleanup. No provider calls were made. |

Discovery initially included the SDK's resource and prompt utilities. The
fixture then allowlisted search and read and disabled those utilities. The
subsequent native run exercised only the two intended tools.

Local verification passed `corepack pnpm test` in stex-suite and stex-igor,
Igor type-check and build, local release packaging, and `corepack pnpm
verify:igor`. The browser run used simulated inference. The final hosted
fixture archive SHA-256 was
`7d06d19d20a0cc5ebd84a5503e47b6166a91bb805cb1ae15eb8b2d11934dc49c`.
Independent review found and checked the request binding and credential
handling. Follow-up staging verified native agent and MCP child exit. The
synthetic worker passes its evaluated reply back to the real inference
handler. A production worker and its model relay are distinct deliverables.

## Production acceptance still pending

The candidate is based on private revision `8ebcfb2631de` and suite revision
`a3708e1dcaf0`. The production serving worker and model relay still need
their final service identities, socket permissions, process lifecycle and
provider-call budgets. The staged units prove the synthetic path. Binary
conversion also needs a product-owned upload and approval flow. Frige's
live text excerpts continue through its existing authenticated adapter.

In the first conversion stage, independent review found that malformed
fixture data could terminate the bridge. The repaired bridge returned a
refusal through native Hermes and the synthetic turn completed.

The conversion fixture bundle was hash-checked before extraction. Its SHA-256 was
`92f367e874965bd0f2d0f2e9b66b2ec857da4f722a46691dd1f586bfca5124e5`.
The staging launcher applied the documented fixture corrections after
extracting it. The VM's temporary service and payload were removed.
