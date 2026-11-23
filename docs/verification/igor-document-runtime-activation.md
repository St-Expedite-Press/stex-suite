# Igor document runtime: provisioning, acceptance and activation

**Date:** November 23, 2026. **Scope:** the production VM. The owner
authorized the merge, server provisioning, a synthetic acceptance run and
activation. The acceptance run used a loopback model stub and a stand-in
approval broker, so it made no provider calls.

Igor's approved-document search and read now run in production. A turn
that carries an approved project context goes from the inference service to
an isolated worker. The worker runs pinned native Hermes with only the two
read-only document tools. Its model calls go through a bounded relay. Turns
without project context are unchanged. The design and earlier staging are in
the [staging evidence](igor-document-tools-stage.md). The operating
procedure is the private runbook's "Approved-document runtime acceptance"
section.

## Releases

| Igor generation | Revision | Content |
| --- | --- | --- |
| 19 | `bdb494b` (stex-igor PR 9) | The worker, the relay, hardened units and the activation drop-ins. The units are not installed by the release |
| 20 | `ecc5e83` (stex-igor PR 10) | The worker reads its network namespace with `socket.if_nameindex()` |

Both deploys read the active release back from the VM. Each change passed CI
with the worker and relay tests running on Linux. Two independent review
rounds preceded generation 19. All twelve first-round findings were fixed,
and six of the seven second-round low-severity findings were fixed. The
seventh, a leftover temporary file after a crash, needed no change.

## What acceptance found and fixed

- **Network check.** On the VM's systemd 252, `PrivateNetwork` leaves the
  host's sysfs mounted, so `/sys/class/net` listed the host's interfaces. The
  worker refused to start, which is the intended fail-closed behaviour (exit
  78, no restart loop). A transient `PrivateNetwork` unit confirmed that
  `if_nameindex()` reports only `lo`. Generation 20 uses it.
- **Interpreter environment.** Hermes's interpreter imports its packages
  only through the `PYTHONPATH` that its `activate` script sets. The first
  native turn ended at once because Hermes could not be imported. The
  worker's interpreter drop-in now also mounts that package directory
  read-only and sets `PYTHONPATH`. No other part of Hermes's home is visible
  to the worker.

## Acceptance results (synthetic, 31 checks, all passed)

| Area | Result |
| --- | --- |
| Isolation | The worker's namespace has only `lo` and cannot reach a public address. It sees an empty `/etc/stex` and `/var/lib/stex`, cannot see Hermes's profile secrets, and has no credential variables |
| Socket access | Worker `660 stex-docs`, relay `660 stex-relay`, broker `660 stex-docs` in a `drwxr-s--- stex:stex-docs` directory. A user outside those groups could not connect to any of them |
| Native turn | Pinned Hermes searched, read the exact approved excerpt, and was refused a `file:///etc/passwd` read. It then answered in 9.4 seconds. The model saw only the two tools and never the grant. The relay attached its provider authorization |
| Relay policy | It refused a Claude model, a `:online` model, an extra tool and the seventh call of an attempt. The daily count was unchanged after a relay restart |
| Cancellation | Closing the client killed the turn process, its MCP child and Hermes's process supervisor, and left no turn directory behind |
| Recovery | After `kill -9`, the worker restarted with a fresh socket |
| Seccomp | No denials were logged. Denials return `EPERM` and are not logged, so the passing native turn is the main evidence |

The stub override was removed afterwards. The relay's daily count was reset,
because every test call had reached only the stub.

## Activation

Both activation drop-ins were installed, and the inference service and Igor
were restarted. Checks after activation:

- Both services were active.
- The broker socket existed with the expected modes.
- The inference process held the `stex-docs` group and could reach the
  worker socket.
- The document route was enabled.
- Loopback inference health returned 200, and Igor answered.
- All seven units, the five existing ones plus the relay and the worker,
  were active.

To roll back, remove the two drop-ins, reload systemd and restart both
units.

## Limits

- No live, paid document turn was made during verification. The first real
  turn will come from a signed-in user with an approved project context.
- The per-minute (12) and daily (200) relay caps are the hard bounds. The
  per-attempt limits rely on the attempt id from the worker's forwarder.
- Document turns need a plain model id for Igor's conversation task. It
  currently uses the default.
- stex-igor PR 11 is not yet deployed. It makes the installer restart the
  worker and relay after each release, and it logs one outcome code per
  turn. Until it is deployed, restart both units after any Igor release.
- PDF and DOCX conversion (MarkItDown) still needs a product-owned binary
  upload and approval flow.
