import { createProofViewer } from './proof-viewer.js';
import { element, renderThread } from './thread.js';
import { appUrl } from './base-path.js';

const $ = (selector) => document.querySelector(selector);
const book = new URLSearchParams(location.search).get('book');
if (book) { const link = document.createElement('a'); link.className = 'quiet-button'; link.href = '/igor/new?project=' + encodeURIComponent('stex://frige/project/' + book); link.textContent = 'Discuss with Igor'; document.querySelector('.publishing-toolbar').append(link); }
if (book) { const link = document.createElement('a'); link.className = 'quiet-button'; link.href = '/graph/?project=' + encodeURIComponent('stex://frige/project/' + book); link.textContent = 'Project knowledge'; document.querySelector('.publishing-toolbar').append(link); }
// `pending` counts undecided proposals per piece across the book (from the engine's contract history);
// `passage` is the selected passage attached to the next message; `filter` narrows the book tree.
const state = { drafts: new Map(), graph: null, node: null, scope: null, turns: [], changeSet: null, contracts: new Map(), thinking: false, notice: '', view: 'thread', sourceDirty: false, pageMap: null, referenceMap: null, design: null, designHash: null, defaultDesignHash: null, trimSizes: [], preflight: null, attachments: [], build: null, liveBuild: null, pending: new Map(), passage: null, filter: '' };
const apiUrl = (pathname) => `${appUrl(pathname)}${pathname.includes('?') ? '&' : '?'}book=${encodeURIComponent(book || '')}`;

async function request(url, options = {}) {
  const response = await fetch(apiUrl(url), { headers: { 'content-type': 'application/json', ...(options.headers || {}) }, ...options });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(payload.error || 'Request failed.'), { status: response.status, code: payload.code || null, errors: Array.isArray(payload.errors) ? payload.errors : [] });
  return payload;
}

function scopes() {
  const fallback = { id: 'book', kind: 'book', title: book?.replaceAll('-', ' ') || 'Book', nodeIds: state.graph.readingOrder, anchorNodeId: state.graph.readingOrder[0], buildThroughNodeId: state.graph.readingOrder.at(-1), sections: [] };
  const canonical = state.graph.book || fallback;
  return [canonical, ...(canonical.sections || [])];
}
function scopeFor(id) {
  // A section is also found by an earlier id (its `legacyIds`), as the engine resolves it.
  const found = scopes().find((scope) => scope.id === id) || scopes().find((scope) => scope.legacyIds?.includes(id));
  if (found) return found;
  const node = state.graph.nodes.find((entry) => entry.id === id);
  return node ? { id: node.id, kind: 'node', title: node.title, anchorNodeId: node.id, nodeIds: [node.id], buildThroughNodeId: node.id } : null;
}

// Only a schema 3 page map carries pages reported by the compiler; older proofs are estimates.
const compiledMap = () => (state.pageMap?.schemaVersion >= 3 ? state.pageMap : null);
// Book page numbers: an isolated proof's map carries them; a book-order proof's pages are book pages.
const bookFirst = (entry) => entry.firstBookPage ?? entry.firstPage;
const bookLast = (entry) => entry.lastBookPage ?? entry.lastPage;
const pageRange = (entry) => (bookFirst(entry) === bookLast(entry) ? `p. ${bookFirst(entry)}` : `pp. ${bookFirst(entry)}–${bookLast(entry)}`);
const nodePages = (id) => compiledMap()?.nodes.find((entry) => entry.nodeId === id && entry.firstPage) || null;

// Sections the author has opened in the book tree; the one holding the current selection always opens.
const expanded = new Set();
const sectionOf = (nodeId) => state.graph.book?.sections?.find((section) => section.nodeIds.includes(nodeId)) || null;

const plural = (count, noun) => `${count} ${noun}${count === 1 ? '' : 's'}`;

/**
 * One selectable row of the book tree. Its accessible name states what the
 * marks only show: pending proposals, unsaved edits and review flags.
 *
 * @param {string} className
 * @param {string} title
 * @param {string} pages  Verified page range, or empty.
 * @param {() => void} onClick
 * @param {{ active?: boolean, detail?: string, flagged?: string, treeId: string, pending?: number, unsaved?: boolean }} options
 * @returns {HTMLButtonElement}
 */
function treeButton(className, title, pages, onClick, { active = false, detail = '', flagged = '', treeId, pending = 0, unsaved = false }) {
  const button = element('button', `${className}${active ? ' active' : ''}`); button.type = 'button';
  button.dataset.treeId = treeId;
  if (active) button.setAttribute('aria-current', 'true');
  button.append(element('span', 'tree-title', title));
  if (unsaved) button.append(element('span', 'tree-mark tree-unsaved', '●'));
  if (pending) button.append(element('span', 'tree-mark tree-pending', String(pending)));
  if (flagged) button.append(element('span', 'tree-flag', '!'));
  button.append(element('span', 'tree-pages', pages));
  const states = [unsaved && 'unsaved edits', pending && `${plural(pending, 'proposal')} awaiting your decision`, flagged && 'review flag', pages && `pages ${pages}`].filter(Boolean);
  button.setAttribute('aria-label', states.length ? `${title}, ${states.join(', ')}` : title);
  button.title = [detail || title, flagged].filter(Boolean).join('\n');
  button.addEventListener('click', onClick);
  return button;
}

/** Whether a piece matches the navigator's filter, by title or by its file below `manuscript/`. */
const matchesFilter = (node, query) => !query || node.title.toLowerCase().includes(query) || node.relativePath.toLowerCase().includes(query);

