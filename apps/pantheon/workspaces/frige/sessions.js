/**
 * Pantheon publishing workspace source: a scope's named editorial conversations (D-027).
 *
 * Purpose: a compact switcher and an actions menu in the conversation panel,
 * the dialogs for naming a conversation and for its summary sheet, and the
 * notices that explain a closed conversation. Presentation only: Frige owns the
 * conversations, their lifecycle, summaries and drafts; this module calls the
 * publishing v1 routes under `/api/scopes/<id>/conversations` and renders the
 * answers. It never decides a proposal.
 *
 * Invariants:
 *  - The first conversation (`main`) keeps using the scope's existing turn
 *    routes, so an older Frige without conversations still works unchanged
 *    (the bar stays hidden when the list route is unknown).
 *  - Closing a conversation does not accept, reject or apply a proposal, and
 *    the summary sheet says so where the author closes it.
 *  - Switching conversations reloads only the thread: scope selection, the
 *    source editor and its unsaved text are never touched. Each thread's
 *    scroll position is remembered while the scope stays open.
 *  - Menus are native `<details>`; dialogs are native `<dialog>`. Focus returns
 *    to the control that opened a dialog or menu.
 */
import { element } from './thread.js';

/** Id of a scope's first conversation (its original thread). */
export const MAIN = 'main';
/** Display names of the lifecycle states. */
const LABELS = { active: 'Active', paused: 'Paused', 'awaiting-review': 'Awaiting review', completed: 'Completed', abandoned: 'Abandoned' };
/** The engine's transition table, mirrored only to decide which actions to offer; the engine refuses any other. */
const TRANSITIONS = {
  active: ['paused', 'awaiting-review', 'completed', 'abandoned'], paused: ['active', 'completed', 'abandoned'],
  'awaiting-review': ['active', 'completed', 'abandoned'], completed: ['active'], abandoned: ['active'],
};
const CLOSED = ['completed', 'abandoned'];

/**
 * The route of a conversation's thread. The first conversation uses the scope's
 * original route.
 *
 * @param {string} scopeId
 * @param {string} conversationId
 * @returns {string}  An `/api/…` path for the app's `request`.
 */
export const turnsPath = (scopeId, conversationId) => (conversationId === MAIN ? `/api/scopes/${scopeId}/turns` : `/api/scopes/${scopeId}/conversations/${conversationId}/turns`);
/** The route a message or answer is posted to; the first conversation uses the scope's original route. */
export const turnPath = (scopeId, conversationId) => (conversationId === MAIN ? `/api/scopes/${scopeId}/turn` : `/api/scopes/${scopeId}/conversations/${conversationId}/turn`);

/**
 * One conversation as the engine lists it.
 *
 * @typedef {object} Conversation
 * @property {string} id
 * @property {boolean} main
 * @property {string} title
 * @property {string} lifecycle
 * @property {boolean} archived
 * @property {{ conversationId: string, summaryRevision: number } | null} continuedFrom
 * @property {number | null} summaryRevision  The latest saved revision, if any.
 * @property {number} turnCount
 */

/**
 * Connects the conversation bar and dialogs to the workspace.
 *
 * @param {object} options
 * @param {(url: string, init?: RequestInit) => Promise<any>} options.request  The workspace's API caller (adds the book).
 * @param {() => object | null} options.getChangeSet  The scope's current contract, for the pending-proposal notice.
 * @param {(conversationId: string) => Promise<void>} options.onSwitch  Loads and renders the chosen conversation's thread.
 * @param {() => void} options.onChange  Called after the lifecycle may have changed, so the composer can follow it.
 * @returns {{ fetchFor: (scopeId: string) => Promise<{ list: Conversation[], failure: Error | null }>, adopt: (scopeId: string, fetched: { list: Conversation[], failure: Error | null }) => void, refresh: () => Promise<void>, id: () => string, current: () => Conversation, closed: () => boolean, suffix: () => string, render: () => void }}
 */
