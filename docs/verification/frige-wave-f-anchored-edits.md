# Frige Wave F, first increment: anchored edits and passage review

**Date:** 2026-11-20. **Status:** implemented and tested; one independent
review round, all findings fixed (see below). **Plan:**
[Wave F](../program/MASTER-PLAN.md#wave-f-specification--first-increment-f-a-and-f-b-together),
[D-020](../program/DECISIONS.md).

| Repository | Base | Branch |
| --- | --- | --- |
| stex-suite | `06c5f13` (`origin/main`, after PR 7) | `feat/frige-f5-workstation` |
| stex-igor | `bd8b3b0` (`main`, deployed) | `feat/anchored-edits`, local only |

## Baseline

Before any change, `corepack pnpm test` on `06c5f13` exited 0:

- Frige 131 tests, none skipped (LuaLaTeX present);
- inference 62, Igor 40, Hermes 12, Seaxneat 24;
- every other Node suite passed;
- Ruff and mypy clean, 64 pytest.

### What Frige already had

Classified from the code, not the documents:

| Capability | Owner | State |
| --- | --- | --- |
| Manuscript reading order, sections, pieces, stable section ids | Frige `project-store-vault.mjs` | Implemented, tested (W3e) |
| Source save with base hash, UTF-8 guard | Frige store | Implemented, tested (W2) |
| Change contracts: record, journal, supersede, conflicts, rollback | Frige `change-contract.mjs`, store | Implemented, tested (W2) |
| All-or-nothing acceptance, crash recovery | Frige store | Implemented, tested (W3d) |
| Layout overrides and layout contracts | Frige `design-settings.mjs`, store | Implemented, tested (W3a, W3b) |
| Hierarchical context by category | Frige store, stex-igor adapter | Implemented, tested; released in `bd8b3b0` |
| Director proposals from a real model | stex-igor adapter → Frige | Implemented; two live turns (W4-c, W4-f) |
| LuaLaTeX assembly, compiler page map, isolated scopes | Frige `book-assembler.mjs`, `lualatex.mjs` | Implemented, tested with real PDFs |
| Diagnostic preflight | Frige `preflight.mjs` | Implemented; never claims press readiness |
| Workstation, proof viewer, proposal cards | Pantheon `workspaces/frige` | Implemented; `verify:frige` |
| Proof annotations, export manifest, profile comparison | — | Absent |

The baseline's main gap for long-form work: a proposal had to repeat the
whole piece. The output budget is 20,000 characters, so a piece over about
15,000 characters could not be proposed at all. A second gap was found in
the workstation diff. When the edited piece passed about 2,000 lines, a
one-line edit was shown as the whole piece removed and re-added.

## What changed

- **Frige engine:**
  - `applyEdits` in `change-contract.mjs` resolves `edits: [{find,
    replace}]` against the offered text.
  - The store's proposal path accepts `edits` or `source`, never both, and
    records the result as an ordinary `replace-node-source` change.
  - Resolved edits skip the whole-text line-ending conversion.
- **Frige inference client:**
  - passes `edits` through from the gateway, keeping only known fields;
  - the simulator accepts `Simulate edit: <exact text> => <replacement>`;
  - a misplaced JSDoc block was moved to `layoutFrom`.
- **Workstation:**
  - `line-diff.js` matches the shared start and end before the LCS, and
    numbers rows;
  - `diffHunks` and `hunkLabel` head each passage;
  - the card says how many passages would change.
- **stex-igor adapter:** reads and shape-checks `edits` without clipping
  them, and the trusted instructions prefer edits.
- **Records:**
  - protocol notes in `protocol/texgraph` and `protocol/frige`;
  - the Frige README;
  - D-020 and the master plan.

## Acceptance

| Criterion | Evidence |
| --- | --- |
| A piece longer than the output budget is revised without repeating it | End to end: a 38,674-character synthetic piece revised by a 210-character director reply. Store test with a piece of the same form |
| Text outside the spans is byte-identical (byte-order mark, Unicode outside the BMP, em spaces, indentation, stanza breaks) | Store test compares the bytes before the first span and after the last, and the whole file against an independent replacement |
| Mixed line endings survive outside the span | Store test "keeps a piece's mixed line endings" |
| Missing, ambiguous (including overlapping occurrences), overlapping, malformed or doubled (`source` and `edits`) proposals create no contract and write nothing | Pure resolver test (18 refusal cases); store test (5 cases through the proposal path); adapter test (7 cases); end to end (ambiguous anchor) |
| The refusal reason reaches the author | Recorded on the assistant turn's `droppedChanges`, which the thread shows; end-to-end check reads it back |
| Staleness: an edit to a piece changed after the proposal is refused, even though the anchor text still occurs | Store test |
| Several pieces' edits in one contract, accepted all-or-nothing | Store test (section with two pieces) |
| Rollback restores the exact prior bytes | Store test, end to end, and `verify:frige` |
| The workstation shows the passage headed by its lines, accepts it and rolls it back | `verify:frige` (Chrome): `Lines 2–6`, `1 passage would change…`, byte-exact acceptance and rollback; screenshot `anchored-edit-proposal.png` |
| A one-line edit in a 3,000-line piece is shown as that line | Pantheon test |
| Generic Igor turns are unaffected; whole-piece proposals still work | Existing inference and Frige tests pass unchanged except for one notice wording |

## Commands

| Command | Result |
| --- | --- |
| `corepack pnpm run test:frige` | 139 tests (8 new). One run passed all 139. In the other runs, all 138 other tests passed and the preflight test failed at the 30-second LuaLaTeX limit. It is pre-existing: see *Limits* |
| `corepack pnpm run test:pantheon` | 20 passed (one new, one updated); after the review fixes, 22 |
| `corepack pnpm run build:pantheon` | Built |
| stex-igor `corepack pnpm test` | Igor 40, inference 64 (two new), Hermes 12, design system 8; none skipped. After the review fixes, inference 65 |
| `corepack pnpm run test:frige` after the review fixes | 140 passed, none skipped |
| `corepack pnpm run verify:frige` | PASS: the full existing workflow plus the anchored-edit step; real LuaLaTeX proofs; five viewports |
| End-to-end script: stub Hermes → stex-igor inference (`remote` transport, `feat/anchored-edits`) → Frige server, synthetic book | 8 of 8 |
| `node --check` on touched modules; `git diff --check` in both repositories | Clean |
| `corepack pnpm test` (suite) | Stopped at `test:frige` on the preflight test (above); every suite before it passed (instructions, assets, design system, Pantheon 20, Igor 40) |
| The suites after Frige, run one by one | inference 64, Seaxneat 24, Hermes 7, knowledge 13, platform (Ruff, mypy, 64 pytest), stex-igor sync: all passed |

The end-to-end script is a throwaway file outside the repositories, under the
Frige charter's rule against committed throwaway scripts. Its checks are
listed in the acceptance table.

## Limits

- **No live turn.** Whether Grok writes usable anchors at scale is
  unverified; only stub and fake transports were used. The trusted
  instructions changed, so a live check needs the owner's approval of a paid
  turn and a stex-igor release.
- **Offer budget unchanged.** A piece conversation is still offered at most
  60,000 characters of source, and the gateway's context budget is 96,000.
  A piece beyond that is still withheld, so the director cannot quote it.
  Excerpted long-form context is increment F-B3.
- **No record of the form.** The contract does not record whether a change
  arrived as edits ([D-020](../program/DECISIONS.md)).
- **Preflight test timing (pre-existing).** The test `preflight reports what
  a real proof gets wrong…` sets a missing font, which makes MiKTeX's font
  lookup slow. Run alone it took 24 s against the engine's 30-second
  LuaLaTeX limit. A local development stack was running on the machine at
  the same time.
  - The test passed in the first baseline run.
  - It then failed in three branch runs at 30.5–30.8 s, and once with
    EBUSY on Windows cleanup.
  - Controlled comparison under the same load: untouched `origin/main`
    (`06c5f13`, in a temporary worktree) failed it in 2 of 2 runs. This
    branch failed it in 1 of 2 runs and passed all 139 tests in the other.

  The failure therefore does not come from this change. Recorded as
  [R-13](../program/RISKS.md).

## Release (2026-11-21 UTC)

The owner directed both branches to be merged ("merge them down"), which
for stex-igor is a production release.

- **Suite:** PR 8 merged as `44cd3ac` after CI passed. The CI run used
  Linux with LuaLaTeX and passed the full `corepack pnpm test`, including
  the preflight test.
- **stex-igor:**
  - PR 4 passed CI, and `main` was fast-forwarded from `bd8b3b0` to
    `c5af494`, the commit the suite pins.
  - Deploy run `44848866828` built and shipped the release. It installed
    `stex-igor-c5af494971a8` in production as generation 14, after the
    install script's two consecutive health checks; the script restores the
    previous release when they fail.
  - The workflow's last step, reading `/opt/stex/current/RELEASE.json`
    over IAP SSH, failed with `Permission denied (publickey)`, so the run
    is marked failed. That step never read a different release; it could
    not connect.
- **Checked from outside:**
  - `https://igor.stexpedite.press/igor/login` answers 200;
  - the API answers its own structured `401 UNAUTHORIZED`, not a proxy
    error.

  The active commit on the VM was not read back after the install.
  Confirming it is an owner step: read `/opt/stex/ACTIVE.json` on the VM,
  or re-run the workflow, which reinstalls the same generation.
- **Not done:** no paid live turn. No `apply-igor-profile.sh` or Hermes
  restart either; neither is needed, because the change is in the
  inference service only.

## Independent review

**Round 1** (2026-11-20). A separate reviewer agent ran with the diffs and
the claims, not the author's conclusions. It is a Claude model: the brief
asked development subagents to avoid Claude, and the owner, shown that
conflict, told the coordinator to proceed. It had reproduction scripts, ran
20,000 random cases against the diff, and probed the store, the resolver
and the adapter.

No Critical or High findings. It could not break:

- byte identity outside the spans;
- the refusal rules;
- the unchanged contract and acceptance path;
- inert rendering of model text (`textContent`).

Every finding was fixed, each with a test that fails without the fix:

| # | Severity | Finding | Fix |
| --- | --- | --- | --- |
| 1 | Medium | The simulator's `Simulate edit:` pattern backtracked cubically. A 12,000-character message without `=>` ran over 120 s, freezing the Frige server (simulator mode only) | The message is split once, at its first `=>`; the test sends the longest allowed message and requires under 1 s |
| 2 | Medium | Edits near both ends of a long piece were shown as one passage of every line between them, because the region exceeded the LCS limit | A region over the limit is split at lines that occur once on each side, and each gap is compared on its own. The test uses a 20,000-line piece, now two passages; a 400-case seeded property test checks that rows rebuild both texts with true line numbers |
| 3 | Low | A replacement ending in `\r` joined the following `\n` into an invisible CRLF | A replacement may not hold a carriage return that ends no line |
| 4 | Low | Edits that cancel out, or a reply that only re-ends lines, vanished with no reason | Both now carry a set-aside reason, which the thread shows |
| 5 | Low | The card's "Every other line … stays exactly as it is" could be false at the byte level: a whole-piece reply re-ends a mixed-ending piece | The card now speaks of text. It says in words when an unchanged line's ending would change, checked line by line |
| 6 | Low | An older Frige talking to the new gateway would silently lose edits-only proposals | Frige advertises `proposalForms: ["source", "edits"]`. The gateway teaches and forwards edits only to such a caller; others get the released instructions, compared byte for byte in a test, and stray edits are set aside with a notice. Release order no longer matters |

Notes recorded without change:

- In a piece that has any CRLF, a multi-line `find` written with `\n` cannot
  match its LF-only lines. Such edits are refused, never misapplied (see
  R-14).
- `verify:frige` uses its own stub for the edit step. The real adapter is
  covered by the stex-igor service test and the end-to-end script.

The fixes were verified by tests and by rerunning `verify:frige` and the
end-to-end script. They were not re-reviewed.