// One tree for the book: the whole book, its sections in table-of-contents order, and their pieces.
// Page numbers come from the latest verified book-order proof, or else from the proof on screen.
// The tree is rebuilt from the engine's graph each time, so it never holds a hierarchy of its own;
// focus is restored to the row that had it, so keyboard navigation survives a rebuild.
function renderNodes() {
  const graph = state.graph; const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const focused = document.activeElement?.closest?.('#book-tree [data-tree-id]')?.dataset.treeId || null;
  const source = state.referenceMap || compiledMap();
  const pages = new Map((source?.nodes || []).filter((entry) => entry.firstPage).map((entry) => [entry.nodeId, entry]));
  const flags = new Map(); for (const entry of graph.diagnostics) flags.set(entry.nodePath, [...(flags.get(entry.nodePath) || []), entry.message]);
  const range = (ids) => {
    const entries = ids.map((id) => pages.get(id)).filter(Boolean); if (!entries.length) return '';
    const first = Math.min(...entries.map(bookFirst)); const last = Math.max(...entries.map(bookLast));
    return first === last ? `${first}` : `${first}–${last}`;
  };
  const query = state.filter.trim().toLowerCase();
  const pendingIn = (ids) => ids.reduce((sum, id) => sum + (state.pending.get(id) || 0), 0);
  const unsavedHere = (id) => state.sourceDirty && state.node?.id === id;
  const open = state.scope?.kind === 'node' ? sectionOf(state.scope.id) : state.scope?.kind === 'book' ? null : state.scope;
  if (open) expanded.add(open.id);
  const piece = (node) => treeButton('tree-piece', node.title, range([node.id]), async () => { if (await loadNode(node.id, node.id) && nodePages(node.id)) showPdfPage(nodePages(node.id).firstPage); }, {
    treeId: node.id, active: state.scope?.id === node.id, detail: `manuscript/${node.relativePath}${node.changedOnDisk ? ' · changed on disk' : ''}`, flagged: (flags.get(node.relativePath) || []).join('\n'),
    pending: state.pending.get(node.id) || 0, unsaved: unsavedHere(node.id),
  });
  let shown = 0;
  const group = (id, title, nodeIds, selectable) => {
    // While filtering, a section shows the pieces that match, or all of them when its own title matches.
    const titleMatches = Boolean(query) && title.toLowerCase().includes(query);
    const visible = nodeIds.map((nodeId) => byId.get(nodeId)).filter(Boolean).filter((node) => titleMatches || matchesFilter(node, query));
    if (query && !visible.length && !titleMatches) return null;
    shown += visible.length;
    const isOpen = query ? true : expanded.has(id); const wrap = element('div', `tree-section${isOpen ? ' open' : ''}`); const row = element('div', 'tree-row');
    // A selectable section opens and closes from its title row with the arrow keys, so its toggle is
    // left out of the Tab order; a static group has no such row and keeps its toggle reachable.
    const toggle = element('button', 'tree-toggle', isOpen ? '▾' : '▸'); toggle.type = 'button'; if (selectable) toggle.tabIndex = -1;
    toggle.setAttribute('aria-expanded', String(isOpen)); toggle.setAttribute('aria-label', `${isOpen ? 'Collapse' : 'Expand'} ${title}`);
    toggle.disabled = Boolean(query);
    toggle.addEventListener('click', () => { if (isOpen) expanded.delete(id); else expanded.add(id); renderNodes(); });
    const heading = selectable
      ? treeButton('tree-section-title', title, range(nodeIds), () => selectScope(id), { treeId: id, active: state.scope?.id === id, pending: pendingIn(nodeIds), unsaved: nodeIds.some(unsavedHere) })
      : element('span', 'tree-section-title tree-static', title);
    heading.dataset.section = id;
    row.append(toggle, heading);
    wrap.append(row);
    if (isOpen) { const children = element('div', 'tree-children'); children.append(...visible.map(piece)); wrap.append(children); }
    return wrap;
  };
  const unlisted = graph.nodes.filter((node) => !graph.readingOrder.includes(node.id) && node.kind !== 'programme').map((node) => node.id);
  const bookPages = source?.targetScope?.id === 'book' ? `${source.pagination.physicalPageCount} pp.` : '';
  const groups = [
    ...(graph.book?.sections || []).map((section) => group(section.id, section.title, section.nodeIds, true)),
    ...(unlisted.length ? [group('unlisted', 'Not in the table of contents', unlisted, false)] : []),
  ].filter(Boolean);
  $('#book-tree').replaceChildren(
    treeButton('tree-book', 'Whole book', bookPages, () => selectScope('book'), { treeId: 'book', active: state.scope?.kind === 'book', detail: 'The whole book, in table-of-contents order', pending: pendingIn(graph.readingOrder) }),
    ...groups,
    ...(query && !shown ? [element('p', 'tree-empty', `No piece matches “${state.filter.trim()}”.`)] : []),
  );
  const pieces = graph.readingOrder.length; const sections = graph.book?.sections?.length || 0;
  $('#book-summary').textContent = `${plural(pieces, 'piece')} · ${plural(sections, 'section')}`;
  $('#tree-count').textContent = query ? `${shown} of ${plural(pieces + unlisted.length, 'piece')}` : '';
  const count = graph.diagnostics.length;
  $('#diagnostics').textContent = count ? `${count} review flag${count === 1 ? '' : 's'}` : 'No review flags';
  $('#diagnostics').title = graph.diagnostics.map((entry) => `${entry.nodePath}: ${entry.message}`).join('\n');
  if (focused) $(`#book-tree [data-tree-id="${CSS.escape(focused)}"]`)?.focus();
}

/**
 * Arrow-key movement through the book tree's rows (Up, Down, Home, End);
 * Right opens a section and Left closes it, or moves from a piece to its
 * section. Enter and Space keep their native button behaviour. Rows are
 * ordinary buttons, so Tab still reaches the tree in page order.
 *
 * @param {KeyboardEvent} event
 */
function treeKeys(event) {
  const row = event.target.closest?.('[data-tree-id]'); if (!row) return;
  const rows = [...$('#book-tree').querySelectorAll('[data-tree-id]')];
  const index = rows.indexOf(row);
  const go = (target) => { if (target) { event.preventDefault(); target.focus(); } };
  if (event.key === 'ArrowDown') go(rows[index + 1]);
  else if (event.key === 'ArrowUp') go(rows[index - 1]);
  else if (event.key === 'Home') go(rows[0]);
  else if (event.key === 'End') go(rows.at(-1));
  else if ((event.key === 'ArrowRight' || event.key === 'ArrowLeft') && row.dataset.section) {
    const open = expanded.has(row.dataset.section); const wantOpen = event.key === 'ArrowRight';
    if (open !== wantOpen && !state.filter.trim()) { event.preventDefault(); if (wantOpen) expanded.add(row.dataset.section); else expanded.delete(row.dataset.section); renderNodes(); }
    else if (wantOpen && open) go(rows[index + 1]);
  } else if (event.key === 'ArrowLeft' && row.classList.contains('tree-piece')) {
    go(row.closest('.tree-section')?.querySelector('[data-section][data-tree-id]'));
  }
}

/**
 * Counts undecided proposals per piece across the book from the engine's
 * contract history, for the tree's marks. A failure leaves the last counts.
 */
async function refreshPending() {
  try {
    const pending = new Map();
    for (const contract of await request('/api/project/contracts')) {
      for (const change of contract.changes) if (change.status === 'pending' && change.nodeId) pending.set(change.nodeId, (pending.get(change.nodeId) || 0) + 1);
    }
    state.pending = pending; renderNodes();
  } catch { /* the marks keep their last counts */ }
}

// What a conversation with each kind of scope is about, in the author's terms.
function scopeSubject(scope) {
  if (scope.kind === 'book') return { name: 'the whole book', short: 'Whole book', reach: 'Igor can suggest changes to the table of contents and discuss any part of the book.' };
  if (scope.kind === 'node') return { name: `“${scope.title}”`, short: scope.title, reach: 'Igor can suggest changes to this page.' };
  return { name: `the section “${scope.title}”`, short: scope.title, reach: `Igor can suggest changes to the ${scope.nodeIds.length} piece${scope.nodeIds.length === 1 ? '' : 's'} in this section.` };
}

// Keeps the reader at the bottom of the thread unless they have scrolled up to reread.
function renderTurns({ follow = false } = {}) {
  const box = $('#turns'); const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  const subject = scopeSubject(state.scope);
  const last = renderThread(box, {
    turns: state.turns || [], thinking: state.thinking, notice: state.notice, changeSet: state.changeSet, contracts: state.contracts, drafts: state.drafts, onDecide: decide, onRevert: revert, onAnswer: sendAnswer,
    artifactUrl: (id, { download = false } = {}) => apiUrl(`/api/artifacts/${id}/content${download ? '?download=1' : ''}`),
    empty: { title: `Talk with ${subject.name}`, text: subject.reach },
  });
  if (!last) return;
  // A new reply scrolls to its start so a long answer or its suggested changes read from the top.
  if (follow) box.scrollTop += last.getBoundingClientRect().top - box.getBoundingClientRect().top - 8;
  else if (atBottom) box.scrollTop = box.scrollHeight;
}