export function connectSessions({ request, getChangeSet, onSwitch, onChange }) {
  const find = (selector) => document.querySelector(selector);
  const bar = find('#session-bar'); const switcher = find('#session-switcher'); const actionsMenu = find('#session-actions');
  const list = find('#session-list'); const showArchived = find('#session-show-archived'); const note = find('#session-note');
  /** @type {{ scopeId: string | null, list: Conversation[], id: string, failure: (Error & { status?: number }) | null, scroll: Map<string, number>, ticket: number }} */
  const state = { scopeId: null, list: [], id: MAIN, failure: null, scroll: new Map(), ticket: 0 };
  const synthetic = () => ({ id: MAIN, main: true, title: 'Main conversation', lifecycle: 'active', archived: false, continuedFrom: null, summaryRevision: null, turnCount: 0 });
  const route = (id = state.id) => `/api/scopes/${state.scopeId}/conversations${id ? `/${id}` : ''}`;
  const json = (method, body) => ({ method, body: JSON.stringify(body) });
  const current = () => state.list.find((entry) => entry.id === state.id) || synthetic();
  const closed = () => CLOSED.includes(current().lifecycle);

  // ---- Reading the list ---------------------------------------------------------

  /**
   * Reads a scope's conversations without changing what is shown, so a navigation that is later
   * overtaken by another leaves this module describing the scope still on screen.
   *
   * @param {string} scopeId
   * @returns {Promise<{ list: Conversation[], failure: (Error & { status?: number }) | null }>}
   */
  async function fetchFor(scopeId) {
    try { return { list: (await request(`/api/scopes/${scopeId}/conversations`)).conversations, failure: null }; }
    catch (error) { return { list: [], failure: error }; }
  }

  /** Shows a scope's conversations and opens its first one. A scope change forgets the previous scope's scroll positions. */
  function adopt(scopeId, { list: listed, failure }) {
    state.scopeId = scopeId; state.id = MAIN; state.scroll.clear(); state.list = listed; state.failure = failure; state.ticket += 1;
    render();
  }

  /** Reloads the list, keeping the open conversation. A failure keeps the last list. */
  async function refresh() {
    const scopeId = state.scopeId; const ticket = state.ticket;
    try { const listed = await request(route('')); if (scopeId === state.scopeId && ticket === state.ticket) { state.list = listed.conversations; state.failure = null; } }
    catch (error) { if (scopeId === state.scopeId) state.failure = error; }
    render(); onChange();
  }

  // ---- Rendering ----------------------------------------------------------------

  /** Closes a menu and returns focus to its summary. */
  const closeMenu = (menu) => { menu.open = false; menu.querySelector('summary').focus(); };

  /** Renders the bar, the switcher list, the actions menu and the notices. */
  function render() {
    // An engine without conversations (404) keeps the workspace exactly as it was.
    bar.hidden = state.failure?.status === 404;
    if (bar.hidden) { note.hidden = true; return; }
    const here = current();
    find('#session-current').textContent = state.failure ? 'Conversations unavailable' : here.title;
    find('#session-current').title = here.title;
    const pill = find('#session-lifecycle');
    pill.textContent = state.failure ? 'Unavailable' : `${LABELS[here.lifecycle]}${here.archived ? ' · archived' : ''}`;
    pill.className = `status-pill ${here.lifecycle === 'active' && !state.failure ? 'available' : CLOSED.includes(here.lifecycle) ? '' : 'unavailable'}`;

    // The open conversation is always listed, so the author sees where they are, even if archived.
    const shown = state.list.filter((entry) => showArchived.checked || !entry.archived || entry.id === state.id);
    list.replaceChildren(...shown.map((entry) => {
      const item = element('li'); const choose = element('button', 'quiet-button session-choice', '');
      choose.type = 'button'; if (entry.id === state.id) choose.setAttribute('aria-current', 'true');
      choose.append(element('span', 'session-choice-title', entry.title), element('span', 'session-choice-meta', `${LABELS[entry.lifecycle]}${entry.archived ? ' · archived' : ''} · ${entry.turnCount} message${entry.turnCount === 1 ? '' : 's'}${entry.continuedFrom ? ' · continued' : ''}`));
      choose.addEventListener('click', () => { closeMenu(switcher); if (entry.id !== state.id) switchTo(entry.id); });
      item.append(choose); return item;
    }));
    find('#session-new').disabled = Boolean(state.failure);
    renderActions(here); renderNote(here);
  }

  /** The actions the open conversation's state allows, as menu buttons. */
  function renderActions(here) {
    const holder = find('#session-action-items'); holder.replaceChildren();
    if (state.failure) { actionsMenu.hidden = true; return; }
    actionsMenu.hidden = false;
    const allowed = TRANSITIONS[here.lifecycle];
    const items = [['Rename…', () => rename()]];
    if (allowed.includes('paused')) items.push(['Pause', () => transition('paused')]);
    if (allowed.includes('awaiting-review')) items.push(['Mark awaiting review', () => transition('awaiting-review')]);
    if (allowed.includes('completed')) items.push(['Complete…', () => summarySheet('completed')]);
    if (allowed.includes('abandoned')) items.push(['Abandon…', () => summarySheet('abandoned')]);
    if (allowed.includes('active')) items.push([CLOSED.includes(here.lifecycle) ? 'Reopen' : 'Resume', () => transition('active')]);
    items.push(['Edit summary…', () => summarySheet(null)]);
    if (here.summaryRevision) items.push(['Continue from summary…', () => continueFrom()]);
    items.push([here.archived ? 'Unarchive' : 'Archive', () => archive(!here.archived)]);
    for (const [label, run] of items) {
      const button = element('button', 'quiet-button session-action', label); button.type = 'button';
      button.addEventListener('click', () => { actionsMenu.open = false; run(); });
      holder.append(button);
    }
  }

  /** Explains a closed conversation, and a proposal waiting in another one. */
  function renderNote(here) {
    const parts = [];
    const changeSet = getChangeSet();
    const pending = Boolean(changeSet?.changes?.some((change) => change.status === 'pending'));
    const owner = changeSet ? (changeSet.conversationId || MAIN) : MAIN;
    if (CLOSED.includes(here.lifecycle)) {
      const text = `This conversation is ${LABELS[here.lifecycle].toLowerCase()}. Reopen it to keep talking, or continue from its summary in a new conversation.${pending && owner === here.id ? ' Its pending proposal stays pending: closing did not decide it.' : ''}`;
      const actions = element('span', 'session-note-actions');
      const reopen = element('button', 'quiet-button', 'Reopen'); reopen.type = 'button'; reopen.addEventListener('click', () => transition('active', reopen));
      actions.append(reopen);
      if (here.summaryRevision) { const next = element('button', 'quiet-button', 'Continue from summary…'); next.type = 'button'; next.addEventListener('click', () => continueFrom(next)); actions.append(next); }
      parts.push(element('p', '', text), actions);
    }
    // Proposals are decided per scope, in the conversation that made them.
    if (pending && owner !== here.id) {
      const other = state.list.find((entry) => entry.id === owner);
      const text = `A proposal in this scope is waiting for your decision in “${other?.title ?? 'another conversation'}”. Closing a conversation never decides it.`;
      const open = element('button', 'quiet-button', 'Open that conversation'); open.type = 'button'; open.addEventListener('click', () => switchTo(owner));
      parts.push(element('p', '', text), open);
    }
    note.replaceChildren(...parts); note.hidden = !parts.length;
  }

  /** The conversation's name for the composer's "To …" line. */
  const suffix = () => (state.list.length > 1 || state.id !== MAIN ? ` · ${current().title}` : '');

  // ---- Switching and acting -----------------------------------------------------

  /** Opens another conversation of the scope: only the thread changes. */
  async function switchTo(id, opener = find('#session-current')) {
    const thread = find('#turns');
    state.scroll.set(state.id, thread.scrollTop);
    const previous = state.id; state.id = id; render();
    try { await onSwitch(id); }
    catch (error) { state.id = previous; render(); note.replaceChildren(element('p', 'session-error', `That conversation could not be opened: ${error.message}`)); note.hidden = false; }
    // A thread seen before returns to where it was left; a new one starts at its end.
    thread.scrollTop = state.scroll.has(id) ? state.scroll.get(id) : thread.scrollHeight;
    onChange(); opener?.focus?.();
  }

  /** Runs one engine call, reporting a failure in the workspace notice rather than throwing. */
  async function act(call) {
    try { await call(); } catch (error) { note.replaceChildren(element('p', 'session-error', error.message)); note.hidden = false; return false; }
    return true;
  }

  /** Moves the open conversation to a state; the engine records the actor and time. */
  async function transition(to, opener = actionsMenu.querySelector('summary')) {
    if (await act(() => request(route(), json('PATCH', { lifecycle: to })))) await refresh();
    opener?.focus?.();
  }

  /** Archives or unarchives the open conversation. */
  async function archive(value) {
    if (await act(() => request(route(), json('PATCH', { archived: value })))) await refresh();
    actionsMenu.querySelector('summary').focus();
  }

  // ---- Dialogs ------------------------------------------------------------------

  /**
   * Shows a dialog, restores focus to its opener when it closes, and resolves when it does.
   *
   * @param {HTMLDialogElement} dialog
   * @param {HTMLElement | null} opener
   * @param {HTMLElement} firstField
   * @returns {Promise<void>}
   */
  function show(dialog, opener, firstField) {
    return new Promise((resolve) => {
      dialog.addEventListener('close', () => { opener?.focus?.(); resolve(); }, { once: true });
      dialog.showModal(); firstField.focus();
    });
  }

  /** Asks for a conversation title (required only when renaming) and sends it. */
  async function askTitle({ heading, label, value, required, submit, opener }) {
    const dialog = find('#session-name'); const input = find('#session-name-input'); const status = find('#session-name-status'); const form = find('#session-name-form');
    find('#session-name-title').textContent = heading; find('#session-name-label').textContent = label;
    input.value = value; input.required = required; status.textContent = ''; status.classList.remove('failed');
    form.querySelector('button').textContent = submit.label; form.querySelector('button').disabled = false;
    form.onsubmit = async (event) => {
      event.preventDefault();
      const button = form.querySelector('button'); button.disabled = true; status.textContent = 'Saving…';
      try { await submit.run(input.value.trim()); dialog.close('saved'); }
      catch (error) { status.textContent = error.message; status.classList.add('failed'); button.disabled = false; }
    };
    await show(dialog, opener, input);
  }

  /** Starts a new, empty conversation and opens it. */
  async function create() {
    let made = null;
    await askTitle({
      heading: 'New conversation', label: 'Title (optional)', value: '', required: false, opener: find('#session-current'),
      submit: { label: 'Create', run: async (title) => { made = await request(route(''), json('POST', title ? { title } : {})); } },
    });
    if (made) { await refresh(); await switchTo(made.id); }
  }

  /** Renames the open conversation. */
  async function rename(opener = actionsMenu.querySelector('summary')) {
    await askTitle({
      heading: 'Rename conversation', label: 'Title', value: current().title, required: true, opener,
      submit: { label: 'Rename', run: async (title) => { await request(route(), json('PATCH', { title })); } },
    });
    await refresh();
  }

  /** Starts a new conversation that continues from this one's saved summary. */
  async function continueFrom(opener = actionsMenu.querySelector('summary')) {
    let made = null; const source = current();
    await askTitle({
      heading: 'Continue from summary', label: `Title (optional) — the new conversation starts from “${source.title}” summary, not its messages`, value: '', required: false, opener,
      submit: { label: 'Continue', run: async (title) => { made = await request(`${route()}/continue`, json('POST', title ? { title } : {})); } },
    });
    if (made) { await refresh(); await switchTo(made.id); }
  }

  /** Splits a textarea into list entries: one per non-blank line. */
  const lines = (id) => find(id).value.split('\n').map((line) => line.trim()).filter(Boolean);

  /**
   * The summary sheet. For `completed` or `abandoned` it saves the summary and then closes the
   * conversation (or closes it without one); with `null` it only edits the summary. The draft is
   * Frige's own, never a model's, and is stored only when the author saves it.
   *
   * @param {'completed' | 'abandoned' | null} target
   * @param {HTMLElement | null} [opener]
   */
  async function summarySheet(target, opener = actionsMenu.querySelector('summary')) {
    const dialog = find('#session-summary'); const form = find('#session-summary-form'); const status = find('#session-summary-status'); const source = find('#session-summary-source');
    const conversation = current(); const verb = { completed: 'Complete', abandoned: 'Abandon' }[target];
    find('#session-summary-title').textContent = target ? `${verb} “${conversation.title}”` : `Summary of “${conversation.title}”`;
    find('#session-summary-closing').hidden = !target;
    find('#summary-reason-field').hidden = !target; find('#summary-skip').hidden = !target;
    find('#summary-save').textContent = target ? `Save summary and ${verb.toLowerCase()}` : 'Save summary';
    find('#summary-skip').textContent = `${verb ?? 'Close'} without a summary`;
    for (const id of ['#summary-text', '#summary-decisions', '#summary-open', '#summary-proposals', '#summary-sources', '#summary-reason']) find(id).value = '';
    status.textContent = ''; status.classList.remove('failed'); source.textContent = 'Preparing a draft from Frige’s records…';
    const buttons = [...form.querySelectorAll('button')]; for (const button of buttons) button.disabled = true;
    let latest = null; let draft = null;
    const shown = show(dialog, opener, find('#summary-text'));
    try {
      latest = (await request(`${route()}/summary`)).latest;
      const filled = latest || (draft = await request(`${route()}/summary/draft`).catch((error) => { source.textContent = `A draft could not be prepared (${error.message}). Write the summary yourself.`; return null; }));
      if (filled) {
        find('#summary-text').value = filled.text; find('#summary-decisions').value = filled.decisions.join('\n'); find('#summary-open').value = filled.openQuestions.join('\n');
        find('#summary-proposals').value = filled.outstandingProposals.join('\n'); find('#summary-sources').value = filled.sources.join('\n');
        source.textContent = latest
          ? `Saved revision ${latest.revision} by ${latest.author}, ${new Date(latest.updatedAt).toLocaleString()}. Edit it to save a new revision.`
          : 'Draft prepared from Frige’s records, not by a model. Edit it; nothing is kept until you save.';
      }
    } catch (error) { source.textContent = `The summary could not be loaded: ${error.message}`; status.classList.add('failed'); }
    for (const button of buttons) button.disabled = false;

    /** Moves the conversation to the target state, with the optional reason. */
    const close = () => request(route(), json('PATCH', { lifecycle: target, ...(find('#summary-reason').value.trim() ? { reason: find('#summary-reason').value.trim() } : {}) }));
    form.onsubmit = async (event) => {
      event.preventDefault();
      const items = ['#summary-decisions', '#summary-open', '#summary-proposals', '#summary-sources'].map(lines);
      if (items.some((entries) => entries.length > 20 || entries.some((entry) => entry.length > 300))) { status.textContent = 'Each list holds at most 20 lines of at most 300 characters.'; status.classList.add('failed'); return; }
      for (const button of buttons) button.disabled = true; status.textContent = 'Saving…'; status.classList.remove('failed');
      try {
        await request(`${route()}/summary`, json('PUT', {
          baseRevision: latest?.revision ?? 0, text: find('#summary-text').value.trim(), decisions: items[0], openQuestions: items[1], outstandingProposals: items[2], sources: items[3],
          ...(draft?.throughTurnId ? { throughTurnId: draft.throughTurnId } : {}),
        }));
        if (target) await close();
        dialog.close('saved');
      } catch (error) {
        status.textContent = error.code === 'STALE_SUMMARY' ? 'This summary was changed elsewhere. Close this sheet and open it again to see the latest revision.' : error.message;
        status.classList.add('failed'); for (const button of buttons) button.disabled = false;
      }
    };
    find('#summary-skip').onclick = async () => {
      for (const button of buttons) button.disabled = true; status.textContent = 'Saving…'; status.classList.remove('failed');
      try { await close(); dialog.close('saved'); } catch (error) { status.textContent = error.message; status.classList.add('failed'); for (const button of buttons) button.disabled = false; }
    };
    await shown;
    await refresh();
  }

  // ---- Wiring -------------------------------------------------------------------

  find('#session-new').addEventListener('click', () => { switcher.open = false; create(); });
  showArchived.addEventListener('change', render);
  // A menu closes on a click elsewhere, and on Escape with focus back on its summary.
  document.addEventListener('click', (event) => { for (const menu of [switcher, actionsMenu]) if (!menu.contains(event.target)) menu.open = false; });
  for (const menu of [switcher, actionsMenu]) {
    menu.addEventListener('keydown', (event) => { if (event.key === 'Escape' && menu.open) { event.stopPropagation(); closeMenu(menu); } });
    // Only one menu is open at a time.
    menu.addEventListener('toggle', () => { if (menu.open) for (const other of [switcher, actionsMenu]) if (other !== menu) other.open = false; });
  }
  for (const dialog of [find('#session-name'), find('#session-summary')]) dialog.querySelector('form[method="dialog"] button').addEventListener('click', () => dialog.close('cancelled'));

  return { fetchFor, adopt, refresh, id: () => state.id, current, closed, suffix, render };
}
