# Frige stable section identity — Wave 3e evidence

**Objective:** a section keeps its conversation, proposals and contracts
when its first piece is renamed or reordered, and records made under its
earlier ids stay attached, as specified in
[the master plan](../program/MASTER-PLAN.md#3e--stable-section-identity).

**Status:** implemented and tested locally; two independent review rounds
recorded below. Not pushed, not merged, not deployed.

| Item | Value |
| --- | --- |
| Branch | `feat/frige-change-contracts` (local), on top of `953372b` |
| stex-igor | Unchanged by this wave |
| Dates | 2026-11-18 |
| Environment | Windows 11, Node 24.18 |
| Data | Synthetic books in temporary directories only |

## What changed

| Path | Change |
| --- | --- |
| `apps/frige/src/project-store-vault.mjs` | Section ids are `section-<hash of folder, case-insensitive>`; runs of a split folder keep ids by shared pieces, largest overlap first, against the previous graph and then every id the folder has had (remembered durably with its last pieces); a run of wholly new pieces inherits only a one-for-one vanished run, and any other run gets an id never issued before. `legacyIds` are derived (the old `scope-<piece>` form for each current piece) plus a durable `section-aliases.json` map of old ids that carry data; the same file keeps each issued section id with its last pieces. Turns, proposals, contracts, artifacts, answers, supersede, conflicts, approved context and live-build matching treat all of a section's ids as one. A graph from before stable ids is rebuilt on first use. An acceptance refuses a change to a piece outside its conversation's section |
| `apps/frige/src/preflight.mjs` | A proof made under an earlier id still describes its section |
| `apps/frige/src/change-contract.mjs` | Conflict detection excludes every id of the proposing scope |
| `apps/pantheon/workspaces/frige/app.js` | Scopes are found by earlier ids too; proof and live-build matching use them |
| `apps/frige/test/project-store-vault.test.mjs` | Thirteen tests |
| `protocol/frige/README.md`, `apps/frige/README.md` | Section ids and aliases documented |

Contract touched: `stex.frige.publishing.v1`, compatibly. Section scope ids
change form, but every earlier id is still accepted and resolves to the same
section. The workstation reads ids from the graph, so it follows them.

## Acceptance criteria and evidence

| Criterion | Evidence |
| --- | --- |
| Renaming or reordering a section's first piece keeps its conversation and contracts | "a section keeps its id, conversation and proposals when its first piece is renamed or reordered" |
| Records under the old id form stay attached, after a later rename, many renames, a lost graph, and a case-only folder rename | "conversations and contracts recorded under a section id from before stable ids stay attached…"; "old-form section ids stay attached through many renames, a lost graph, and a case-only folder rename" |
| An old id still addresses the section; new records, artifacts and proofs resolve to it | Both tests above; "a graph from before stable ids is rebuilt on first use, and records, artifacts and proofs addressed by old ids resolve to the section" |
| A split folder's runs keep distinct ids; a vanished run is never taken over | "a folder that appears in two places…"; "when one run of a split folder disappears, the other keeps its own id…" |
| No alias belongs to two sections | The many-renames test asserts it across the book |
| A change to a piece outside the conversation's section is never applied | "a contract change to a piece outside its conversation's section is never applied" |
| A run whose pieces were all renamed keeps its id; a new run never inherits a vanished one when the pairing is ambiguous | "a split run whose every piece was renamed keeps its id…"; "a new run never inherits a vanished run while another run of the folder is also unmatched" |
| Runs keep the id they share the most pieces with | "a run keeps the id of the earlier run it shares the most pieces with…" |
| A retired id is never reissued to a new run; a returning run, or a lost graph, recovers ids by pieces | "a section id once retired is never issued again…"; "with the graph lost, a split folder's runs recover their own ids by their pieces…"; the vanished-run test's restore step |
| A damaged line in a piece file read for old section turns does not break the section thread | "a damaged line in a piece file read for old section turns…" |

## Commands and results

Final run, 2026-11-18, after the round-2 fixes:

| Command | Result |
| --- | --- |
| `node --check apps/frige/src/project-store-vault.mjs` | Passed |
| `node --test apps/frige/test/project-store-vault.test.mjs` | 32 passed, 0 failed |
| `corepack pnpm test` | Passed: 240 Node tests, 0 failed, 0 skipped (LuaLaTeX present); platform mypy clean; 64 pytest passed |
| `corepack pnpm build:pantheon` | Passed |
| `corepack pnpm verify:frige` | `PASS: platform publishing workflow, real proof, five viewports` |
| `git diff --check` | No whitespace errors |

## Independent review

**Round 1**, by a separate reviewer agent with reproduction scripts. It found
one High and three Medium defects in the first design, which kept aliases
only in the rebuildable graph file and matched runs by position:

| Finding | Disposition |
| --- | --- |
| **High:** when one run of a split folder vanished, the next run took its id, its thread and its pending proposal, and accepting that proposal wrote a piece no longer in the section | Redesigned: runs keep ids by shared pieces, and a run sharing none gets an unused id. Defence in depth: an acceptance refuses a piece outside its conversation's section |
| Medium: a 20-alias cap evicted the only alias that held data | No cap; old-form aliases are derived from current pieces, and those with data are remembered durably |
| Medium: losing `graph.json` lost every alias | Aliases no longer depend on it: derived ones are recomputed; remembered ones are in `section-aliases.json` |
| Medium: turns kept in an earlier first piece's own file were lost after a reorder | Every old-form alias's piece file is read |
| Low: two runs could share an alias | Impossible now: derived aliases follow a piece's single section, and a remembered id belongs to the first section that claimed it |
| Low: artifacts recorded under the id they were addressed by | Recorded under the current id |
| Low: a case-only folder rename changed the id | Folders compared without case |
| Low: proofs made under an earlier id stopped matching their section | Preflight, live build and the workstation match all ids |
| Low: the first page load after the upgrade served old ids | A graph without stable ids is rebuilt on first use |
| Also adopted | The answer lock uses the current id; a dangling pointer no longer hides one filed under another id; only "scope not found" falls back silently |

**Round 2**, by a separate reviewer agent against the redesign. This was
the charter's last review round; its fixes are verified by tests only.

| Finding | Disposition |
| --- | --- |
| Medium (N1): a run of new pieces could inherit a vanished run even while another run of the folder was also unmatched, so the pairing was a guess | Fixed: that inheritance happens only between runs that share no pieces with anything, one for one, with no other unmatched run |
| Medium (N3): an id retired by a merge could be issued again to a later new run, which inherited its thread and proposals | Fixed: every issued id is remembered durably with its last pieces and never issued to a new run. Running the tests showed that a bare list of retired ids also cost a returning run its id and renumbered every run after a lost graph; remembering pieces lets both recover their ids instead |
| Low (N2): runs matched in reading order, so an earlier run could take a later run's better match | Fixed: largest overlap first across all pairs |
| Low (N4): one damaged line in a piece's own thread file broke its section's thread | Fixed: that file is read tolerantly when read for old section turns (the piece's own thread still reports damage) |
| Low: when runs merge, the smaller run's records detach | Documented as a limit; they reattach if a run holding its pieces returns |
| Documentation: the protocol said one run never takes over another's records, and named the section check only | Corrected in `protocol/frige/README.md` |

## Limits

- **Renaming a section's folder changes its id.** Nothing reattaches the old
  folder's section records, every piece in it gets a new node id (so piece
  threads and contracts detach too), and folder-keyed layout overrides no
  longer apply. A case-only rename is not affected.
- **An old-form id follows its piece.** If a piece that once opened a section
  moved to another section before its records were first seen, its old
  section's records follow the piece. Once seen, the durable map keeps them
  with the first section.
- **A first piece renamed while the earlier version was running** could
  already have orphaned that section's records before this change.
- **Ids follow pieces.** A run takes over the id, and the records, of the
  run whose pieces it now holds. When runs merge, the larger overlap wins and
  the other id's records stay unattached until a run holding its pieces
  returns.
- **Without the memory file**, a lost graph falls back to ids in reading
  order for split folders. If the file is damaged it reads as empty, and the
  next refresh rewrites it from the current book.
- **Reading a section's thread costs two lookups per piece** (its old-form id
  and its own file, for turns kept by older versions).