function setView(view) {
  state.view = view;
  $('#show-thread').setAttribute('aria-selected', String(view === 'thread')); $('#show-source').setAttribute('aria-selected', String(view === 'source'));
  $('#source-panel').classList.toggle('hidden', view !== 'source'); $('#turns').classList.toggle('hidden', view !== 'thread');
  // Returning to the source shows the attached passage selected again, while it still describes this text.
  const passage = state.passage;
  if (view === 'source' && passage && passage.nodeId === state.node?.id && passage.baseHash === state.node.hash && !state.sourceDirty) $('#source').setSelectionRange(passage.start, passage.end);
  renderEditorState();
}

/**
 * The address of a scope: the book stays in `book`, the open book, section or
 * piece in `scope` (absent for the whole book), so a reload or a shared link
 * opens the same place.
 *
 * @param {string} scopeId
 * @returns {string}
 */
function scopeUrl(scopeId) {
  const params = new URLSearchParams(location.search);
  if (scopeId && scopeId !== 'book') params.set('scope', scopeId); else params.delete('scope');
  return `${location.pathname}?${params}${location.hash}`;
}

function renderAttachments() {
  const box = $('#attachments');
  box.replaceChildren(...state.attachments.map((attachment) => {
    const item = element('span', `attachment ${attachment.contextState}`, attachment.name);
    if (attachment.contextState === 'pending-review') {
      const approve = element('button', 'quiet-button', 'Use in chat'); approve.type = 'button'; approve.addEventListener('click', () => approveAttachment(attachment.id)); item.append(' ', approve);
    } else item.append(element('small', '', attachment.contextState === 'approved' ? ' attached' : ' extracting'));
    return item;
  }));
}

// A page or section typesets alone with the book's preamble; the book typesets in full.
const buildPlan = (scope) => (scope.kind === 'book'
  ? { label: 'Typeset book', mode: 'prefix' }
  : { label: scope.kind === 'node' ? 'Typeset page' : 'Typeset section', mode: 'isolated' });

function renderNode() {
  const scope = state.scope || scopeFor(state.node.id); const subject = scopeSubject(scope);
  $('#conversation-context').textContent = `Conversation · ${scope.kind === 'book' ? 'whole book' : scope.kind === 'node' ? 'page' : 'section'}`;
  $('#conversation-title').textContent = scope.title;
  $('#composer-scope').textContent = `To ${subject.short}`;
  $('#message').placeholder = `Message ${subject.name}…`;
  $('#source').value = state.node.source;
  // The scope under discussion and the one file this editor saves are different things for books and sections.
  $('#source-label').textContent = scope.kind === 'node' ? 'Markdown' : `${scope.kind === 'book' ? 'Table of contents' : `First piece of ${scope.title}`} · select a piece to edit it`;
  $('#source-hash').textContent = state.node.hash.slice(0, 12);
  $('#save-state').textContent = `manuscript/${state.node.relativePath}`;
  const plan = buildPlan(scope);
  if (!$('#build').disabled) $('#build').textContent = plan.label;
  $('#build-book').classList.toggle('hidden', scope.kind === 'book');
  // A passage attached for this piece no longer describes it once its text has changed.
  if (state.passage?.nodeId === state.node.id && state.passage.baseHash !== state.node.hash) { state.passage = null; renderPassageChip(); }
  renderNodes(); renderLiveBuild(); renderNodePages(); renderStatus(); renderEditorState();
}

function showPdfPage(page) {
  if (state.viewer) { state.viewer.showPage(page); return; }
  // A fresh view parameter makes the browser's PDF viewer honour the page fragment.
  $('#pdf').src = `${apiUrl(`/api/project/preview?at=${state.pdfStamp || Date.now()}&view=${Date.now()}`)}#page=${page}`;
  $('#pdf').classList.remove('hidden'); $('#empty-preview').classList.add('hidden');
}

function showProof() {
  state.pdfStamp = Date.now(); const url = apiUrl(`/api/project/preview?at=${state.pdfStamp}`);
  $('#empty-preview').classList.add('hidden');
  if (!state.viewer) { $('#pdf').src = url; $('#pdf').classList.remove('hidden'); return; }
  $('#proof-viewer').classList.remove('hidden');
  state.viewer.load(url, compiledMap()).then(() => renderNodePages()).catch(() => { $('#build-state').textContent = 'The proof PDF could not be opened in the viewer.'; });
}

// Captions and click targets for the proof viewer come only from the compiler page map.
function describePage(number) {
  const entry = compiledMap()?.pages[number - 1]; if (!entry) return {};
  const titles = new Map(state.graph.nodes.map((node) => [node.id, node.title]));
  return { bookPage: entry.bookPage ?? number, blank: entry.blank, nodeId: entry.nodeIds[0] || null, label: entry.blank ? 'blank' : entry.nodeIds.map((id) => titles.get(id) || id).join(' / ') };
}

function renderNodePages() {
  const mapped = state.node && nodePages(state.node.id); const button = $('#node-pages');
  button.classList.toggle('hidden', !mapped);
  if (mapped) button.textContent = `Show ${pageRange(mapped)} in proof`;
  state.viewer?.highlight(mapped?.firstPage, mapped?.lastPage);
}

function renderBuild(build) {
  const ready = build?.ok === true;
  const target = build?.targetScope?.title;
  $('#build-state').textContent = ready ? `Built ${build.pageMap?.mode === 'isolated' ? target : `through ${target}`}` : build?.error || 'Not built';
  $('#build-log').textContent = build?.log || '';
  $('#build-log-section').open = build?.ok === false;
  if (ready || build?.lastSuccessful || state.pageMap) showProof();
  renderStatus();
}

// Compares the displayed proof with the graph: changed node sources, and a table of
// contents that now includes different nodes for the proof's scope. Null when no proof is shown.
function proofStaleness() {
  const map = state.pageMap; if (!map?.sourceHashes || !state.graph) return null;
  const current = new Map(state.graph.nodes.map((node) => [node.id, node.hash]));
  const changed = Object.entries(map.sourceHashes).filter(([id, hash]) => current.get(id) !== hash).length;
  const scope = scopeFor(map.targetScope?.id); const order = state.graph.readingOrder;
  const included = !scope ? [] : map.mode === 'isolated' ? order.slice(order.indexOf(scope.nodeIds[0]), order.indexOf(scope.buildThroughNodeId) + 1) : order.slice(0, order.indexOf(scope.buildThroughNodeId) + 1);
  // Proofs made before profiles existed used the default profile.
  const designChanged = Boolean(state.designHash) && (map.designHash ?? state.defaultDesignHash) !== state.designHash;
  return { changed, orderChanged: JSON.stringify(included) !== JSON.stringify(map.includedNodeIds || []), designChanged };
}
const isStale = (staleness) => Boolean(staleness && (staleness.changed || staleness.orderChanged || staleness.designChanged));

function proofIsCurrent() {
  const staleness = proofStaleness();
  return Boolean(state.build?.ok && scopeFor(state.build.targetScope?.id)?.id === state.scope?.id && compiledMap()?.mode !== 'isolated' && !state.sourceDirty && staleness && !isStale(staleness) && compiledMap()?.pagination.verified);
}

function statusItem(name, value, tone = '', detail = '') {
  const item = element('span', `status-item ${tone}`); if (detail) item.title = detail;
  item.append(element('small', '', name), value); return item;
}

