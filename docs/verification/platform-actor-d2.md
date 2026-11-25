# Platform actor and personal knowledge (D2)

Milestone D2 of the persistent-workspaces program
([D-028](../program/DECISIONS.md#d-028--a-verified-actor-reaches-the-engines)).
Pantheon is the sender of `stex.platform.actor.v1`, and hosted knowledge
journals are per signed-in person. Date: 2026-11-25. Base: `921007b`.

## Scope

- `apps/pantheon/src/actor.mjs`: secret validation, header stripping, header
  construction.
- `apps/pantheon/server.mjs`: strips the three headers from every request in
  every mode; sets them for the admitted user on engine proxies only
  (Frige, Seaxneat, legacy `/api/books`), never Igor.
- `services/knowledge/src/library.mjs`: per-person journals, bounded cache.
- `apps/pantheon/src/knowledge-api.mjs`: journal resolved from the admitted
  user; actor headers on engine fetches; `legacyJournal` field.
- Confirmed by reading `apps/seaxneat/server.mjs` (read only): its preview
  proxy forwards only `accept` to generated code, so actor headers never
  reach generated content.

## Commands and results

| Command | Result |
| --- | --- |
| `node --check` on touched modules | pass |
| `corepack pnpm run test:pantheon` | 36 tests, 36 pass (6 new in `actor.test.mjs`) |
| `corepack pnpm run test:knowledge` | 19 tests, 19 pass (6 new in `library.test.mjs`) |
| `corepack pnpm run verify:knowledge` (Chrome, local mode, synthetic data) | PASS, desktop and 390 px without overflow |
| Mutation check: remove `stripActorHeaders` from the server | 3 of 6 actor tests fail |
| `git diff --check` | clean |

New tests cover: forged headers stripped (local and hosted) as seen at a stub
engine; all three headers for an admitted user on engine, Seaxneat and
`/api/books` proxies; none to Igor; invalid username forwards nothing; unknown
role becomes `member`; short secret refuses start (local and hosted); hosted
without secret warns once and sends nothing; two users isolated over HTTP
(read, export, revoke, erase); the `/accept` engine fetch carries the actor;
no session gives `401`; the root journal is untouched and reachable only
through `STEX_KNOWLEDGE_LEGACY_OWNER`; local mode unchanged; corrupt and
locked journals fail for that person only and recover when fixed; cache
eviction releases locks and busy journals are not evicted.

## Residual risks

- Hosted without `STEX_PLATFORM_ACTOR_SECRET` sends no actor (warned once);
  engines cannot attribute until the coordinator adds the secret to the
  Pantheon and engine environments.
- The legacy hosted root journal stays unreachable until
  `STEX_KNOWLEDGE_LEGACY_OWNER` is set; setting it is an owner decision.
- A user whose Igor username is not visible ASCII (or is over 128
  characters) gets a personal knowledge journal but no actor headers.
- Opening a 33rd concurrent journal returns `503` rather than evicting one in
  use.
- Engine receivers (Frige) are separate work; this evidence covers the
  sender and knowledge only. No browser check of hosted multi-user knowledge
  was run; HTTP-level tests stand in for it.
