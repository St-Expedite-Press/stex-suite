# M2a — Pantheon consumes the platform API

Date: 2026-11-08 · Base revision: `ec8eeb3` · Authorization: the owner approved
starting the M2 Pantheon slice; identity (M2b) and PostgreSQL are held for a
separate decision. Local commits only.

## Objective

Make Pantheon's existing project pages read the Python platform API's merged
list (`stex.platform.projects.v1`) without any visible change, keeping the
previous per-studio browser path as the fallback and rollback.

## Implemented

| Item | Detail |
| --- | --- |
| Pantheon route | `GET`/`HEAD /api/platform/v1/projects` → platform `/api/v1/projects`. Exact-path allowlist (`platformPath`); other `/api/platform/v1/*` paths 404, other methods 405. Nothing from the browser request but the method is forwarded (no cookies, origin or query). Target `STEX_PLATFORM_URL`, loopback HTTP only (default `http://127.0.0.1:4340`). Only a `200` JSON answer is relayed. Any other status, a redirect, a non-JSON or compressed reply (`identity` is requested), a body over 4 MB (bounded while streaming), a 5 s timeout or a connection failure answers `502`. The existing loopback-Host guard runs first |
| Browser | `public/projects.js` tries the platform list first and accepts it only if its studios are exactly the registry's active studios, each once. Projects must pass the existing `validProject` rule and belong to an available studio, and `href` is rebuilt locally exactly as the per-studio path builds it; otherwise it runs the unchanged per-studio path. `<html data-projects-source="platform|studios">` records which path rendered. Rendering functions are unchanged |
| Dev stack | `dev:alpha` runs `uv sync --frozen` and starts the platform from `.venv` on `STEX_PLATFORM_PORT` (4340), wiring Pantheon's `STEX_PLATFORM_URL`. The platform is optional there: if uv is missing or the platform exits, a warning is printed and the rest of the stack keeps running on the fallback |
| Platform | `python -m stex` now relies on uvicorn's "Uvicorn running on" line, printed only after the socket is bound (no premature readiness line); access logs off |
| Verification | `verify:home` starts the platform beside real Frige and the Seaxneat stub and requires the platform source; `STEX_VERIFY_PLATFORM=off` requires the fallback source |

No visual, routing, engine, storage or protected-manuscript change.

## Commands and results

| Command | Result |
| --- | --- |
| `corepack pnpm run test:pantheon` | 19 pass (2 new tests: exact-path allowlist including a raw dot-segment path, no browser headers, HEAD without body, 405/404 refusals never reaching the platform; non-JSON, redirect, non-200, compressed and oversized-chunked replies → 502; unreachable platform → 502). The oversized case was confirmed to fail with the bound raised |
| `corepack pnpm test` | Exit 0 (Pantheon 19, platform 64, all other suites unchanged) |
| `corepack pnpm build:pantheon` | Exit 0 |
| `corepack pnpm verify:home` (platform) | PASS, Chrome, 9 viewports. Rendered from `platform`; order Fixture Site / Fixture Book / Old Site, statuses and links, counts 1 and 2, three table rows; with the Seaxneat stub failing, still `platform`, one "Seaxneat is not responding" note, Frige kept; Igor, keyboard and motion checks unchanged |
| `STEX_VERIFY_PLATFORM=off corepack pnpm verify:home` | PASS with source `studios` and the same data checks |
| Screenshot parity | 11 of 12 screenshots byte-identical between the two runs; the Studios page differs only by the playing masthead video frame (visually identical, same counts) |
| `corepack pnpm verify:platform-api` | PASS |
| `corepack pnpm dev:alpha` smoke | All six services ready; `/api/platform/v1/projects` through Pantheon `200` with both studios available and the local library's book listed (metadata only); `/health` `200`. The first probe answered `502` while the platform was still starting, the case the browser fallback covers. `git status apps/frige/books` clean |

## Limits

- With the platform stopped, Node refuses the connection in about 0.1 s, so
  the fallback adds little delay. If the platform hangs, the browser gives up
  after 4 s and falls back, so the worst case before projects appear is about
  6 s, against 2 s before.
- `projects.js`'s validation and fallback are exercised only by the browser
  check (`verify:home`, both modes), not by a unit test.
- The platform and the browser can still order entries differently for
  timestamps without an offset (UTC here, local time in `Date.parse`).
  Studios emit UTC. The `openPath` newline difference the review found is
  fixed (`\Z` instead of `$`).
- The browser fallback remains until the per-studio path is retired in a
  later, separately verified step; until then both paths must keep parity.
- Chrome only; Safari and Firefox not run.
- Stopping `dev:alpha` by killing its parent (rather than Ctrl+C) leaves its
  child servers running on Windows; this predates M2a and applies to every
  service in the stack.

## Independent review

One round by a separate reviewer agent on the diff. Confirmed and fixed:
`verify:home` could leave Frige and Pantheon running when `uv sync` failed
(now prepared before anything starts); the size bound did not bound reading
(now streamed with `identity` encoding and compressed replies refused);
duplicate studio ids passed the browser check (uniqueness now required).
Also adopted: `href` rebuilt locally, no projects from an unavailable studio,
only `200` relayed, `dev:alpha` tolerating a missing or failed platform,
added HEAD/non-200/compressed/oversized/raw-path tests, and a corrected
latency statement (an earlier draft claimed a ~2 s Windows refusal delay;
that was measured for the Python client, not for Node).