function paginationText(compiled) {
  if (!compiled) return ['estimated · legacy proof', 'warn'];
  if (!compiled.pagination.verified) return [`unverified · ${compiled.pagination.warnings.length} warning(s)`, 'warn'];
  if (compiled.mode !== 'isolated') return [`${compiled.pagination.physicalPageCount} pages · compiler-mapped`, 'good'];
  const first = compiled.numbering.startPage; const last = first + compiled.pagination.physicalPageCount - 1;
  const basis = { 'book-proof': 'numbered from the book proof', provisional: 'provisional numbers · earlier pages changed', unknown: 'numbered from 1 · no book proof yet' }[compiled.numbering.basis];
  return [`pp. ${first}–${last} alone · ${basis}`, compiled.numbering.basis === 'book-proof' ? 'good' : 'warn'];
}

// Production state, not editing state: each item is derived from recorded artifacts.
function renderStatus() {
  if (!state.graph) return;
  const map = state.pageMap; const compiled = compiledMap(); const stale = proofStaleness(); const flags = state.graph.diagnostics;
  const items = [];
  if (state.node) items.push(statusItem('Source', `${state.node.hash.slice(0, 8)}${state.sourceDirty ? ' · unsaved edits' : ''}`, state.sourceDirty ? 'warn' : ''));
  items.push(statusItem('Proof', map ? `${map.targetScope?.title || 'book'}${compiled?.mode === 'isolated' ? ' (alone)' : ''} · ${new Date(map.builtAt).toLocaleString()}` : 'none', map ? '' : 'warn'));
  const staleText = stale && [stale.changed && `${stale.changed} node${stale.changed === 1 ? '' : 's'} changed`, stale.orderChanged && 'contents changed', stale.designChanged && 'design changed'].filter(Boolean).join(' · ');
  if (map) items.push(statusItem('Currency', staleText ? `stale · ${staleText} since proof` : state.sourceDirty ? 'unsaved edits are not in the proof' : 'matches saved source', staleText || state.sourceDirty ? 'warn' : 'good'));
  if (map) { const [text, tone] = paginationText(compiled); items.push(statusItem('Pagination', text, tone, compiled?.pagination.warnings.join('\n'))); }
  if (state.build?.ok === false) items.push(statusItem('Last build', 'failed · showing previous proof', 'bad', state.build.error));
  items.push(statusItem('Review flags', String(flags.length), flags.length ? 'warn' : 'good', flags.map((entry) => `${entry.nodePath}: ${entry.message}`).join('\n')));
  const counts = preflightCounts();
  // A check that did not run is never reported as passing.
  if (counts) items.push(statusItem('Preflight', [counts.fail && `${counts.fail} failed`, counts.warn && `${counts.warn} warning(s)`, counts.unavailable && `${counts.unavailable} not checked`].filter(Boolean).join(' · ') || 'all checks pass', counts.fail ? 'bad' : counts.warn || counts.unavailable ? 'warn' : 'good'));
  items.push(statusItem('Press readiness', 'not assessed', 'warn'));
  $('#production-status').replaceChildren(...items);
}

const preflightCounts = () => state.preflight && state.preflight.checks.reduce((counts, entry) => ({ ...counts, [entry.status]: (counts[entry.status] || 0) + 1 }), { pass: 0, warn: 0, fail: 0, unavailable: 0 });

// Preflight describes the proof on screen; it is opened automatically when a check fails.
function renderPreflight() {
  const counts = preflightCounts(); if (!counts) return;
  $('#preflight-state').textContent = `${counts.pass} pass · ${counts.warn} warn · ${counts.fail} fail${counts.unavailable ? ` · ${counts.unavailable} not checked` : ''}`;
  $('#preflight-list').replaceChildren(...state.preflight.checks.map((entry) => {
    const item = element('li', `preflight-${entry.status}`);
    // The outcome is written out, not only coloured.
    const outcome = element('strong', 'preflight-title'); outcome.append(element('span', 'preflight-badge', { pass: 'Pass', warn: 'Warning', fail: 'Fail', unavailable: 'Not checked' }[entry.status] || entry.status), ` ${entry.title}`);
    item.append(outcome, element('span', 'preflight-detail', entry.detail));
    if (entry.items?.length) { const list = element('ul'); list.append(...entry.items.slice(0, 12).map((text) => element('li', '', text))); item.append(list); }
    return item;
  }));
  if (counts.fail) $('#preflight-section').open = true;
  renderStatus();
}
async function refreshPreflight() { try { state.preflight = await request('/api/project/preflight'); renderPreflight(); } catch { /* the status bar keeps the last report */ } }

// Each control is one saved profile setting; saving makes the current proof stale until it is typeset again.
const designField = (form, name) => form.elements.namedItem(name);
/**
 * Where the selected scope's own settings are stored in the profile: a section
 * by its top-level folder, a piece by its node id. The whole book has no
 * override; its settings are the profile itself.
 *
 * @param {object | null} scope
 * @returns {{ field: 'sections' | 'nodes', key: string, label: string } | null}
 */
function overrideTarget(scope) {
  // Only a piece in the reading order is typeset, so only such a piece can have its own settings.
  if (scope?.kind === 'node') return state.graph.readingOrder.includes(scope.id) ? { field: 'nodes', key: scope.id, label: 'This piece' } : null;
  if (scope && scope.kind !== 'book' && scope.folder) return { field: 'sections', key: scope.folder, label: 'This section' };
  return null;
}

/** Shows the selected scope's own settings, with the book's values as the placeholders they fall back to. */
function fillOverride() {
  const form = $('#design-panel'); const target = overrideTarget(state.scope); const box = $('#scope-override');
  box.hidden = !target; if (!target) return;
  const own = state.design[target.field]?.[target.key] || {};
  $('#override-legend').textContent = `${target.label} · ${state.scope.title}`;
  $('#override-head').hidden = target.field !== 'sections';
  designField(form, 'override.fontSize').value = own.fontSize || ''; designField(form, 'override.fontSize').placeholder = state.design.fontSize;
  designField(form, 'override.leading').value = own.leading || ''; designField(form, 'override.leading').placeholder = state.design.leading;
  designField(form, 'override.opensRecto').value = own.opensRecto === undefined ? '' : String(own.opensRecto);
  // The blank choice follows the level above: a piece's section, or a section's book rule.
  designField(form, 'override.opensRecto').options[0].textContent = target.field === 'nodes' ? 'As its section' : 'As the book';
  designField(form, 'override.headText').value = own.headText || ''; designField(form, 'override.headText').placeholder = state.scope.title;
  $('#override-note').textContent = target.field === 'nodes'
    ? 'Blank fields follow this piece’s section, then the book. Size and leading are set together.'
    : 'Blank fields follow the book. A piece’s own settings take precedence. Size and leading are set together.';
}

/**
 * The selected scope's override as the profile API takes it: the values set
 * replace its override, and nothing set clears it (`null`).
 *
 * @returns {object}  `{}` for the whole book.
 */
function readOverride() {
  const target = overrideTarget(state.scope); if (!target) return {};
  const form = $('#design-panel'); const value = (name) => designField(form, `override.${name}`).value.trim();
  const override = {};
  if (value('fontSize') || value('leading')) { override.fontSize = value('fontSize'); override.leading = value('leading'); }
  if (value('opensRecto')) override.opensRecto = value('opensRecto') === 'true';
  if (target.field === 'sections' && value('headText')) override.headText = value('headText');
  return { [target.field]: { [target.key]: Object.keys(override).length ? override : null } };
}

