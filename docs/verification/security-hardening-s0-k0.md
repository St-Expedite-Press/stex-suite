# Security hardening S0 + K0 verification

Date: 2026-11-25. Branch `feat/security-s0-k0`. Scope: Seaxneat preview and
execution hardening (S0) and vault adapter path hardening (K0). No product
behaviour changed beyond safety. OS-level isolation (S1) is not part of this
milestone and is still absent.

## What changed

S0, Seaxneat (`apps/seaxneat`, `apps/pantheon/workspaces/seaxneat`):

- Preview CSP tightened from `sandbox allow-scripts; frame-ancestors 'self'` to
  the policy in `PREVIEW_CONTENT_SECURITY_POLICY` (`src/preview-proxy.mjs`):
  adds `default-src 'self'`, `connect-src 'self'`, `img-src 'self' data: blob:`,
  `style-src 'self' 'unsafe-inline'`, `script-src 'self' 'unsafe-inline'`,
  `font-src 'self' data:`, `form-action 'none'`, `base-uri 'none'`,
  `object-src 'none'`. `'unsafe-inline'` for scripts is required by Next's
  inline bootstrap scripts (determined by the real-Next run below, where the
  runtime executes under this policy).
- Preview lifecycle: `POST /projects/<id>/preview/stop` (same Host/Origin
  checks and busy lock); process-tree termination (`taskkill /T` on Windows,
  process group elsewhere); build/apply/restore stop a running preview before
  building and restart it only after success, otherwise it stays `stopped`;
  bounded free-port probing (`src/preview-port.mjs`, 25 candidates within
  4400-5399, connect and bind probes, `EADDRINUSE` retry); failed starts are
  recorded as `failed`; persisted live states become `stopped` on engine
  restart; an exiting old child can no longer unregister its replacement.
- Restore safety: a restore whose build fails returns the draft to its exact
  pre-restore bytes (same rule as apply) instead of leaving unvalidated
  restored source; it never advances `lastValidatedRevision`.
- UI: "Stop preview" button and an honest `Preview: <state>` line; the frame
  follows the engine-reported state, including after apply/restore restarts.
- `protocol/seaxneat/README.md`: CSP, what remains possible, lifecycle rules,
  and an explicit statement that OS isolation (S1) is absent.

K0, knowledge (`services/knowledge/src/local-adapter.mjs`, still unexposed):
`read()` now `lstat`s every path component (refusing symlinks and junctions),
resolves the real root and real target, requires a regular file whose real path
equals the lexical path (case-folded on Windows/macOS) inside the real root, and
rejects `..`, absolute/drive/UNC paths, `:` (alternate data streams), `~N` 8.3
names, trailing dots/spaces, reserved device names, control characters and
`.obsidian` in any case. `notes()` skips links and aliased names. No route was
added. `protocol/vault/README.md` records the boundary and residual TOCTOU risk.

## Commands and results

Run in the worktree on Windows 11, Node 24.18.

| Command | Result |
| --- | --- |
| `node --check` on `server.mjs`, `src/project-store.mjs`, `src/workspace-api.mjs`, `src/preview-port.mjs`, `scripts/verify/verify-platform.mjs`, `services/knowledge/src/local-adapter.mjs` | pass |
| `corepack pnpm run test:seaxneat` | 34 pass, 0 fail (new: `test/preview-lifecycle.test.mjs` with 10 tests; changed: `server.test.mjs`, `workspace-api.test.mjs`) |
| `corepack pnpm run test:knowledge` | 22 tests: 20 pass, 0 fail, 2 skipped (see below) |
| `corepack pnpm --dir apps/pantheon build` (`tsc --noEmit && vite build`) | pass; `seaxneat.js` and `seaxneat.css` built |
| `git diff --check` | clean |
| `corepack pnpm run verify:platform` | **NOT RUN to completion: it could not start.** `dev:alpha` needs the `stex-igor` submodule, which is not initialized in this worktree (`ENOENT ... stex-igor\apps`, twice). The updated script is syntax-checked only; its new assertions have not been executed. |
| Scratch real-engine check (not committed; Seaxneat engine alone on port 4560, real `pnpm install` and `next build`, real Chrome via the repository's DevTools harness) | PASS, details below |

Scratch check results, all observed: real Next build validated; with a foreign
listener on the project's first candidate port (4920) the preview started on
4921; the served header equals the CSP above; the Next runtime
(`window.next.appDir`) executes and the generated stylesheet applies under that
policy loaded as a top-level sandboxed document; a cross-origin `fetch` and an
`Image` load to a second local origin were both blocked with
`securitypolicyviolation` for `connect-src` and `img-src`, and that server
received 0 requests; an apply while the preview ran restarted it and it then
served the new heading; stop killed the tree, released port 4921, the proxy
refused (HTTP 400, "Preview is not started"), and a second stop was accepted.
The scratch script lives in the session scratchpad and is not part of the
repository; the committed equivalent is the new block in
`scripts/verify/verify-platform.mjs`, which still needs a run on a machine with
the submodule.

Mutation evidence: replacing the K0 adapter with the previous version makes 6
of the 7 new adapter tests fail (symlink/junction chain, traversal and stream
forms, alias forms, `.obsidian` case, directory and missing paths). The new
lifecycle tests call new APIs (`stopPreview`, `preview-port`) or assert the
new restore message and bytes, so they cannot pass on the old code.

K0 skipped cases, explicit in the test output: on this machine creating a file
symlink and a non-junction directory symlink fails with `EPERM` (no symlink
privilege), so those two negative cases were not exercised here. The Windows
junction and nested-link cases did run and pass; the lexical alias, ADS,
traversal, absolute, 8.3, trailing-dot, device-name and `.obsidian` cases run on
every OS.

## Residual risks

- No OS-level isolation (S1): generated code and dependencies run as the user
  with `HOME` passed, no CPU/memory/disk/process limits, and install/build
  steps have unrestricted network. The CSP constrains browser-side requests only.
- The CSP keeps `'unsafe-inline'` for scripts and styles; generated code can run
  inline script. It can still navigate its own frame and talk to its own mount.
- A stopped or never-started preview answers the proxy with 400, not a dedicated
  status; a crashed child leaves `preview.state` as `running` until the next
  start or engine restart.
- A failed build leaves the preview stopped (deliberate: the output directory is
  untrusted); the user restarts it.
- Port probing is racy by nature; the `EADDRINUSE` retry covers the window, and
  exhaustion fails with `NO_PREVIEW_PORT`.
- K0: TOCTOU between checks and read, hard links and bind mounts are not
  prevented; the vault must not be writable by untrusted code. Two symlink
  negative tests were skipped on this machine for lack of privilege. Candidate
  names such as `note~1.md` are refused even when legitimate (conservative).
- `verify:platform` must be run with the submodule present before this is
  treated as release evidence.
