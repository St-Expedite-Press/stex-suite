# STEX user manual

## Enter Pantheon

After an [authorized local setup](DEVELOPER-GUIDE.md#authorized-checkout),
open http://127.0.0.1:4300/. Choose **Sign in** to enter the local single-user
command center. Hosted Igor uses its own password sign-in.

**Pause motion** stops the background animation and remembers the choice
in this browser. Reduced-motion preferences are honored by default.

## Find or create a project

**Continue working** opens your most recently changed project. **Projects**
shows project status and which studio owns each project. Open a studio
from **Studios** to create a book or website. Ēostre and Woden show their
deferred status.

## Edit and proof in Frige

1. Open **Frige** and select an existing book, or create a new scaffold.
2. Select a source node from **Contents**, edit the text, and save. Use
   the contents search or a link to a specific passage to return to it.
3. Use **Typeset proof** to compile. Inspect the PDF and preflight results.
   Profile or source changes can make a prior proof stale.
4. Select a passage to discuss it with Igor or request an editorial
   proposal. Review the proposal and its line-by-line changes before
   accepting it. Frige checks that the selected passage still matches.

On phones, switch between Contents, Editor and Proof. On tablets, Contents
opens a drawer. A proof establishes pagination and compiler output.
Preflight and printer requirements govern publication readiness.

## Build and preview in Seaxneat

1. Open **Seaxneat**, create a project and wait for its validated build.
2. Start the preview. Propose a simulated edit, inspect its diff, and use
   **Apply and validate** to accept it.
3. Inspect revision history or restore a revision after confirmation.
   A restore creates a new revision. A pending proposal survives reload,
   and **Dismiss proposal** records the decision.

The generated preview runs in a sandbox. A failed edit leaves the previous
validated revision available. If a preview server is still starting,
try **Reload preview** after it reports ready.

## Talk to Igor

Send a question from the command center or open **All conversations**.
The standard local stack labels simulated replies. Use Enter to send or
Shift+Enter for a new line. You can rename, archive or delete a conversation,
copy a reply, and retry eligible failures.

To include project material, use **Discuss with Igor** from a workspace or
select a project under **Project context**. Preview the exact text and revisions
of up to four sources, then choose **Use this context**. Choose fewer sources
if the combined selection exceeds the byte limit. Refresh and approve a new
selection to change context. Changing or withdrawing the selection starts a
fresh reasoning context. Earlier records and already-transmitted content
are subject to their own retention behavior.

## Use Graph when enabled

An operator enables the [local knowledge journal](DEVELOPER-GUIDE.md#configuration).
In **Graph**, select a project, inspect its sources and accept the revisions
you want to reference. Graph keeps source identities and provenance.
Assertions and inferred relationships can be reviewed and corrected. Use
**Refresh source access** to recheck availability before relying on a source.

**Withdraw project knowledge** removes current consent. **Export knowledge**
provides a copy of the journal, and **Delete all knowledge** erases the local
journal after confirmation. When offered, **Preview knowledge for Igor**
shows the exact message to approve and send.

## Recover from stale or unavailable work

- **Frige refused a stale save.** Reopen the latest source and reconcile
  your edit before saving again.
- **A studio is unavailable.** The project list shows the affected studio.
  Check its process and refresh. The other available studio remains usable.
- **A Seaxneat edit failed validation.** Read the build output and inspect the
  previous validated revision before retrying.
- **Igor is unavailable or context has changed.** Check the integration and
  start a fresh request with current approved context if an old retry is
  refused.

See [Status](STATUS.md) for current availability and the evidence behind
each capability.