function fillDesign() {
  const form = $('#design-panel'); const design = state.design;
  designField(form, 'trimSize').replaceChildren(...state.trimSizes.map((size) => new Option(size, size)));
  for (const name of ['trimSize', 'bodyFont', 'fontSize', 'leading', 'headTitle']) designField(form, name).value = design[name];
  for (const side of ['top', 'bottom', 'inner', 'outer']) designField(form, `margins.${side}`).value = design.margins[side];
  for (const name of ['runningHeads', 'folios', 'rectoOpeners']) designField(form, name).checked = design[name];
  fillOverride();
  // The panel now shows the saved profile; any edit after this is unsaved.
  state.designDirty = false;
  // The profile this form shows; a save names it, so the engine refuses it if the profile has moved on.
  state.panelDesignHash = state.designHash;
}
function readDesign() {
  const form = $('#design-panel');
  return {
    ...Object.fromEntries(['trimSize', 'bodyFont', 'fontSize', 'leading', 'headTitle'].map((name) => [name, designField(form, name).value.trim()])),
    margins: Object.fromEntries(['top', 'bottom', 'inner', 'outer'].map((side) => [side, designField(form, `margins.${side}`).value.trim()])),
    ...Object.fromEntries(['runningHeads', 'folios', 'rectoOpeners'].map((name) => [name, designField(form, name).checked])),
    ...readOverride(),
  };
}
function toggleDesign(open = $('#design-panel').classList.contains('hidden')) {
  if (open) { fillDesign(); $('#design-state').textContent = ''; }
  $('#design-panel').classList.toggle('hidden', !open); $('#open-design').setAttribute('aria-expanded', String(open));
}
/**
 * Reloads the publication profile after a decision or rollback changed it, so
 * the Design panel, the status bar and the proof's currency show what is saved.
 */
async function refreshDesign() {
  try {
    const profile = await request('/api/project/design');
    state.design = profile.design; state.designHash = profile.hash;
    const open = !$('#design-panel').classList.contains('hidden');
    // Unsaved edits in the open panel are never overwritten; the author is told the saved profile moved.
    if (open && state.designDirty) $('#design-state').textContent = 'The saved profile changed while you were editing. Saving now is refused so it cannot undo that change; note your edits, then Close and reopen the panel.';
    else if (open) fillDesign();
    renderStatus(); renderLiveBuild();
  } catch (error) { $('#design-state').textContent = `The profile could not be reloaded: ${error.message}`; }
}

async function saveDesign(event) {
  event.preventDefault();
  try {
    const saved = await request('/api/project/design', { method: 'PUT', body: JSON.stringify({ ...readDesign(), baseHash: state.panelDesignHash }) });
    state.design = saved.design; state.designHash = saved.hash; fillDesign();
    $('#design-state').textContent = 'Saved.';
    renderStatus(); renderLiveBuild(); refreshPreflight();
  } catch (error) { $('#design-state').textContent = error.message; }
}

function renderLiveBuild() {
  const button = $('#send-live-build');
  if (!button) return;
  const matchingHandoff = scopeFor(state.liveBuild?.targetScope?.id)?.id === state.scope?.id ? state.liveBuild : null;
  button.disabled = !proofIsCurrent();
  if (matchingHandoff?.status === 'queued-locally') {
    $('#live-build-state').textContent = `Staged locally at ${new Date(matchingHandoff.queuedAt).toLocaleTimeString()}; not sent to a remote build.`;
  } else if (proofIsCurrent()) {
    $('#live-build-state').textContent = '';
  } else if (compiledMap()?.mode === 'isolated') {
    $('#live-build-state').textContent = 'Typeset the whole book to send it to the live build.';
  } else {
    $('#live-build-state').textContent = '';
  }
}

/**
 * The change contracts proposed in one conversation, by contract id. The
 * thread uses them to show which accepted changes can still be rolled back.
 * An engine without contract history yields an empty map: the thread still
 * renders, without rollback controls.
 *
 * @param {string} scopeId
 * @returns {Promise<Map<string, object>>}
 */
async function contractsFor(scopeId) {
  try { return new Map((await request(`/api/project/contracts?scope=${encodeURIComponent(scopeId)}`)).map((entry) => [entry.id, entry])); }
  catch { return new Map(); }
}

/**
 * A comparable summary of which contracts have a recorded proof, and when.
 *
 * @param {Map<string, object>} contracts
 * @returns {string}
 */
const proofsOf = (contracts) => JSON.stringify([...contracts.values()].map((entry) => [entry.id, entry.proof?.completedAt || null]));

/**
 * Opens a piece in the editor and a scope's conversation. Opening another
 * scope records it in the address (`history: 'push'` by default, `'replace'`
 * to correct the address, `'none'` when the browser's own history moved),
 * opens a piece on its source and a book or section on its conversation, and
 * lets go of a passage selected elsewhere.
 *
 * @param {string} id  The piece the editor shows.
 * @param {string} [scopeId]  The conversation's scope; the piece itself by default.
 * @param {{ history?: 'push' | 'replace' | 'none' }} [options]
 * @returns {Promise<boolean>}  `false` when the author kept unsaved edits instead.
 */
async function loadNode(id, scopeId = id, { history: record = 'push' } = {}) {
  if (state.sourceDirty && state.node?.id !== id && !confirm('Discard unsaved Markdown changes?')) return false;
  const scope = scopeFor(scopeId) || scopeFor(id);
  const [node, turns, changeSet, contracts] = await Promise.all([request(`/api/nodes/${id}`), request(`/api/scopes/${scope.id}/turns`), request(`/api/scopes/${scope.id}/changes`), contractsFor(scope.id)]);
  const changedScope = state.scope?.id !== scope.id;
  state.node = node; state.scope = scope; state.turns = turns; state.changeSet = changeSet; state.contracts = contracts; state.sourceDirty = false;
  if (changedScope) {
    state.notice = '';
    // A passage belongs to the conversation it was selected for.
    if (state.passage) { state.passage = null; renderPassageChip(); }
    const address = scopeUrl(scope.id);
    if (record === 'push' && address !== `${location.pathname}${location.search}${location.hash}`) history.pushState({ scope: scope.id }, '', address);
    else if (record === 'replace') history.replaceState({ scope: scope.id }, '', address);
  }
  renderNode(); renderTurns(); if (changedScope) $('#turns').scrollTop = $('#turns').scrollHeight;
  if (changedScope) setView(scope.kind === 'node' ? 'source' : 'thread');
  if (changedScope && !$('#design-panel').classList.contains('hidden')) fillOverride();
  return true;
}

async function selectScope(scopeId, options = {}) {
  const scope = scopeFor(scopeId);
  if (!scope?.anchorNodeId) return false;
  return loadNode(scope.anchorNodeId, scope.id, options);
}

/**
 * Follows the browser's Back and Forward through scopes. Unsaved edits are
 * guarded as for a click; if the author keeps them, the address returns to
 * the scope still open.
 */
async function followHistory() {
  const wanted = scopeFor(new URLSearchParams(location.search).get('scope') || 'book') || scopeFor('book');
  if (!wanted || wanted.id === state.scope?.id) return;
  const opened = await selectScope(wanted.id, { history: 'none' });
  if (!opened && state.scope) history.pushState({ scope: state.scope.id }, '', scopeUrl(state.scope.id));
}

