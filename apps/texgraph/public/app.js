import { startScreenlabPalette } from './palette.js';

startScreenlabPalette();

const $ = (selector) => document.querySelector(selector);
const book = new URLSearchParams(location.search).get('book');
const state = { graph: null, node: null, scope: null, proposal: null, sourceDirty: false, pageMap: null, attachments: [] };
const apiUrl = (pathname) => `${pathname}${pathname.includes('?') ? '&' : '?'}book=${encodeURIComponent(book || '')}`;

async function request(url, options = {}) {
  const response = await fetch(apiUrl(url), { headers: { 'content-type': 'application/json', ...(options.headers || {}) }, ...options });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Request failed.');
  return payload;
}

const label = (node) => `${node.kind.replaceAll('-', ' ')} · ${node.title}`;
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
function scopeLabel(scope) { return scope.kind === 'book' ? 'Whole book' : scope.kind === 'node' ? `Page · ${scope.title}` : `${scope.kind.replaceAll('-', ' ')} · ${scope.title}`; }

function renderScopes() {
  const list = $('#scope-list');
  list.replaceChildren(...scopes().map((scope) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `scope-button ${scope.id === state.scope?.id ? 'active' : ''} ${scope.kind}`;
    button.textContent = scopeLabel(scope);
    button.title = `Work with ${scope.title}; builds parse the book through its final node.`;
    button.addEventListener('click', () => selectScope(scope.id));
    return button;
  }));
}

function renderNodes() {
  const order = state.graph.readingOrder;
  const byId = new Map(state.graph.nodes.map((node) => [node.id, node]));
  const extra = state.graph.nodes.filter((node) => !order.includes(node.id) && node.kind !== 'programme');
  $('#node-list').replaceChildren(...[...order.map((id) => byId.get(id)), ...extra].filter(Boolean).map((node, index) => {
    const button = document.createElement('button');
    button.className = `page-button ${node.id === state.node?.id ? 'active' : ''}`;
    button.title = node.relativePath;
    button.innerHTML = `<span class="page-number">${String(index + 1).padStart(2, '0')}</span><span>${label(node)}${node.changedOnDisk ? ' · changed' : ''}</span>`;
    button.addEventListener('click', () => loadNode(node.id, node.id));
    return button;
  }));
  const count = state.graph.diagnostics.length;
  $('#diagnostics').textContent = count ? `${count} review flags` : 'Graph healthy';
  renderScopes();
}

function renderTurns(turns) {
  const box = $('#turns');
  box.replaceChildren(...turns.map((turn) => {
    const item = $('#turn-template').content.firstElementChild.cloneNode(true);
    item.classList.add(turn.role || 'system');
    item.querySelector('.turn-role').textContent = turn.role === 'assistant' ? 'Hermes' : turn.role === 'user' ? 'You' : 'Vault';
    item.querySelector('.turn-text').textContent = turn.message || turn.commentary || (turn.kind === 'proposal-accepted' ? 'Accepted the proposed Markdown revision.' : '');
    return item;
  }));
  box.scrollTop = box.scrollHeight;
}

function renderProposal() {
  const box = $('#proposal'); const proposal = state.proposal;
  if (!proposal || proposal.status !== 'pending') { box.classList.add('hidden'); box.replaceChildren(); return; }
  box.classList.remove('hidden');
  box.innerHTML = '<h3>Proposed Markdown revision</h3><p></p><pre></pre><div class="proposal-actions"><button class="accept">Accept revision</button><button class="reject">Reject</button></div>';
  box.querySelector('p').textContent = proposal.commentary || 'Review this complete node replacement before accepting.';
  box.querySelector('pre').textContent = proposal.source;
  box.querySelector('.accept').addEventListener('click', acceptProposal);
  box.querySelector('.reject').addEventListener('click', rejectProposal);
}

function renderAttachments() {
  const box = $('#attachments');
  box.replaceChildren(...state.attachments.map((attachment) => {
    const item = document.createElement('span'); item.className = `attachment ${attachment.contextState}`; item.textContent = attachment.name;
    if (attachment.contextState === 'pending-review') {
      const approve = document.createElement('button'); approve.type = 'button'; approve.className = 'quiet-button'; approve.textContent = 'Use in chat'; approve.addEventListener('click', () => approveAttachment(attachment.id)); item.append(' ', approve);
    } else { const stateText = document.createElement('small'); stateText.textContent = attachment.contextState === 'approved' ? ' attached' : ' extracting'; item.append(stateText); }
    return item;
  }));
}

