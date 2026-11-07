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
- **Graph** and **Activity** say plainly that they are not built yet.

If a studio is not running, the command center says so ("Seaxneat is not responding") and still shows the other studio's projects.

## Frige

Choose **Frige** on the command center, or open a book from its project lists. Select an existing local book or create a new scaffold. A book opens only after explicit selection. Edit a source node, save it, typeset a proof, inspect the PDF and preflight, and review any fake-Hermes proposal before accepting it. Do not use a protected manuscript as a test fixture.

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

Ēostre and Woden deliberately show deferred views in A0.

## What is still planned

The [platform transition](PLATFORM-TRANSITION.md) concentrates on Frige,
Seaxneat, and Igor. Frige's workstation and Igor's conversations still use
their current interfaces; shared project-aware assistance is planned.
The User Graph is intended as a persistent second brain and digital twin
linked to a source/artifact knowledge base, with explicit provenance and
correctable inferences. Today Graph and Activity remain unbuilt, and the
optional local knowledge adapter only reads selected Markdown. There is no
automatic knowledge synchronization or multimodal retrieval.

Hosted Igor at `https://igor.stexpedite.press` has its own password sign-in.
That is separate from the credential-free local Pantheon entrance described
above. The local development command never enables paid inference.
