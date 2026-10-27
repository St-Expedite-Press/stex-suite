import { startScreenlabPalette } from './palette.js';
startScreenlabPalette();
const state = { book: null, page: null, proposal: null, sourceDirty: false };
const $ = (selector) => document.querySelector(selector);
const project = new URLSearchParams(window.location.search).get('project');
const apiUrl = (pathname) => project ? `${pathname}${pathname.includes('?') ? '&' : '?'}project=${encodeURIComponent(project)}` : pathname;

async function request(url, options = {}) {
  const response = await fetch(apiUrl(url), { headers: { 'content-type': 'application/json', ...(options.headers || {}) }, ...options });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Request failed.');
  return payload;
}

function safeText(value) { return String(value || ''); }

function renderPages() {
  $('#page-list').replaceChildren(...state.book.pages.map((page, index) => {
    const button = document.createElement('button');
    button.className = `page-button ${page.id === state.page?.id ? 'active' : ''}`;
    button.innerHTML = `<span class="page-number">${String(index + 1).padStart(2, '0')}</span><span>${page.title}</span>`;
    button.addEventListener('click', () => loadPage(page.id));
    return button;
  }));
}

function renderTurns(turns) {
  const container = $('#turns');
  container.replaceChildren(...turns.map((turn) => {
    const node = $('#turn-template').content.firstElementChild.cloneNode(true);
    node.classList.add(turn.role || 'system');
    node.querySelector('.turn-role').textContent = turn.role === 'assistant' ? 'TexGraph' : turn.role === 'user' ? 'You' : 'Studio';
    node.querySelector('.turn-text').textContent = turn.message || turn.commentary || (turn.kind === 'proposal-accepted' ? 'Accepted the proposed revision.' : '');
    return node;
  }));
  container.scrollTop = container.scrollHeight;
}

function renderProposal() {
  const container = $('#proposal');
  const proposal = state.proposal;
  if (!proposal || proposal.status !== 'pending') { container.classList.add('hidden'); container.replaceChildren(); return; }
  container.classList.remove('hidden');
  container.innerHTML = `<h3>Proposed page revision</h3><p></p><pre></pre><div class="proposal-actions"><button class="accept">Accept revision</button><button class="reject">Reject</button></div>`;
  container.querySelector('p').textContent = proposal.commentary || 'Review the proposed source before accepting.';
  container.querySelector('pre').textContent = proposal.source;
  container.querySelector('.accept').addEventListener('click', acceptProposal);
  container.querySelector('.reject').addEventListener('click', rejectProposal);
}

function renderPage() {
  $('#conversation-title').textContent = state.page.title;
  $('#preview-title').textContent = state.page.title;
  $('#source').value = state.page.source;
  $('#source-hash').textContent = state.page.hash.slice(0, 12);
  $('#save-state').textContent = 'Saved source';
  renderPages();
}

function renderBuild(build) {
  const ready = build?.ok === true;
  $('#build-state').textContent = ready ? `Built ${new Date(build.completedAt).toLocaleTimeString()}` : build?.error || 'Not built';
  $('#build-log').textContent = build?.log || 'The last successful preview is kept if a newer build fails.';
  if (ready || build?.lastSuccessful) {
    $('#pdf').src = apiUrl(`/api/pages/${state.page.id}/preview?at=${Date.now()}`);
    $('#pdf').classList.remove('hidden');
    $('#empty-preview').classList.add('hidden');
  } else {
    $('#pdf').removeAttribute('src');
    $('#pdf').classList.add('hidden');
    $('#empty-preview').classList.remove('hidden');
  }
}

async function loadPage(id) {
  if (state.sourceDirty && state.page?.id !== id && !window.confirm('Discard unsaved source changes for this page?')) return;
  const [page, turns, proposal, build] = await Promise.all([
    request(`/api/pages/${id}`), request(`/api/pages/${id}/turns`), request(`/api/pages/${id}/proposal`), request(`/api/pages/${id}/build`),
  ]);
  state.page = page; state.proposal = proposal;
  state.sourceDirty = false;
  renderPage(); renderTurns(turns); renderProposal(); renderBuild(build);
}