function renderWorkspace() {
  const scope = state.scope || scopeFor(state.node.id);
  const nodesById = new Map(state.graph.nodes.map((node) => [node.id, node]));
  const list = $('#workspace-items');
  const isBook = scope.kind === 'book';
  const entries = isBook ? (state.graph.book?.sections || []) : scope.nodeIds.map((id) => nodesById.get(id)).filter(Boolean);
  $('#workspace-kind').textContent = isBook ? 'Canonical book representation' : scope.kind === 'node' ? 'Selected manuscript page' : 'Selected book section';
  $('#workspace-count').textContent = isBook ? `${entries.length} sections` : `${entries.length} Programme node${entries.length === 1 ? '' : 's'}`;
  const cutoff = nodesById.get(scope.buildThroughNodeId);
  $('#workspace-boundary').textContent = cutoff ? `Preview boundary: the book’s preamble through “${cutoff.title}.”` : 'Preview boundary: the complete Programme.';
  list.replaceChildren(...entries.map((entry) => {
    const isSection = isBook;
    const item = document.createElement('button'); item.type = 'button'; item.className = 'workspace-item';
    item.innerHTML = `<span>${isSection ? entry.kind.replaceAll('-', ' ') : entry.kind}</span><strong>${entry.title}</strong>`;
    item.addEventListener('click', () => isSection ? selectScope(entry.id) : loadNode(entry.id, entry.id));
    return item;
  }));
}

function renderNode() {
  const scope = state.scope || scopeFor(state.node.id);
  $('#conversation-context').textContent = `Conversation · ${scope.kind === 'book' ? 'whole book' : scope.kind === 'node' ? 'selected page' : 'selected section'}`;
  $('#conversation-title').textContent = scope.title;
  $('#source').value = state.node.source;
  $('#source-label').textContent = scope.kind === 'book' ? 'Canonical Programme Markdown' : scope.kind === 'node' ? 'Canonical Markdown' : 'Section anchor Markdown';
  $('#source-hash').textContent = state.node.hash.slice(0, 12);
  $('#save-state').textContent = `manuscript/${state.node.relativePath}`;
  const cutoff = state.graph.nodes.find((node) => node.id === scope.buildThroughNodeId);
  $('#build-description').textContent = cutoff ? `Build parses the canonical book from its preamble through “${cutoff.title}.”` : 'Build parses the complete Programme-ordered book.';
  renderWorkspace(); renderNodes(); renderPages();
}

function renderPages() {
  const pages = state.pageMap?.pages || [];
  $('#printed-pages').replaceChildren(...pages.map((page) => {
    const button = document.createElement('button');
    button.className = `page-button ${page.nodeIds.includes(state.node?.id) ? 'active' : ''}`;
    button.textContent = `p. ${page.logicalPage} · ${page.kind}`;
    button.addEventListener('click', () => loadNode(page.nodeIds[0], page.nodeIds[0]));
    return button;
  }));
}

function renderBuild(build) {
  const ready = build?.ok === true;
  const target = build?.targetScope?.title;
  $('#build-state').textContent = ready ? `Built ${target ? `through ${target}` : new Date(build.completedAt).toLocaleTimeString()}` : build?.error || 'Not built';
  $('#build-log').textContent = build?.log || 'The last successful preview is kept if a newer build fails.';
  if (ready || build?.lastSuccessful) { $('#pdf').src = apiUrl(`/api/project/preview&at=${Date.now()}`); $('#pdf').classList.remove('hidden'); $('#empty-preview').classList.add('hidden'); }
}

async function loadNode(id, scopeId = id) {
  if (state.sourceDirty && state.node?.id !== id && !confirm('Discard unsaved Markdown changes?')) return;
  const [node, turns, proposal] = await Promise.all([request(`/api/nodes/${id}`), request(`/api/nodes/${id}/turns`), request(`/api/nodes/${id}/proposal`)]);
  state.node = node; state.scope = scopeFor(scopeId) || scopeFor(id); state.proposal = proposal; state.sourceDirty = false;
  renderNode(); renderTurns(turns); renderProposal();
}

async function selectScope(scopeId) {
  const scope = scopeFor(scopeId);
  if (!scope?.anchorNodeId) return;
  await loadNode(scope.anchorNodeId, scope.id);
}

async function saveSource() {
  const button = $('#save-source'); button.disabled = true;
  try { state.node = await request(`/api/nodes/${state.node.id}`, { method: 'PUT', body: JSON.stringify({ source: $('#source').value, baseHash: state.node.hash }) }); state.graph = await request('/api/project/graph'); state.sourceDirty = false; renderNode(); }
  catch (error) { $('#save-state').textContent = error.message; } finally { button.disabled = false; }
}

