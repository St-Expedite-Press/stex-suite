# Program risks

Risks to production, user data and program delivery. Hosted-service detail is
kept in the private `stex-igor` reports ([D-008](DECISIONS.md)); entries here
name the category and where to read more.

| ID | Risk | Likelihood | Effect | Mitigation | Owner |
| --- | --- | --- | --- | --- | --- |
| R-01 | A push to `stex-igor` `main` releases to production | Certain if pushed | Service change without review | No program work is pushed. Igor changes stay on local branches until the owner authorizes a named release | Owner authorizes |
| R-02 | Hosted provider credential lapses or is unbounded | Dated in the private D1 report | Hosted Igor stops answering, or uncapped spend | Owner renews and considers a limit | Owner |
| R-03 | Untracked author files under `apps/texgraph/` are staged into this public repository | Possible on any unqualified `git add` | Private writing published | Program commits stage named paths only. The folder is never cleaned. Owner decides where the files belong | Owner decides; agent avoids |
| R-04 | A real manuscript is altered by implementation or tests | Low | Loss of creative source | Synthetic fixtures in temporary directories only; no test opens `apps/frige/books/*/manuscript/` | Agent |
| R-05 | Change-contract storage change strands existing proposals | Low | A pending proposal no longer shown | Schema-2 records stay readable and are journaled on their next decision; covered by a test | Agent |
| R-06 | Rollback restores text that no longer matches what was approved | Low | Silent overwrite of later edits | Rollback requires the current hash to equal the accepted hash; otherwise it refuses and writes nothing | Agent |
| R-07 | Requiring a base hash breaks an unknown client | Low | That client's saves return 400 | Documented in the protocol; every known caller already sends it ([D-004](DECISIONS.md)) | Owner may veto |
| R-08 | Specialist or tool execution enabled without an isolation boundary | Low while toolsets are empty | Uncontrolled execution on the host | Runtime policy keeps toolsets empty; activation needs executable negative tests and owner approval | Owner authorizes |
| R-09 | Program work builds on an unmerged branch (suite PR 5) | Present | Rebase work if `main` moves | Program branch is cut from the PR 5 head; merge order is an owner decision | Owner |
| R-10 | Per-account conversation isolation unverified with two real accounts in production | Present | An undetected leak between accounts | Tested locally; a production check needs authorization | Owner authorizes |
| R-11 | Session usage limits interrupt long agent runs | Occurred on 2026-11-12 and again on 2026-11-14, stopping a review mid-round | Work stops mid-increment | Small increments, records updated as work lands, [handoff](HANDOFF.md) kept current; an interrupted review is rerun from a self-contained brief, not resumed from memory | Agent |
| R-12 | A subagent finding is recorded as fact without confirmation | Possible | Wrong plan | Coordinator re-reads cited code before relying on a finding; unconfirmed items are marked as reported | Agent |