async function saveSource() {
  const button = $('#save-source');
  button.disabled = true;
  try {
    state.page = await request(`/api/pages/${state.page.id}`, { method: 'PUT', body: JSON.stringify({ source: $('#source').value, baseHash: state.page.hash }) });
    $('#source-hash').textContent = state.page.hash.slice(0, 12);
    $('#save-state').textContent = 'Saved just now';
    state.sourceDirty = false;
  } catch (error) { $('#save-state').textContent = error.message; }
  finally { button.disabled = false; }
}

async function sendTurn(event) {
  event.preventDefault();
  const input = $('#message'); const button = $('#turn-form button'); const message = input.value.trim();
  if (!message) return;
  button.disabled = true;
  try {
    const result = await request(`/api/pages/${state.page.id}/turn`, { method: 'POST', body: JSON.stringify({ message }) });
    input.value = '';
    state.proposal = result.proposal;
    const turns = await request(`/api/pages/${state.page.id}/turns`);
    renderTurns(turns); renderProposal();
    const pill = $('#gateway-state'); pill.textContent = result.availability === 'available' ? 'Gateway connected' : 'Gateway unavailable'; pill.className = `status-pill ${result.availability === 'available' ? 'available' : 'unavailable'}`;
  } catch (error) { $('#save-state').textContent = error.message; }
  finally { button.disabled = false; }
}

async function acceptProposal() {
  try {
    state.page = await request(`/api/pages/${state.page.id}/proposal/accept`, { method: 'POST', body: JSON.stringify({ proposalId: state.proposal.id }) });
    state.proposal = null; renderPage(); renderProposal(); renderTurns(await request(`/api/pages/${state.page.id}/turns`));
  } catch (error) { $('#save-state').textContent = error.message; }
}

async function rejectProposal() {
  try { await request(`/api/pages/${state.page.id}/proposal/reject`, { method: 'POST', body: JSON.stringify({ proposalId: state.proposal.id }) }); state.proposal = null; renderProposal(); }
  catch (error) { $('#save-state').textContent = error.message; }
}

async function build() {
  if (!window.confirm(`Build “${state.page.title}” with LuaLaTeX? This uses the saved local source and does not contact a model.`)) return;
  const button = $('#build'); button.disabled = true; button.textContent = 'Building…';
  try { renderBuild(await request(`/api/pages/${state.page.id}/build`, { method: 'POST', body: '{}' })); }
  catch (error) { $('#build-state').textContent = error.message; $('#build-log').textContent = 'The previous PDF preview, if any, remains available.'; }
  finally { button.disabled = false; button.textContent = 'Build preview'; }
}

async function createPage() {
  const title = window.prompt('Title for the new page');
  if (title === null) return;
  try {
    const page = await request('/api/pages', { method: 'POST', body: JSON.stringify({ title }) });
    state.book = await request('/api/book');
    await loadPage(page.id);
  } catch (error) { $('#save-state').textContent = error.message; }
}

async function bootstrap() {
  state.book = await request('/api/book');
  $('#book-title').textContent = safeText(state.book.title);
  $('#book-author').textContent = safeText(state.book.author);
  await loadPage(state.book.pages[0].id);
  $('#turn-form').addEventListener('submit', sendTurn);
  $('#save-source').addEventListener('click', saveSource);
  $('#build').addEventListener('click', build);
  $('#new-page').addEventListener('click', createPage);
  $('#source').addEventListener('input', () => { state.sourceDirty = true; $('#save-state').textContent = 'Unsaved source changes'; });
}

bootstrap().catch((error) => { document.body.textContent = `TexGraph could not start: ${error.message}`; });