// --- Selected passages -------------------------------------------------------
// The editor's text uses one `\n` per line ending (a browser text field reports
// its value that way); the engine maps a selection in these coordinates to the
// canonical bytes and refuses it if the piece changed or the text differs.

/** What each passage action is called, and the message it starts with; the author can change the message. */
const PASSAGE_ACTIONS = {
  ask: { label: 'Ask Igor', prompt: '' },
  revise: { label: 'Revise', prompt: 'Revise the selected passage.' },
  explain: { label: 'Explain', prompt: 'Explain how the selected passage works.' },
  alternatives: { label: 'Alternatives', prompt: 'Suggest alternative readings of the selected passage.' },
  compare: { label: 'Compare', prompt: 'Compare readings of the selected passage.' },
};
/** The engine's limit on a passage, in editor characters. */
const MAX_PASSAGE = 12_000;

const linesLabel = ({ startLine, endLine }) => (startLine === endLine ? `line ${startLine}` : `lines ${startLine}–${endLine}`);

/**
 * The editor's selection in editor coordinates, with the lines it covers.
 *
 * @returns {{ start: number, end: number, text: string, startLine: number, endLine: number, line: number, column: number }}
 */
function editorSelection() {
  const area = $('#source'); const { selectionStart: start, selectionEnd: end, value } = area;
  const lineAt = (offset) => value.slice(0, offset).split('\n').length;
  return { start, end, text: value.slice(start, end), startLine: lineAt(start), endLine: lineAt(Math.max(start, end - 1)), line: lineAt(end), column: end - value.lastIndexOf('\n', end - 1) };
}

/** Whether the editor shows a piece this conversation offers to Igor, so a passage of it can be sent. */
const passageEligible = () => Boolean(state.scope && state.scope.kind !== 'book' && state.node && state.node.kind !== 'programme' && (state.scope.nodeIds || []).includes(state.node.id));

/** The cursor position and, for a selection, the passage bar and its actions. */
function renderEditorState() {
  if (!state.node) return;
  const selection = editorSelection(); const selected = selection.end > selection.start;
  $('#source-position').textContent = selected ? `${linesLabel(selection)} selected · ${plural(selection.text.length, 'character')}` : `Ln ${selection.line}, Col ${selection.column}`;
  const bar = $('#passage-bar'); bar.hidden = !(selected && passageEligible());
  if (bar.hidden) return;
  const reason = state.sourceDirty ? 'Save your edits to act on a passage.' : selection.text.length > MAX_PASSAGE ? `A passage can be at most ${MAX_PASSAGE.toLocaleString()} characters.` : state.thinking ? 'Igor is answering.' : '';
  $('#passage-label').textContent = reason || `${linesLabel(selection)} of “${state.node.title}”`;
  bar.querySelectorAll('button').forEach((button) => { button.disabled = Boolean(reason); });
}

/**
 * Attaches the editor's selection to the next message with an action, and
 * moves to the composer with that action's message. Nothing is sent yet: the
 * author can read the exact passage in the chip, change the message, and send.
 *
 * @param {keyof typeof PASSAGE_ACTIONS} action
 */
function choosePassageAction(action) {
  const selection = editorSelection();
  if (selection.end <= selection.start || state.sourceDirty || !passageEligible()) return;
  state.passage = { nodeId: state.node.id, title: state.node.title, baseHash: state.node.hash, start: selection.start, end: selection.end, text: selection.text, startLine: selection.startLine, endLine: selection.endLine, action };
  const input = $('#message'); const current = input.value.trim();
  // A message the author wrote is kept; one an earlier action filled in is replaced.
  if (!current || Object.values(PASSAGE_ACTIONS).some((entry) => entry.prompt === current)) input.value = PASSAGE_ACTIONS[action].prompt;
  renderPassageChip(); sizeComposer();
  input.focus(); input.setSelectionRange(input.value.length, input.value.length);
}

/** The passage attached to the next message: what will be sent, and a way to remove it. */
function renderPassageChip() {
  const chip = $('#passage-chip'); const passage = state.passage;
  chip.hidden = !passage;
  if (!passage) { chip.replaceChildren(); return; }
  const preview = element('details', 'passage-preview');
  preview.append(
    element('summary', '', `${PASSAGE_ACTIONS[passage.action].label} · ${linesLabel(passage)} of “${passage.title}”`),
    element('pre', 'passage-text', passage.text),
    element('p', 'passage-note', passage.action === 'ask'
      ? 'Sent to Igor as context for your question, exactly as shown.'
      : 'Sent to Igor exactly as shown. Igor may propose changes to this passage only, and nothing changes until you accept.'),
  );
  const remove = element('button', 'quiet-button passage-remove', 'Remove'); remove.type = 'button';
  remove.setAttribute('aria-label', 'Remove the selected passage from this message');
  remove.addEventListener('click', () => { state.passage = null; renderPassageChip(); $('#message').focus(); });
  chip.replaceChildren(preview, remove);
}

async function saveSource() {
  const button = $('#save-source'); button.disabled = true;
  try {
    state.node = await request(`/api/nodes/${state.node.id}`, { method: 'PUT', body: JSON.stringify({ source: $('#source').value, baseHash: state.node.hash }) }); state.graph = await request('/api/project/graph'); state.sourceDirty = false; state.build = null;
    // A passage selected before the save no longer describes the saved text.
    if (state.passage?.nodeId === state.node.id) { state.passage = null; renderPassageChip(); }
    renderNode(); renderBuild(null);
  }
  catch (error) { $('#save-state').textContent = error.message; } finally { button.disabled = false; }
}