async function sendTurn(event) {
  event.preventDefault();
  const input = $('#message'); const button = $('#turn-form [type="submit"]'); const message = input.value.trim();
  if (!message || !state.node) return;
  button.disabled = true;
  try {
    const result = await request(`/api/nodes/${state.node.id}/turn`, { method: 'POST', body: JSON.stringify({ message, scopeId: state.scope?.id || state.node.id }) });
    input.value = ''; state.proposal = result.proposal;
    renderTurns(await request(`/api/nodes/${state.node.id}/turns`)); renderProposal();
    const pill = $('#gateway-state'); pill.textContent = result.availability === 'available' ? 'Hermes connected' : 'Hermes unavailable'; pill.className = `status-pill ${result.availability === 'available' ? 'available' : 'unavailable'}`;
  } catch (error) { $('#save-state').textContent = error.message; } finally { button.disabled = false; }
}

async function uploadAttachments(files) {
  if (!files.length) return; $('#attachment-state').textContent = 'Uploading…';
  try {
    const attachments = await Promise.all(files.map(async (file) => ({ name: file.name, contentBase64: (await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onerror = reject; reader.onload = () => resolve(String(reader.result).split(',', 2)[1]); reader.readAsDataURL(file); })) })));
    await request('/api/project/attachments', { method: 'POST', body: JSON.stringify({ attachments }) }); state.attachments = await request('/api/project/attachments'); renderAttachments(); $('#attachment-state').textContent = '';
  } catch (error) { $('#attachment-state').textContent = error.message; } finally { $('#attachment-input').value = ''; }
}

async function approveAttachment(id) { try { await request(`/api/project/attachments/${id}/approve`, { method: 'POST', body: '{}' }); state.attachments = await request('/api/project/attachments'); renderAttachments(); } catch (error) { $('#attachment-state').textContent = error.message; } }
async function acceptProposal() { try { state.node = await request(`/api/nodes/${state.node.id}/proposal/accept`, { method: 'POST', body: JSON.stringify({ proposalId: state.proposal.id }) }); state.graph = await request('/api/project/graph'); state.proposal = null; renderNode(); renderProposal(); renderTurns(await request(`/api/nodes/${state.node.id}/turns`)); } catch (error) { $('#save-state').textContent = error.message; } }
async function rejectProposal() { try { await request(`/api/nodes/${state.node.id}/proposal/reject`, { method: 'POST', body: JSON.stringify({ proposalId: state.proposal.id }) }); state.proposal = null; renderProposal(); } catch (error) { $('#save-state').textContent = error.message; } }

async function build() {
  const scope = state.scope || scopeFor('book');
  if (!confirm(`Build the canonical book through “${scope.title}”? The preamble and every preceding Programme node will be included.`)) return;
  const button = $('#build'); button.disabled = true; button.textContent = 'Building…';
  try { renderBuild(await request('/api/project/build', { method: 'POST', body: JSON.stringify({ scopeId: scope.id }) })); state.pageMap = await request('/api/project/page-map'); renderPages(); }
  catch (error) { $('#build-state').textContent = error.message; $('#build-log').textContent = 'The previous PDF preview, if any, remains available.'; }
  finally { button.disabled = false; button.textContent = 'Build preview'; }
}

async function refresh() {
  const priorScope = state.scope?.id || 'book';
  state.graph = await request('/api/project/refresh'); renderNodes();
  const scope = scopeFor(priorScope) || scopeFor('book');
  if (scope?.anchorNodeId) await loadNode(scope.anchorNodeId, scope.id);
}

async function bootstrap() {
  if (!book) { location.replace('http://127.0.0.1:4300/texgraph/'); return; }
  state.graph = await request('/api/project/graph'); state.attachments = await request('/api/project/attachments');
  $('#book-title').textContent = state.graph.book?.title || book.replaceAll('-', ' ');
  state.pageMap = await request('/api/project/page-map'); renderNodes(); renderAttachments();
  const initial = scopeFor('book');
  if (initial?.anchorNodeId) await loadNode(initial.anchorNodeId, initial.id);
  renderBuild(await request('/api/project/build'));
  $('#turn-form').addEventListener('submit', sendTurn); $('#save-source').addEventListener('click', saveSource); $('#build').addEventListener('click', build); $('#refresh').addEventListener('click', refresh); $('#attach').addEventListener('click', () => $('#attachment-input').click()); $('#attachment-input').addEventListener('change', () => uploadAttachments([...$('#attachment-input').files])); $('#source').addEventListener('input', () => { state.sourceDirty = true; $('#save-state').textContent = 'Unsaved Markdown changes'; });
}

bootstrap().catch((error) => { document.body.textContent = `TexGraph could not start: ${error.message}`; });
