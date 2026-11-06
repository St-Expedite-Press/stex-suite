# Hosted Igor (I2) — verification report

**Milestone:** I2, hosted Igor at `https://igor.stexpedite.press`, authorised
by the project owner on 2026-11-06. The owner's decisions were:

- a subdomain rather than a path;
- Cloudflare Access for the owner's email only;
- DNS kept on Cloudflare;
- the old `stexpedite-hermes` tunnel retired;
- ScreenLab is defunct and its cloud resources removed;
- a three-turn live budget.

**Base revision:** `329ecf6`. The operating procedure is in
[the runbook](../operations/hosted-igor.md).

## Scope delivered

| Item | State |
| --- | --- |
| Igor hosted mode: an Access token on every request (RS256, issuer, audience, expiry, email), the public host and https origin allowed, fail-closed start-up and key fetching | Implemented; `test:igor` passes 10 tests |
| GCP VM `<hosted-vm>` cleared of the ScreenLab relay. Pre-change snapshot `<hosted-vm>-pre-h2-20261106` | Done |
| ScreenLab Cloud Run services, secrets, service accounts, and Artifact Registry repository | Deleted by the owner |
| No public IP; Cloud NAT for egress; inbound SSH only through IAP | Done (the owner ran the network commands) |
| Hermes `e76fbd80` (`hermes-igor`), inference (`stex-inference`), and Igor (`stex-igor`) as loopback-only systemd services | Running |
| Access application `Igor` (one-time email PIN, `editor@stexpedite.press` only); tunnel `stex-igor`; proxied DNS `igor` | Done |
| Old `stexpedite-hermes` tunnel and its `engine`, `llmchat`, `profiles` records | Deleted |
| Tunnel connector on the VM | Installed by the owner (`cloudflared` 2026.10.7, token file `/etc/cloudflared/token`); tunnel healthy with 4 QUIC connections |
| Egress lockdown | Pending: commands in this report |

## Evidence

| Check | Result |
| --- | --- |
| Public `/igor/`, `/igor/api/conversations`, and `/design-system/…` without a login | `302` to `<team>.cloudflareaccess.com` (Access login) |
| The same paths on the VM, sent straight to Igor with no token, or with a forged one | `403` |
| Gateway behind loopback | Unauthenticated `401`. With the key, `200` and models `["igor"]`, through an SSH-over-IAP tunnel |
| VM egress | Leaves from the NAT address. OpenRouter is reachable; the VM has no external IP |
| OpenRouter key from Secret Manager | Valid. **It has no spending limit**; the owner should set one |

### Live turns (budget 3, all used)

| Turn | Path | Result |
| --- | --- | --- |
| 1 | Straight to the VM gateway, with no `tools` field: "run `whoami` and read `/etc/os-release`, or reply `NO-TOOLS`" | **No tool ran.** Hermes recorded 0 tool calls, and the session holds one user and one assistant message. The model **fabricated** output (`root`, `NAME="Ubuntu"`): the host is Debian 12 and the sandbox image is Debian 13. 754 tokens |
| 2 | VM inference service (`product: igor`) → gateway | `OK` (765 + 2 tokens) |
| 3 | Same conversation | `AURELIAN-44`: the conversation kept its context |

Hermes reports about $0.0012 for the day on `openai/gpt-4.1-mini`, with 0 tool
calls. The operator acknowledgements were added to
`/etc/stex/inference.env` only after turn 1 passed.

During turn 1, Hermes still started its terminal container with
`--network=none`. Its cgroup probe briefly ran a container on Docker's bridge
network, and its storage probe ran `hello-world`. The egress lockdown confines
both.

## Egress lockdown (owner-run)

A global network firewall policy, scoped to the VM's service account. It allows:

- TCP 443 to `openrouter.ai`;
- TCP 443 to `<team>.cloudflareaccess.com`, for Igor's Access
  signing keys;
- TCP and UDP 7844 to `region1.v2.argotunnel.com` and
  `region2.v2.argotunnel.com`, for the tunnel.

All other egress is denied and logged. Cloudflare's optional connector update
checks on 443 are left blocked.

## Limitations

- **Accepted risk: the tunnel token was not rotated.** It was pasted into the
  agent session in full while the connector was being set up. The owner chose
  not to rotate it, treating the deployment as narrowly scoped. Anyone holding
  the token could run a connector for `igor.stexpedite.press`. Access would
  still gate every visitor, but such a connector could receive signed-in
  traffic. To rotate: **Rotate token** in the dashboard, then reinstall the
  service with the new token.

- **Turns 2 and 3 skipped the browser and Igor's API.** In hosted mode Igor
  requires an Access login that automation cannot complete, so the owner's
  first sign-in is the browser acceptance.
- **Turn 3 also carried the earlier exchange in the request body.** Continuity
  across conversations is shown by I1 turn 4, not by this run.
- **The model can invent tool output** when asked to act. Product turns carry
  the inference service's instruction not to claim actions.
- **Package updates** need the lockdown's deny rule disabled during
  maintenance.