function sizeComposer() { const input = $('#message'); input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, 220)}px`; }

// The Igor pill reports the gateway's own health: model, key and reachability.
async function refreshIgor() {
  const pill = $('#gateway-state');
  try {
    const health = await request('/api/inference/health');
    const text = { ready: `Igor · ${health.model}`, simulated: 'Igor · simulated', unconfigured: 'Igor not configured', 'key-rejected': 'Igor key rejected', 'provider-unreachable': 'Igor unreachable', 'gateway-unreachable': 'Gateway not running' }[health.state] || 'Igor status unknown';
    pill.textContent = text; pill.title = health.detail || ''; pill.className = `status-pill ${health.state === 'ready' ? 'available' : 'unavailable'}`;
  } catch { pill.textContent = 'Igor status unknown'; pill.className = 'status-pill unavailable'; }
}

// Answering a choice or form is a turn: the store validates it against the prompt and
// Igor replies. Until Igor has the answer it is kept as a draft, so a failure or a
// re-render leaves the form filled in and sendable again.
async function sendAnswer(promptId, values) {
  const scope = state.scope; if (state.thinking) return;
  state.drafts.set(promptId, values); state.thinking = true; state.notice = ''; renderTurns({ follow: true });
  try {
    await request(`/api/scopes/${scope.id}/turn`, { method: 'POST', body: JSON.stringify({ answer: { promptId, values } }) });
    state.drafts.delete(promptId);
  } catch (error) {
    state.notice = `Answer not sent: ${error.message}`;
    if (error.status === 503) refreshIgor();
  } finally {
    // Reload either way: a 409 means it was answered elsewhere, and the thread should show that.
    if (state.scope?.id === scope.id) [state.turns, state.changeSet] = await Promise.all([request(`/api/scopes/${scope.id}/turns`), request(`/api/scopes/${scope.id}/changes`)]).catch(() => [state.turns, state.changeSet]);
    if (state.scope?.id === scope.id) state.contracts = await contractsFor(scope.id);
    state.thinking = false;
    if (state.scope?.id === scope.id) renderTurns({ follow: true });
    refreshPending();
  }
}

async function sendTurn(event) {
  event?.preventDefault();
  const input = $('#message'); const button = $('#turn-form [type="submit"]'); const message = input.value.trim();
  if (!message || !state.scope || state.thinking) return;
  // The engine checks the passage against the piece as it is now; the browser's copy is only a request.
  const passage = state.passage;
  const selection = passage ? { nodeId: passage.nodeId, baseHash: passage.baseHash, start: passage.start, end: passage.end, text: passage.text, action: passage.action } : undefined;
  const scope = state.scope; button.disabled = true; input.value = ''; sizeComposer(); setView('thread');
  state.passage = null; renderPassageChip();
  state.turns = [...state.turns, { role: 'user', message, at: new Date().toISOString(), ...(passage ? { passage } : {}) }]; state.thinking = true; state.notice = ''; renderTurns({ follow: true });
  try {
    const result = await request(`/api/scopes/${scope.id}/turn`, { method: 'POST', body: JSON.stringify({ message, ...(selection ? { selection } : {}) }) });
    if (result.availability !== 'available') refreshIgor();
    if (state.scope?.id !== scope.id) return;
    [state.turns, state.changeSet, state.contracts] = await Promise.all([request(`/api/scopes/${scope.id}/turns`), request(`/api/scopes/${scope.id}/changes`), contractsFor(scope.id)]);
    refreshPending();
  } catch (error) {
    if (!input.value) input.value = message; sizeComposer(); state.turns = state.turns.slice(0, -1);
    // A passage the engine refused is not offered again: the author selects it afresh.
    const refusedPassage = error.code === 'PASSAGE_STALE' || error.code === 'INVALID_PASSAGE';
    if (passage && !refusedPassage && state.scope?.id === scope.id) { state.passage = passage; renderPassageChip(); }
    state.notice = `Not sent: ${error.message}`;
  } finally {
    state.thinking = false; button.disabled = false;
    if (state.scope?.id === scope.id) renderTurns({ follow: true });
    renderEditorState();
  }
}

// Accepting writes the manuscript, refreshes the workspace from it, and typesets
// the scope again so the change is visible on the page.
async function decide(nodeId, decision) {
  const scope = state.scope; const changeSet = state.changeSet;
  // Only a text change rewrites the open piece; a layout change leaves its source alone.
  const touchesOpen = changeSet.changes.some((change) => change.kind !== 'set-layout' && change.status === 'pending' && change.nodeId === state.node.id && (!nodeId || nodeId === change.nodeId));
  if (decision === 'accept' && touchesOpen && state.sourceDirty && !confirm('Your unsaved edits to this page will be replaced by the accepted change. Continue?')) return;
  $('#turns').querySelectorAll('.changes button').forEach((button) => { button.disabled = true; });
  try {
    state.changeSet = await request(`/api/scopes/${scope.id}/changes/decide`, { method: 'POST', body: JSON.stringify({ changeSetId: changeSet.id, nodeId, decision }) });
    const accepted = state.changeSet.changes.some((change) => change.status === 'accepted' && (!nodeId || change.nodeId === nodeId));
    // Reload the open page only when its own change was written; a stale one leaves the author's text alone.
    const openAccepted = touchesOpen && state.changeSet.changes.some((change) => change.nodeId === state.node.id && change.status === 'accepted');
    state.graph = await request('/api/project/graph');
    if (state.changeSet.changes.some((change) => change.kind === 'set-layout' && change.status === 'accepted')) await refreshDesign();
    if (openAccepted) { state.node = await request(`/api/nodes/${state.node.id}`); state.sourceDirty = false; }
    [state.turns, state.contracts] = await Promise.all([request(`/api/scopes/${scope.id}/turns`), contractsFor(scope.id)]); state.notice = '';
    refreshPending();
    // renderNode reloads the editor, so it must not run over unsaved edits to an untouched page.
    if (state.sourceDirty) { renderNodes(); renderStatus(); } else renderNode();
    renderTurns();
    if (accepted) await build();
  } catch (error) { state.notice = error.message; renderTurns(); }
}

/**
 * Rolls back a contract's accepted change through the engine, which refuses if
 * what it changed has changed since. The workspace then reloads and typesets
 * the scope again, so the proof on screen matches what was restored.
 *
 * @param {string} contractId
 * @param {string | null} nodeId  The piece whose change is rolled back; `null` for a section's layout change.
 * @param {{ layout?: boolean }} [options]  `layout` when the change was to the publication profile.
 */
async function revert(contractId, nodeId, { layout = false } = {}) {
  // Rolling back a layout change restores the profile, not the open piece's text.
  const scope = state.scope; const touchesOpen = !layout && state.node?.id === nodeId;
  if (touchesOpen && state.sourceDirty && !confirm('Your unsaved edits to this page will be replaced by the restored text. Continue?')) return;
  $('#turns').querySelectorAll('.decision-revert').forEach((button) => { button.disabled = true; });
  try {
    await request(`/api/contracts/${contractId}/revert`, { method: 'POST', body: JSON.stringify({ nodeId }) });
    state.graph = await request('/api/project/graph');
    if (layout) await refreshDesign();
    // The author may open another conversation while any of these requests runs.
    // Each result is applied only if its conversation is still the one on screen.
    const stillOpen = () => state.scope?.id === scope.id;
    if (!stillOpen()) { renderNodes(); return; }
    const [node, turns, contracts] = await Promise.all([touchesOpen ? request(`/api/nodes/${nodeId}`) : null, request(`/api/scopes/${scope.id}/turns`), contractsFor(scope.id)]);
    if (!stillOpen()) { renderNodes(); return; }
    if (node) { state.node = node; state.sourceDirty = false; }
    state.turns = turns; state.contracts = contracts; state.notice = '';
    if (state.sourceDirty) { renderNodes(); renderStatus(); } else renderNode();
    renderTurns(); refreshPending();
    await build();
  } catch (error) { if (state.scope?.id === scope.id) { state.notice = error.message; renderTurns(); } }
}

async function uploadAttachments(files) {
  if (!files.length) return; $('#attachment-state').textContent = 'Uploading…';
  try {
    const attachments = await Promise.all(files.map(async (file) => ({ name: file.name, contentBase64: (await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onerror = reject; reader.onload = () => resolve(String(reader.result).split(',', 2)[1]); reader.readAsDataURL(file); })) })));
    await request('/api/project/attachments', { method: 'POST', body: JSON.stringify({ attachments }) }); state.attachments = await request('/api/project/attachments'); renderAttachments(); $('#attachment-state').textContent = '';
  } catch (error) { $('#attachment-state').textContent = error.message; } finally { $('#attachment-input').value = ''; }
}

async function approveAttachment(id) { try { await request(`/api/project/attachments/${id}/approve`, { method: 'POST', body: '{}' }); state.attachments = await request('/api/project/attachments'); renderAttachments(); } catch (error) { $('#attachment-state').textContent = error.message; } }

// Typesetting only reads the manuscript, so it needs no confirmation.
async function build({ wholeBook = false } = {}) {
  const scope = wholeBook ? scopeFor('book') : state.scope || scopeFor('book'); const plan = buildPlan(scope);
  const buttons = [$('#build'), $('#build-book')]; buttons.forEach((button) => { button.disabled = true; });
  (wholeBook ? $('#build-book') : $('#build')).textContent = 'Typesetting…';
  try {
    state.build = await request('/api/project/build', { method: 'POST', body: JSON.stringify({ scopeId: scope.id, mode: plan.mode }) });
    [state.pageMap, state.referenceMap] = await Promise.all([request('/api/project/page-map'), request('/api/project/reference-map')]);
    renderBuild(state.build); renderNodes(); renderNodePages(); renderLiveBuild(); refreshPreflight();
    // A successful proof is recorded on the contracts it typeset; show that beside the accepted change.
    // Re-render the thread only if a proof record changed, so a proof finishing does not
    // discard an answer the author is typing, and never into a conversation opened meanwhile.
    const shown = state.scope; const contracts = shown ? await contractsFor(shown.id) : null;
    if (contracts && state.scope?.id === shown.id && proofsOf(contracts) !== proofsOf(state.contracts)) { state.contracts = contracts; renderTurns(); }
  } catch (error) {
    $('#build-state').textContent = error.message; $('#build-log').textContent = 'Showing the previous proof.';
  } finally {
    buttons.forEach((button) => { button.disabled = false; });
    $('#build').textContent = buildPlan(state.scope || scopeFor('book')).label; $('#build-book').textContent = 'Whole book';
  }
}

async function sendLiveBuild() {
  const scope = state.scope || scopeFor('book');
  if (!proofIsCurrent()) return;
  if (!confirm(`Stage the proof for "${scope.title}" for the live build?`)) return;
  const button = $('#send-live-build'); button.disabled = true; button.textContent = 'Staging…';
  try { state.liveBuild = await request('/api/project/live-build', { method: 'POST', body: JSON.stringify({ scopeId: scope.id }) }); renderLiveBuild(); }
  catch (error) { $('#live-build-state').textContent = error.message; }
  finally { button.textContent = 'Send to live build'; renderLiveBuild(); }
}

async function refresh() {
  const priorScope = state.scope?.id || 'book';
  state.graph = await request('/api/project/refresh', { method: 'POST', body: '{}' }); renderNodes();
  const scope = scopeFor(priorScope) || scopeFor('book');
  if (scope?.anchorNodeId) await loadNode(scope.anchorNodeId, scope.id);
}

async function bootstrap() {
  if (!book) { location.replace('/frige/'); return; }
  const [graph, attachments, buildState, liveBuild, pageMap, referenceMap] = await Promise.all(['/api/project/graph', '/api/project/attachments', '/api/project/build', '/api/project/live-build', '/api/project/page-map', '/api/project/reference-map'].map((url) => request(url)));
  Object.assign(state, { graph, attachments, build: buildState, liveBuild, pageMap, referenceMap });
  const design = await request('/api/project/design');
  Object.assign(state, { design: design.design, designHash: design.hash, defaultDesignHash: design.defaultHash, trimSizes: design.trimSizes });
  $('#book-title').textContent = state.graph.book?.title || book.replaceAll('-', ' ');
  renderNodes(); renderAttachments();
  state.viewer = await createProofViewer($('#proof-viewer'), { describePage, onSelectPage: (number, nodeId) => loadNode(nodeId, nodeId) });
  // The address names the open scope; an unknown or retired one opens the whole book, and the address is corrected.
  const initial = scopeFor(new URLSearchParams(location.search).get('scope') || 'book') || scopeFor('book');
  if (initial?.anchorNodeId) await loadNode(initial.anchorNodeId, initial.id, { history: 'replace' });
  renderBuild(state.build); renderLiveBuild(); refreshPreflight(); refreshIgor(); refreshPending();
  addEventListener('popstate', () => { followHistory().catch((error) => { state.notice = error.message; renderTurns(); }); });
  // Navigator: filter by title or file; Enter opens the first match; Escape clears.
  $('#tree-filter').addEventListener('input', () => { state.filter = $('#tree-filter').value; renderNodes(); });
  $('#tree-filter').addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.filter) { event.preventDefault(); $('#tree-filter').value = ''; state.filter = ''; renderNodes(); }
    if (event.key === 'Enter') { event.preventDefault(); $('#book-tree .tree-piece')?.click(); }
  });
  $('#book-tree').addEventListener('keydown', treeKeys);
  // Editor: the position and the passage bar follow the selection; Ctrl or Cmd + S saves. No other key is taken from text editing.
  for (const type of ['select', 'keyup', 'mouseup', 'focus']) $('#source').addEventListener(type, renderEditorState);
  $('#source').addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 's') { event.preventDefault(); if (state.sourceDirty) saveSource(); }
  });
  $('#passage-bar').addEventListener('click', (event) => { const action = event.target.closest('button[data-action]')?.dataset.action; if (action) choosePassageAction(action); });
  $('#open-design').addEventListener('click', () => toggleDesign()); $('#design-cancel').addEventListener('click', () => toggleDesign(false)); $('#design-panel').addEventListener('submit', saveDesign); $('#design-panel').addEventListener('input', () => { state.designDirty = true; });
  $('#turn-form').addEventListener('submit', sendTurn);
  // Settings is a disclosure holding one link, to the shared Company screen
  // (/igor/team?app=frige, served by Igor); a click anywhere else closes it.
  document.addEventListener('click', (event) => { if (!$('#settings-menu').contains(event.target)) $('#settings-menu').open = false; });
  // Enter sends; Shift+Enter starts a new line; the box grows with its text.
  $('#message').addEventListener('keydown', (event) => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); sendTurn(); } });
  $('#message').addEventListener('input', sizeComposer);
  $('#show-thread').addEventListener('click', () => setView('thread')); $('#show-source').addEventListener('click', () => setView('source'));
  $('#save-source').addEventListener('click', saveSource); $('#build').addEventListener('click', () => build()); $('#build-book').addEventListener('click', () => build({ wholeBook: true }));
  $('#send-live-build').addEventListener('click', sendLiveBuild); $('#refresh').addEventListener('click', refresh);
  $('#attach').addEventListener('click', () => $('#attachment-input').click()); $('#attachment-input').addEventListener('change', () => uploadAttachments([...$('#attachment-input').files]));
  $('#source').addEventListener('input', () => {
    const first = !state.sourceDirty; state.sourceDirty = true; $('#save-state').textContent = 'Unsaved Markdown changes';
    renderLiveBuild(); renderStatus(); renderEditorState();
    // The tree marks the piece with unsaved edits; it is rebuilt only when that first becomes true.
    if (first) renderNodes();
  });
  $('#node-pages').addEventListener('click', () => { const mapped = nodePages(state.node.id); if (mapped) showPdfPage(mapped.firstPage); });
}

bootstrap().catch((error) => {
  // The server reads these files fresh from disk, so a server started before an update serves a page it cannot answer.
  const stale = error.message === 'Unknown API route.';
  document.querySelector('main').textContent = stale ? `Frige could not start: this page is newer than the Frige server at ${location.host}. Stop that server and start it again (corepack pnpm dev:frige), then reload.` : `Frige could not start: ${error.message}`;
});

// Global platform navigation must not discard an unsaved manuscript draft.
addEventListener('beforeunload', (event) => { if (state.sourceDirty) { event.preventDefault(); event.returnValue = ''; } });
