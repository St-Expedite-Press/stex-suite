# Hosted Igor — operations runbook

Hosted Igor runs the Igor application, the inference service, and the Igor
Hermes gateway on one Google Compute Engine VM. Users reach it at
`https://igor.stexpedite.press` through Cloudflare Tunnel, and Cloudflare
Access admits only the owner.

**For:** whoever deploys, rotates, or recovers this host. It assumes `gcloud`
access to project `<gcp-project>`, and Cloudflare account access for
`stexpedite.press`.

```text
browser ─► Cloudflare Access ─► Cloudflare Tunnel ─► cloudflared (VM, outbound only)
                                                       └► Igor 127.0.0.1:4330
                                                            └► inference 127.0.0.1:8100
                                                                 └► Hermes 127.0.0.1:8642 ─► OpenRouter
```

## Host

| Item | Value |
| --- | --- |
| VM | `<hosted-vm>`, `us-central1-a`, e2-standard-2, Debian 12, Shielded VM, OS Login |
| Public IP | None. Outbound traffic goes through Cloud NAT (`stex-router` / `stex-nat`) |
| Inbound | SSH only, from Google IAP (`35.235.240.0/20`). Everything else is denied (`stex-deny-public-ingress`) |
| Service account | `<vm-service-account>…` with no project roles. It can read only the `stex-openrouter-api-key` secret |
| Backup before H2 | Snapshot `<hosted-vm>-pre-h2-20261106` |

## Services (systemd)

| Unit | User | Listens | Configuration |
| --- | --- | --- | --- |
| `hermes-igor` | `hermes` | `127.0.0.1:8642` | Hermes pinned at `e76fbd80`, in `/var/lib/hermes/hermes-agent`; profile `igor` (empty toolsets, air-gapped Docker terminal); secrets in `~hermes/.hermes/profiles/igor/.env` (mode 600) |
| `stex-inference` | `stex` | `127.0.0.1:8100` | `/etc/stex/inference.env` (root:stex 640) |
| `stex-igor` | `stex` | `127.0.0.1:4330` | `/etc/stex/igor.env` (root:stex 640); conversations in `/var/lib/stex/igor` |
| `cloudflared` | root | Outbound only | Tunnel `stex-igor`, remote-managed: `igor.stexpedite.press` → `http://127.0.0.1:4330` |

Node is `/opt/node` (v22, checked against nodejs.org SHA-256). Releases live in
`/opt/stex/releases/<commit>`, and `/opt/stex/current` points at the active one.

## Go-live gates

State on 2026-11-06:

- **Done:** gates 1, 2, 4, and 5. The Access application is `Igor`; the team
  domain is `<team>.cloudflareaccess.com`; the tunnel is
  `<tunnel-id>`.
- **Done:** gate 3. The connector is installed; the token is not rotated, an
  accepted risk.
- **Pending:** gate 6 (egress lockdown). See the
  [I2 report](../verification/igor-i2-hosted.md).

Do these in order. Igor must never be reachable unauthenticated.

1. **Access application.** Create a Zero Trust self-hosted application for
   `igor.stexpedite.press`, with an Allow policy for the owner's email. Copy
   its audience (AUD) tag and the team domain.
2. **Hosted mode.** Add these to `/etc/stex/igor.env`, then restart
   `stex-igor`:
   - `STEX_IGOR_PUBLIC_ORIGIN=https://igor.stexpedite.press`
   - `STEX_IGOR_ACCESS_TEAM_DOMAIN`
   - `STEX_IGOR_ACCESS_AUD`
   - `STEX_IGOR_ACCESS_EMAILS`

   From then on, Igor refuses every request without a valid Access token.
3. **Connector.** On the VM, run `sudo cloudflared service install <tunnel token>`.
   The token is under Zero Trust → Networks → Tunnels → `stex-igor`. Never
   commit it or paste it into a document.
4. **DNS.** Add a proxied CNAME `igor` → `<tunnel id>.cfargotunnel.com`.
5. **Tool-negative turn** against the VM gateway. Only after it passes, add
   `STEX_HERMES_ISOLATION=verified` and
   `STEX_HERMES_TOOL_POLICY=conversational-only` to
   `/etc/stex/inference.env`, then restart `stex-inference`.
6. **Egress lockdown.** Allow only OpenRouter, Cloudflare's tunnel edge, and
   the Access signing-key endpoint (see the I2 report).

## Deploy a release

```powershell
# From a clean checkout of <commit>. A working-tree tar is used because git archive
# would ship Git LFS pointers instead of the masthead media.
git ls-files -z package.json pnpm-lock.yaml pnpm-workspace.yaml apps/igor services/inference packages/design-system protocol | tar --force-local --null -T - -czf stex-igor-<commit>.tar.gz
gcloud compute scp stex-igor-<commit>.tar.gz <hosted-vm>:/tmp/ --zone us-central1-a --project <gcp-project> --tunnel-through-iap
```

Then, on the VM:

1. Unpack into `/opt/stex/releases/<commit>` and `chown -R stex:stex`.
2. As `stex`, with `HOME=/var/lib/stex` and `/opt/node/bin` on `PATH`, run
   `corepack pnpm install --frozen-lockfile --filter @stex/igor... --filter @stex/inference...`.
3. Run `corepack pnpm --dir apps/igor build`.
4. Point `/opt/stex/current` at the new release.
5. Run `systemctl restart stex-inference stex-igor`.

Roll back by pointing the link at the previous release.

Egress lockdown blocks package downloads. Disable its deny rule while you
deploy, and re-enable it afterwards.

## Rotate secrets

- **Inference shared secret.** Generate a new value and set it in both env
  files, then restart both STEX units.
- **Gateway key.** Regenerate `API_SERVER_KEY` in the Hermes profile and copy
  it to `STEX_HERMES_API_KEY`. Restart `hermes-igor`, then `stex-inference`.
- **OpenRouter key.** Add a new version of `stex-openrouter-api-key` and
  rewrite the profile `.env` from it, then restart `hermes-igor`.
