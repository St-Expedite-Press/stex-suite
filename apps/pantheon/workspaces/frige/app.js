import { createProofViewer } from './proof-viewer.js';
import { element, renderThread } from './thread.js';
import { createModelSettings } from './model-settings.js';
import { appUrl } from './base-path.js';

const $ = (selector) => document.querySelector(selector);
const book = new URLSearchParams(location.search).get('book');
const state = { drafts: new Map(), graph: null, node: null, scope: null, turns: [], changeSet: null, thinking: false, notice: '', view: 'thread', sourceDirty: false, pageMap: null, referenceMap: null, design: null, designHash: null, defaultDesignHash: null, trimSizes: [], preflight: null, attachments: [], build: null, liveBuild: null };
const apiUrl = (pathname) => `${appUrl(pathname)}${pathname.includes('?') ? '&' : '?'}book=${encodeURIComponent(book || '')}`;

async function request(url, options = {}) {
  const response = await fetch(apiUrl(url), { headers: { 'content-type': 'application/json', ...(options.headers || {}) }, ...options });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(payload.error || 'Request failed.'), { status: response.status, errors: Array.isArray(payload.errors) ? payload.errors : [] });
  return payload;
}

function scopes() {
  const fallback = { id: 'book', kind: 'book', title: book?.replaceAll('-', ' ') || 'Book', nodeIds: state.graph.readingOrder, anchorNodeId: state.graph.readingOrder[0], buildThroughNodeId: state.graph.readingOrder.at(-1), sections: [] };
  const canonical = state.graph.book || fallback;
  return [canonical, ...(canonical.sections || [])];
}
function scopeFor(id) {
  const found = scopes().find((scope) => scope.id === id);
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

function treeButton(className, title, pages, onClick, { active = false, detail = '', flagged = '' } = {}) {
  const button = element('button', `${className}${active ? ' active' : ''}`); button.type = 'button';
  button.append(element('span', 'tree-title', title));
  if (flagged) { const flag = element('span', 'tree-flag', '!'); flag.title = flagged; button.append(flag); }
  button.append(element('span', 'tree-pages', pages));
  button.title = detail || title;
  button.addEventListener('click', onClick);
  return button;
}

// One tree for the book: the whole book, its sections in table-of-contents order, and their pieces.
// Page numbers come from the latest verified book-order proof, or else from the proof on screen.
function renderNodes() {
  const graph = state.graph; const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const source = state.referenceMap || compiledMap();
  const pages = new Map((source?.nodes || []).filter((entry) => entry.firstPage).map((entry) => [entry.nodeId, entry]));
  const flags = new Map(); for (const entry of graph.diagnostics) flags.set(entry.nodePath, [...(flags.get(entry.nodePath) || []), entry.message]);
  const range = (ids) => {
    const entries = ids.map((id) => pages.get(id)).filter(Boolean); if (!entries.length) return '';
    const first = Math.min(...entries.map(bookFirst)); const last = Math.max(...entries.map(bookLast));
    return first === last ? `${first}` : `${first}–${last}`;
  };
  const open = state.scope?.kind === 'node' ? sectionOf(state.scope.id) : state.scope?.kind === 'book' ? null : state.scope;
  if (open) expanded.add(open.id);
  const piece = (node) => treeButton('tree-piece', node.title, range([node.id]), async () => { if (await loadNode(node.id, node.id) && nodePages(node.id)) showPdfPage(nodePages(node.id).firstPage); }, {
    active: state.scope?.id === node.id, detail: `manuscript/${node.relativePath}${node.changedOnDisk ? ' · changed on disk' : ''}`, flagged: (flags.get(node.relativePath) || []).join('\n'),
  });
  const group = (id, title, nodeIds, selectable) => {
    const isOpen = expanded.has(id); const wrap = element('div', `tree-section${isOpen ? ' open' : ''}`); const row = element('div', 'tree-row');
    const toggle = element('button', 'tree-toggle', isOpen ? '▾' : '▸'); toggle.type = 'button';
    toggle.setAttribute('aria-expanded', String(isOpen)); toggle.setAttribute('aria-label', `${isOpen ? 'Collapse' : 'Expand'} ${title}`);
    toggle.addEventListener('click', () => { if (isOpen) expanded.delete(id); else expanded.add(id); renderNodes(); });
    row.append(toggle, selectable ? treeButton('tree-section-title', title, range(nodeIds), () => selectScope(id), { active: state.scope?.id === id }) : element('span', 'tree-section-title tree-static', title));
    wrap.append(row);
    if (isOpen) { const children = element('div', 'tree-children'); children.append(...nodeIds.map((nodeId) => byId.get(nodeId)).filter(Boolean).map(piece)); wrap.append(children); }
    return wrap;
  };
  const unlisted = graph.nodes.filter((node) => !graph.readingOrder.includes(node.id) && node.kind !== 'programme').map((node) => node.id);
  const bookPages = source?.targetScope?.id === 'book' ? `${source.pagination.physicalPageCount} pp.` : '';
  $('#book-tree').replaceChildren(
    treeButton('tree-book', 'Whole book', bookPages, () => selectScope('book'), { active: state.scope?.kind === 'book', detail: 'The whole book, in table-of-contents order' }),
    ...(graph.book?.sections || []).map((section) => group(section.id, section.title, section.nodeIds, true)),
    ...(unlisted.length ? [group('unlisted', 'Not in the table of contents', unlisted, false)] : []),
  );
  const count = graph.diagnostics.length;
  $('#diagnostics').textContent = count ? `${count} review flag${count === 1 ? '' : 's'}` : 'No review flags';
  $('#diagnostics').title = graph.diagnostics.map((entry) => `${entry.nodePath}: ${entry.message}`).join('\n');
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
    turns: state.turns || [], thinking: state.thinking, notice: state.notice, changeSet: state.changeSet, drafts: state.drafts, onDecide: decide, onAnswer: sendAnswer,
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
  renderNodes(); renderLiveBuild(); renderNodePages(); renderStatus();
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
  return Boolean(state.build?.ok && state.build.targetScope?.id === state.scope?.id && compiledMap()?.mode !== 'isolated' && !state.sourceDirty && staleness && !isStale(staleness) && compiledMap()?.pagination.verified);
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
function fillDesign() {
  const form = $('#design-panel'); const design = state.design;
  designField(form, 'trimSize').replaceChildren(...state.trimSizes.map((size) => new Option(size, size)));
  for (const name of ['trimSize', 'bodyFont', 'fontSize', 'leading', 'headTitle']) designField(form, name).value = design[name];
  for (const side of ['top', 'bottom', 'inner', 'outer']) designField(form, `margins.${side}`).value = design.margins[side];
  for (const name of ['runningHeads', 'folios', 'rectoOpeners']) designField(form, name).checked = design[name];
}
function readDesign() {
  const form = $('#design-panel');
  return {
    ...Object.fromEntries(['trimSize', 'bodyFont', 'fontSize', 'leading', 'headTitle'].map((name) => [name, designField(form, name).value.trim()])),
    margins: Object.fromEntries(['top', 'bottom', 'inner', 'outer'].map((side) => [side, designField(form, `margins.${side}`).value.trim()])),
    ...Object.fromEntries(['runningHeads', 'folios', 'rectoOpeners'].map((name) => [name, designField(form, name).checked])),
  };
}
function toggleDesign(open = $('#design-panel').classList.contains('hidden')) {
  if (open) { fillDesign(); $('#design-state').textContent = ''; }
  $('#design-panel').classList.toggle('hidden', !open); $('#open-design').setAttribute('aria-expanded', String(open));
}
async function saveDesign(event) {
  event.preventDefault();
  try {
    const saved = await request('/api/project/design', { method: 'PUT', body: JSON.stringify(readDesign()) });
    state.design = saved.design; state.designHash = saved.hash; fillDesign();
    $('#design-state').textContent = 'Saved.';
    renderStatus(); renderLiveBuild(); refreshPreflight();
  } catch (error) { $('#design-state').textContent = error.message; }
}

function renderLiveBuild() {
  const button = $('#send-live-build');
  if (!button) return;
  const matchingHandoff = state.liveBuild?.targetScope?.id === state.scope?.id ? state.liveBuild : null;
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

async function loadNode(id, scopeId = id) {
  if (state.sourceDirty && state.node?.id !== id && !confirm('Discard unsaved Markdown changes?')) return false;
  const scope = scopeFor(scopeId) || scopeFor(id);
  const [node, turns, changeSet] = await Promise.all([request(`/api/nodes/${id}`), request(`/api/scopes/${scope.id}/turns`), request(`/api/scopes/${scope.id}/changes`)]);
  const changedScope = state.scope?.id !== scope.id;
  state.node = node; state.scope = scope; state.turns = turns; state.changeSet = changeSet; state.sourceDirty = false;
  if (changedScope) state.notice = '';
  renderNode(); renderTurns(); if (changedScope) $('#turns').scrollTop = $('#turns').scrollHeight;
  return true;
}

async function selectScope(scopeId) {
  const scope = scopeFor(scopeId);
  if (!scope?.anchorNodeId) return;
  await loadNode(scope.anchorNodeId, scope.id);
}

async function saveSource() {
  const button = $('#save-source'); button.disabled = true;
  try { state.node = await request(`/api/nodes/${state.node.id}`, { method: 'PUT', body: JSON.stringify({ source: $('#source').value, baseHash: state.node.hash }) }); state.graph = await request('/api/project/graph'); state.sourceDirty = false; state.build = null; renderNode(); renderBuild(null); }
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
    state.thinking = false;
    if (state.scope?.id === scope.id) renderTurns({ follow: true });
  }
}

async function sendTurn(event) {
  event?.preventDefault();
  const input = $('#message'); const button = $('#turn-form [type="submit"]'); const message = input.value.trim();
  if (!message || !state.scope || state.thinking) return;
  const scope = state.scope; button.disabled = true; input.value = ''; sizeComposer(); setView('thread');
  state.turns = [...state.turns, { role: 'user', message, at: new Date().toISOString() }]; state.thinking = true; state.notice = ''; renderTurns({ follow: true });
  try {
    const result = await request(`/api/scopes/${scope.id}/turn`, { method: 'POST', body: JSON.stringify({ message }) });
    if (result.availability !== 'available') refreshIgor();
    if (state.scope?.id !== scope.id) return;
    [state.turns, state.changeSet] = await Promise.all([request(`/api/scopes/${scope.id}/turns`), request(`/api/scopes/${scope.id}/changes`)]);
  } catch (error) {
    if (!input.value) input.value = message; sizeComposer(); state.turns = state.turns.slice(0, -1); state.notice = `Not sent: ${error.message}`;
  } finally {
    state.thinking = false; button.disabled = false;
    if (state.scope?.id === scope.id) renderTurns({ follow: true });
  }
}

// Accepting writes the manuscript, refreshes the workspace from it, and typesets
// the scope again so the change is visible on the page.
async function decide(nodeId, decision) {
  const scope = state.scope; const changeSet = state.changeSet;
  const touchesOpen = changeSet.changes.some((change) => change.status === 'pending' && change.nodeId === state.node.id && (!nodeId || nodeId === change.nodeId));
  if (decision === 'accept' && touchesOpen && state.sourceDirty && !confirm('Your unsaved edits to this page will be replaced by the accepted change. Continue?')) return;
  $('#turns').querySelectorAll('.changes button').forEach((button) => { button.disabled = true; });
  try {
    state.changeSet = await request(`/api/scopes/${scope.id}/changes/decide`, { method: 'POST', body: JSON.stringify({ changeSetId: changeSet.id, nodeId, decision }) });
    const accepted = state.changeSet.changes.some((change) => change.status === 'accepted' && (!nodeId || change.nodeId === nodeId));
    // Reload the open page only when its own change was written; a stale one leaves the author's text alone.
    const openAccepted = touchesOpen && state.changeSet.changes.some((change) => change.nodeId === state.node.id && change.status === 'accepted');
    state.graph = await request('/api/project/graph');
    if (openAccepted) { state.node = await request(`/api/nodes/${state.node.id}`); state.sourceDirty = false; }
    state.turns = await request(`/api/scopes/${scope.id}/turns`); state.notice = '';
    // renderNode reloads the editor, so it must not run over unsaved edits to an untouched page.
    if (state.sourceDirty) { renderNodes(); renderStatus(); } else renderNode();
    renderTurns();
    if (accepted) await build();
  } catch (error) { state.notice = error.message; renderTurns(); }
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
  const initial = scopeFor('book');
  if (initial?.anchorNodeId) await loadNode(initial.anchorNodeId, initial.id);
  renderBuild(state.build); renderLiveBuild(); refreshPreflight(); refreshIgor();
  $('#open-design').addEventListener('click', () => toggleDesign()); $('#design-cancel').addEventListener('click', () => toggleDesign(false)); $('#design-panel').addEventListener('submit', saveDesign);
  $('#turn-form').addEventListener('submit', sendTurn);
  const modelSettings = createModelSettings({ request, onSaved: refreshIgor });
  $('#configure-models').addEventListener('click', () => { $('#settings-menu').open = false; modelSettings.open(); });
  document.addEventListener('click', (event) => { if (!$('#settings-menu').contains(event.target)) $('#settings-menu').open = false; });
  // Enter sends; Shift+Enter starts a new line; the box grows with its text.
  $('#message').addEventListener('keydown', (event) => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); sendTurn(); } });
  $('#message').addEventListener('input', sizeComposer);
  $('#show-thread').addEventListener('click', () => setView('thread')); $('#show-source').addEventListener('click', () => setView('source'));
  $('#save-source').addEventListener('click', saveSource); $('#build').addEventListener('click', () => build()); $('#build-book').addEventListener('click', () => build({ wholeBook: true }));
  $('#send-live-build').addEventListener('click', sendLiveBuild); $('#refresh').addEventListener('click', refresh);
  $('#attach').addEventListener('click', () => $('#attachment-input').click()); $('#attachment-input').addEventListener('change', () => uploadAttachments([...$('#attachment-input').files]));
  $('#source').addEventListener('input', () => { state.sourceDirty = true; $('#save-state').textContent = 'Unsaved Markdown changes'; renderLiveBuild(); renderStatus(); });
  $('#node-pages').addEventListener('click', () => { const mapped = nodePages(state.node.id); if (mapped) showPdfPage(mapped.firstPage); });
}

bootstrap().catch((error) => {
  // The server reads these files fresh from disk, so a server started before an update serves a page it cannot answer.
  const stale = error.message === 'Unknown API route.';
  document.querySelector('main').textContent = stale ? `Frige could not start: this page is newer than the Frige server at ${location.host}. Stop that server and start it again (corepack pnpm dev:frige), then reload.` : `Frige could not start: ${error.message}`;
});

// Global platform navigation must not discard an unsaved manuscript draft.
addEventListener('beforeunload', (event) => { if (state.sourceDirty) { event.preventDefault(); event.returnValue = ''; } });
