# STEX user manual

Run `corepack pnpm install --frozen-lockfile`, then `corepack pnpm dev:alpha`. Open `http://127.0.0.1:4300/`.

## Entering Pantheon

The splash shows the Pantheon artwork and an entrance panel. Choose **Sign in** to reach the command center at `/home/`. This is a local, single-user workspace: there is no account, password, or session yet. **Pause motion** stops the background animation on every Pantheon page, and the choice is remembered in this browser. If your system asks for reduced motion, the animation stays still until you choose **Play motion**.

## The command center

The standard local stack uses the deterministic fake transport. A separately
prepared remote runtime exists for operator verification, but it is not enabled
by the normal local workflow.

- **Continue working** opens the project you changed most recently, in whichever studio owns it.
- **Igor** is the assistant. Type a question on the home page and press the arrow: Igor opens it as a new conversation and answers there. **All conversations** opens Igor directly at `/igor/`, where you can start a conversation, continue one, rename, archive, or delete it, copy a reply, and retry a failed one. Press Enter to send and Shift+Enter for a new line; messages are up to 6,000 characters. Conversations are kept on this computer. In the standard local stack, replies are simulated and marked **Simulated**.
- **Studios** opens Frige or Seaxneat. Ēostre and Woden are marked **Deferred** because they are not built yet.
- **Recent projects** lists your latest five; **View all** (or the **Projects** tab) shows every project with its studio and current status, such as "Building" or "Build failed".
- **Graph** shows optional local source provenance and relationships when enabled; otherwise it explains that knowledge is disabled. **Activity** remains unimplemented.

If a studio is not running, the command center says so ("Seaxneat is not responding") and still shows the other studio's projects.

Igor remains the ordinary conversation interface. Its approved specialist
organization uses seven persistent profiles: Architect for structure,
Developer for software, Designer for form and production, Artist for imagery,
Editor for language, Knowledge for research/provenance, and Auditor for
independent verification. These are configured disciplines, not seven newly
enabled chat agents. Specialists and runtime tools remain disabled; full
persistent-session delegation is not an accepted feature. Profile memory
does not replace your projects or shared knowledge, and changing a model does
not create another identity. Direct specialist consultation would require an
explicit choice rather than appearing automatically.

## Frige

Choose **Frige** on the command center, or open a book from its project lists.
The library and workstation use Pantheon's common navigation. Select an
existing local book or create a new scaffold; a book opens only after explicit
selection. Edit a source node, save it, typeset a proof, inspect the PDF and
preflight, and review any simulated Igor proposal before accepting it.
Switch Contents, Editor and Proof on phones; Contents opens a keyboard-safe
drawer on tablets. A stale source save is refused rather than overwriting a
concurrent edit. Unsaved source triggers the browser's leave-page protection.
Publication-profile changes mark an existing proof stale; a mapped proof is
not a press-readiness claim. Do not use protected manuscripts as test fixtures.

## Seaxneat

Choose **Seaxneat** to open the website workspace inside Pantheon's common
navigation. The old `/seaxneat/` link leads to `/workspaces/seaxneat/`.
Create a local project and wait for its validated Next.js build, then start
the preview. Request a bounded simulated heading edit, inspect its proposed
source, and choose **Apply and validate** explicitly. A pending proposal
survives reload; **Dismiss proposal** saves that decision. Inspect a revision
diff or restore a revision after confirmation. A restore creates a new
revision rather than erasing history.

If initial setup fails, the workspace shows **None** for the last validated
revision and displays the failure. A failed edit keeps the previous validated
revision and restores its pre-edit draft. **Refresh projects** inspects state;
a timeout does not automatically retry work. **Reload preview** is useful
while a preview server starts. Previews are sandboxed from the platform.
State remains local in the Seaxneat engine; the vault is disabled by default.

Ēostre and Woden deliberately show deferred views.

## Project context in Igor

Choose **Discuss with Igor** in Frige or **Discuss this project with Igor** in
Seaxneat, or expand
**Project context** in Igor and select a project. Select up to four sources,
choose **Preview selected context**, inspect their exact text and revisions,
then choose **Use this context**. Sending pauses while the selection is being
edited. Source limits are measured in UTF-8 bytes; choose fewer sources if
the combined context is too large.

Only approved pinned revisions are offered. Frige exports manuscript text;
Seaxneat exports its validated source revision, rather than an unfinished
working draft. Engine edits are not added automatically. Use **Refresh source
revisions**, preview again, and approve deliberately to change context.

A conversation stays bound to one project; use **New conversation for another
project** to switch. Changing or withdrawing sources starts a fresh reasoning
context. Earlier messages remain visible but are excluded from later turns.
Wait for a pending reply before changing context. An old failed reply cannot
be retried after its context is withdrawn. Withdrawal does not erase earlier
conversation records or content already transmitted to a runtime/provider.

## Optional project knowledge

Graph is disabled unless an operator selects `STEX_KNOWLEDGE_DATA_DIR` before
starting Pantheon. To use ignored local state from PowerShell at the repository
root:

```powershell
$env:STEX_KNOWLEDGE_DATA_DIR = Join-Path (Get-Location) 'services/knowledge/.local-data'
corepack pnpm dev:alpha
```

Open **Graph**, choose a project from the real studio project list, and choose
**Inspect project sources**. A project's **Project knowledge** link opens
Graph with that project selected. Select source revisions, then choose **Accept
selected revisions**. This stores source identities, revision metadata and
provenance, not copies of the source text. The source and project views update
together. Work in Frige and Seaxneat continues normally with Graph disabled.

Choose an accepted project under **Subject project**, then record an explicit
assertion or propose an inferred relationship with current revision evidence.
Inferences require confidence, remain hypotheses, and can
be accepted, corrected, or rejected. Nothing mines conversations or writes
changes back to an engine automatically. **Refresh source access** checks
whether recorded revisions are still available. A changed, deleted or
unreachable source is unavailable until current revisions are accepted.
Each refresh checks at most 40 sources, four concurrently, within six seconds;
unchecked references also remain unavailable.

**Withdraw project knowledge** removes its current source consent. You can
explicitly accept the same unchanged checkpoint again after fresh checks.
**Export knowledge** downloads the metadata journal and relationships;
**Delete all knowledge** erases that local journal after confirmation. Neither
action removes engine sources, conversations, existing exports or backups.

Accepted relationships with current evidence can be reviewed under **Preview
knowledge for Igor**. Inspect the exact message, approve it, and choose **Send
approved knowledge to Igor**. Access is checked again; changed evidence
requires a fresh preview. Sending creates a normal new Igor conversation with
that message. It does not grant Igor tools or ongoing access to the graph.

## What is still planned

The [platform transition](PLATFORM-TRANSITION.md) concentrates on Frige,
Seaxneat, and Igor. Their composed workspaces, approved project context, and
optional metadata knowledge foundation are implemented and tested locally.
A broader second brain/digital twin, embeddings, multimodal retrieval,
runtime engine tools and shared identity remain future work. Direct
integration with an actual Obsidian vault is a required future milestone;
the current metadata Graph and read-only vault adapter do not provide it.
Python/FastAPI backend migration is also required future work and does not
change the current user workflow during this release.
Activity remains unimplemented. The reviewed release is in progress;
[the release report](verification/platform-release.md) distinguishes local
testing, merges and verified deployment. No Obsidian sync is introduced here.

Hosted Igor at `https://igor.stexpedite.press` has its own password sign-in.
That is separate from the credential-free local Pantheon entrance described
above. The local development command never enables paid inference.
