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

Choose **Seaxneat**, create a local project, wait for its validated Next.js build, then start the preview. Request a bounded heading edit, inspect it, apply it explicitly, view a revision diff, and restore a validated revision when needed. State is local and the vault is disabled by default.

Ēostre and Woden deliberately show deferred views in A0.
