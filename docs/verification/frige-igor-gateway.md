# Frige and Igor gateway verification

2026-11-22. Suite base `545fd93`, private Igor pin `5db7e51`.

The ordinary local launcher continues to select simulated inference. The
opt-in gateway mode reuses a separately started inference service for the
Frige editorial panel and Igor conversations. It checks loopback origin,
health, supported transport and the shared token before starting children.
Upstream credentials are stripped from workspace child environments. The
shared token is passed only to the product servers and the internal
simulator when it is started.

## Acceptance

- A local stack with an independently started inference service in fake
  mode rejected an incorrect shared token before startup. With the matching
  token, the workspace received a visible Frige response marked simulated,
  without starting a second inference service.
- Clicking **Discuss with Igor** from the synthetic Frige manuscript
  opened Igor with that book selected. Preview displayed the exact
  synthetic source and approval unlocked sending. Igor replied through
  the same inference service. The suite browser verifier also followed the
  actual link, refused sending before approval and checked context withdrawal.
- Frige refused redirects for scope and page turns, health, and gateway
  settings. The regression reproduced four forwarded requests before the
  fix and zero afterward.
- An independent reviewer checked startup authorization, redirect refusal,
  size and time bounds, Windows environment isolation and consent polling.
  The review's seven loopback failure checks passed. The full suite passed
  after the Frige change.

This verifies wiring through the actual local inference service with a
simulated transport. Real model requests require separately authorized
runtime isolation and a call budget. The local runtime reconciliation
reported tool-policy drift in the parked profiles. The existing Igor
profile reported empty CLI and API toolsets.
