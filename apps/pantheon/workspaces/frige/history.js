/** Displays and acts on Frige's revision history through the publishing API. */
import { element } from './thread.js';
import { collapse, diffRows, lineEndingsDiffer } from './line-diff.js';

export function connectRevisionHistory({ request, getNode, canChange, onRestore }) {
  const find = (selector) => document.querySelector(selector);
  const dialog = find('#source-history');
  const status = find('#history-status');
  const revisions = find('#history-revisions');
  const decisions = find('#history-decisions');
  const review = find('#history-review');
  const restore = find('#history-restore');
  const older = find('#history-older');
  const decisionForm = find('#history-decision');
  const reason = find('#history-reason');
  let session;

  const active = (view) => dialog.open && view === session;
  const current = (view) => Boolean(view.history && view.node.hash === view.history.currentHash && canChange(view.node));
  function controls(view) {
    const allowed = current(view) && !view.writing && !view.loadingHistory;
    restore.disabled = !allowed || !view.revision || view.revision.hash === view.node.hash;
    reason.disabled = !allowed;
    decisionForm.querySelector('button').disabled = !allowed;
    older.disabled = Boolean(view.writing || view.loadingHistory);
    dialog.querySelector('form[method="dialog"] button').disabled = Boolean(view.writing);
  }
  function base(view) {
    return { baseHash: view.history.currentHash, baseRevisionId: view.history.currentRevisionId };
  }
  const post = (payload) => ({ method: 'POST', body: JSON.stringify(payload) });
  const timestamp = (value) => new Date(value).toLocaleString();

  async function compare(view, id) {
    view.revision = null; review.hidden = true; controls(view);
    const ticket = ++view.comparison;
    try {
      const revision = await request(`${view.route}/revisions/${id}`);
      if (!active(view) || ticket !== view.comparison) return;
      view.revision = revision;
      const changed = diffRows(view.node.source, revision.source);
      const lines = collapse(changed);
      const diff = element('pre', 'change-diff history-lines');
      for (const row of lines.slice(0, 500)) {
        const prefix = { add: '+ ', del: '− ', same: '  ' };
        const text = row.type === 'skip' ? `… ${row.count} unchanged lines` : prefix[row.type] + row.text;
        diff.append(element('span', `diff-${row.type}`, text), '\n');
      }
      const source = element('details', 'history-source');
      source.append(element('summary', '', 'Read exact historical source'), element('pre', '', revision.source));
      find('#history-diff').replaceChildren(diff, source);
      if (lineEndingsDiffer(view.node.source, revision.source, changed)) diff.before(element('p', '', 'Line endings differ.'));
      if (lines.length > 500) diff.after(element('p', '', 'Showing the first 500 comparison rows.'));
      review.hidden = false;
      controls(view);
    } catch (error) {
      if (active(view) && ticket === view.comparison) status.textContent = error.message;
    }
  }

  async function loadRevisions(view, before = null) {
    view.loadingHistory = true; controls(view);
    try {
      const history = await request(`${view.route}/revisions${before ? `?before=${before}` : ''}`);
      if (!active(view)) return;
      view.history = history;
      for (const revision of history.entries) {
        const button = element('button', 'quiet-button', `${revision.summary} ${timestamp(revision.at)}`);
        button.type = 'button';
        button.dataset.revisionId = revision.id;
        button.addEventListener('click', () => { if (!view.writing) compare(view, revision.id); });
        const row = element('li', '');
        row.append(button, element('span', 'history-hash', revision.hash.slice(0, 12)));
        if (revision.id === history.currentRevisionId) row.append(element('span', '', 'Current'));
        revisions.append(row);
      }
      older.hidden = !history.nextBefore;
    } finally {
      view.loadingHistory = false;
      if (active(view)) controls(view);
    }
  }

  async function loadDecisions(view) {
    const result = await request(`${view.route}/decisions`);
    if (!active(view)) return;
    decisions.replaceChildren(...result.entries.map((entry) => {
      const row = element('li', '');
      row.append(element('p', '', entry.reason), element('small', '', `${timestamp(entry.at)} · Revision ${entry.revisionId.slice(0, 8)}`));
      return row;
    }));
    if (!result.entries.length) decisions.append(element('li', '', 'No editorial decisions recorded.'));
  }

  find('#show-history').addEventListener('click', async () => {
    const node = getNode();
    if (!node) return;
    const view = { node, route: `/api/nodes/${node.id}`, comparison: 0 };
    session = view;
    find('#source-history-title').textContent = `Revision history · ${node.title}`;
    status.textContent = 'Loading history…';
    review.hidden = older.hidden = true;
    revisions.replaceChildren(); decisions.replaceChildren(); decisionForm.reset();
    controls(view);
    dialog.showModal();
    try {
      await Promise.all([loadRevisions(view), loadDecisions(view)]);
      if (active(view)) status.textContent = !current(view) ? 'Reload the current source or save your draft before making a decision or restoring.'
        : revisions.children.length ? '' : 'No source revisions yet. Save an edit or record a decision to start the history.';
    } catch (error) { if (active(view)) status.textContent = error.message; }
  });

  older.addEventListener('click', async () => {
    const view = session;
    if (view.writing || view.loadingHistory) return;
    try { await loadRevisions(view, view.history.nextBefore); }
    catch (error) { if (active(view)) status.textContent = error.message; }
  });
  dialog.addEventListener('cancel', (event) => { if (session?.writing) event.preventDefault(); });

  async function write(view, action) {
    if (view.writing || view.loadingHistory || !current(view)) return;
    view.writing = true; controls(view);
    try { await action(); }
    catch (error) { if (active(view)) status.textContent = error.message; }
    finally { view.writing = false; if (active(view)) controls(view); }
  }

  restore.addEventListener('click', () => {
    const view = session;
    const revision = view.revision;
    if (!revision) return;
    write(view, async () => {
      const result = await request(`${view.route}/revisions/${revision.id}/restore`, post(base(view)));
      await onRestore(view.node, result.node);
      if (active(view)) dialog.close();
    });
  });

  decisionForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const view = session;
    write(view, async () => {
      await request(`${view.route}/decisions`, post({ ...base(view), reason: reason.value }));
      if (!active(view)) return;
      decisionForm.reset();
      review.hidden = true;
      view.revision = null;
      view.comparison += 1;
      revisions.replaceChildren();
      await Promise.all([loadRevisions(view), loadDecisions(view)]);
      status.textContent = 'Editorial decision recorded.';
    });
  });
}
