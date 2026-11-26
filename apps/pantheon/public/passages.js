/**
 * Pantheon passage reader: search author-approved Frige excerpts, open an exact
 * citation, approve that passage revision for Igor (privately), withdraw it,
 * and start an Igor conversation that cites it by reference.
 *
 * Data: /api/knowledge/v1/passages/* and /contributions (platform knowledge,
 * stex.knowledge.contributions.v1). Text is fetched from Frige through the
 * platform on every open and never stored by this page or the journal.
 * On the native path, where those routes do not exist, the section says so.
 */
const container = document.querySelector('#passages-content');
let busy = false; let mine = null; let hits = []; let open = null;
// Focus is moved after the busy guard lifts: an inert container cannot take focus.
let focusNext = null;
/** Creates an element with optional text and class. */
const node = (tag, text, className) => { const value = document.createElement(tag); if (text !== undefined) value.textContent = text; if (className) value.className = className; return value; };
/** A secondary button running an action through the shared busy guard. */
function button(text, action) { const value = node('button', text, 'stex-button stex-button--secondary'); value.type = 'button'; value.addEventListener('click', () => run(action)); return value; }
/** Calls the knowledge API and throws its message on failure. */
async function api(route, body) {
  const response = await fetch('/api/knowledge/v1' + route, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(30000), ...(body ? { body: JSON.stringify(body) } : {}) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(Error(result.error || 'Passages are unavailable.'), { status: response.status });
  return result;
}
const status = node('p', '', 'passages-status'); status.setAttribute('role', 'status');
/** Runs one user action at a time and reports failures in the status line. */
async function run(action) {
  if (busy) return; busy = true; container.inert = true;
  try { await action(); } catch (error) { status.textContent = error.message; }
  finally { busy = false; container.inert = false; if (focusNext) { container.querySelector(focusNext)?.focus(); focusNext = null; } }
}
/** The citation as query parameters for /passages/read. */
const citationQuery = (c) => new URLSearchParams({ project: c.project, attachment: c.attachmentId, excerpt: c.excerptHash, start: String(c.start), end: String(c.end), passage: c.passageSha256 }).toString();
/** The citation body for /contributions. */
const citationOf = (c) => ({ project: c.project, attachmentId: c.attachmentId, excerptHash: c.excerptHash, start: c.start, end: c.end, passageSha256: c.passageSha256 });

/** Fields shown for every citation, in reading order. */
function citationList(c) {
  const list = node('dl', undefined, 'passage-citation');
  for (const [term, value] of [['Document', c.title], ['Project', c.project], ['Original file SHA-256', c.originalSha256 || 'not recorded'], ['Approved excerpt', c.excerptHash], ['Bytes', `${c.start}–${c.end}`], ['Passage SHA-256', c.passageSha256]]) list.append(node('dt', term), node('dd', value));
  return list;
}

/** Opens a citation: Frige re-verifies it and returns the exact text. */
async function openCitation(c) {
  const result = await api('/passages/read?' + citationQuery(c));
  open = result.passage; render();
  focusNext = '.passage-reader h3';
}

/** Starts a fresh Igor conversation that names the contribution by reference only. */
async function useInIgor(reference) {
  const response = await fetch('/igor/api/conversations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idempotencyKey: crypto.randomUUID(), knowledge: [reference] }) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw Error(result.error || 'Igor is unavailable.');
  if (!/^\/igor\/c\/[a-z0-9]{12}$/.test(result.route || '')) throw Error('Igor returned an invalid conversation route.');
  location.assign(result.route);
}

function render() {
  container.replaceChildren();
  const heading = node('h2', 'Passages from approved documents'); container.append(heading);
  if (mine === null) { container.append(node('p', 'Passage search needs the platform knowledge service, which this workspace does not use.')); return; }
  container.append(node('p', 'Search documents an author approved in Frige. Approving a passage for Igor is private to you; it does not share the document or change who can open it.'), status);

  const form = node('form', undefined, 'passage-search');
  const projectLabel = node('label', 'Frige project'); const project = node('select'); project.name = 'project'; project.required = true;
  for (const entry of frigeProjects) { const option = node('option', entry.title); option.value = entry.reference; project.append(option); }
  projectLabel.append(project);
  const queryLabel = node('label', 'Words to find'); const query = node('input'); query.name = 'q'; query.required = true; query.maxLength = 200; query.type = 'search'; queryLabel.append(query);
  form.append(projectLabel, queryLabel, node('button', 'Search passages', 'stex-button stex-button--secondary'));
  form.addEventListener('submit', (event) => { event.preventDefault(); void run(async () => {
    const data = new FormData(form);
    const result = await api('/passages/search?' + new URLSearchParams({ project: data.get('project'), q: data.get('q') }));
    hits = result.passages; open = null; render();
    status.textContent = hits.length ? `${hits.length} passage${hits.length === 1 ? '' : 's'} found${result.truncated ? ' (first 20 shown)' : ''}.` : 'No approved passage contains every word.';
  }); });
  container.append(form);

  if (hits.length) {
    const list = node('ol', undefined, 'passage-results');
    for (const hit of hits) {
      const item = node('li'); item.append(node('h3', hit.title), node('p', hit.snippet));
      if (hit.contribution) item.append(node('p', 'Approved for Igor by you', 'passage-badge'));
      item.append(button('Open citation', () => openCitation(hit))); list.append(item);
    }
    container.append(list);
  }

  if (open) {
    const reader = node('section', undefined, 'passage-reader'); reader.setAttribute('aria-label', 'Citation');
    const title = node('h3', open.title); title.tabIndex = -1; reader.append(title, node('blockquote', open.text), citationList(open));
    const contributed = mine.contributions.find((c) => c.status === 'active' && c.reference === open.contribution);
    if (contributed) {
      reader.append(node('p', 'You approved this passage revision for Igor.', 'passage-badge'), button('Withdraw from Igor', () => withdraw(contributed)), button('Use in a new Igor conversation', () => useInIgor(contributed.reference)));
    } else {
      reader.append(button('Approve this passage for Igor', async () => {
        mine = await api('/contributions', { idempotencyKey: crypto.randomUUID(), expectedVersion: mine.version, citation: citationOf(open) });
        await refresh(); open = (await api('/passages/read?' + citationQuery(open))).passage; render();
        status.textContent = 'Approved for Igor. Only you can see or use this approval.';
      }));
    }
    container.append(reader);
  }

  const yours = node('section', undefined, 'passage-contributions'); yours.append(node('h3', 'Your passages for Igor'));
  if (!mine.contributions.length) yours.append(node('p', 'You have not approved any passages.'));
  for (const c of mine.contributions) {
    const card = node('article'); card.append(node('h4', c.title), node('p', stateText(c.state)), node('code', c.reference));
    if (c.state === 'current') card.append(button('Open citation', () => openCitation(c)), button('Use in a new Igor conversation', () => useInIgor(c.reference)));
    if (c.status === 'active') card.append(button('Withdraw from Igor', () => withdraw(c)));
    yours.append(card);
  }
  container.append(yours);
}

/** Human labels for a contribution's live state. */
function stateText(state) {
  return { current: 'Current: the approved source still matches.', stale: 'Changed: the source no longer matches this approval. Igor will not use it.', unavailable: 'Unavailable right now. Igor will not use it until the source answers.', withdrawn: 'Withdrawn. Igor will not use it again; earlier conversations are unchanged.' }[state] || state;
}

/** Withdraws a contribution (future use only). */
async function withdraw(c) {
  mine = await api('/contributions/withdraw', { idempotencyKey: crypto.randomUUID(), expectedVersion: mine.version, id: c.id });
  await refresh(); if (open) open = { ...open, contribution: null }; render();
  status.textContent = 'Withdrawn. Igor will not use this passage in future turns. Earlier conversations are not changed.';
}

/** Reloads this person's contributions with their live state. */
async function refresh() { mine = await api('/contributions'); }

let frigeProjects = [];
void run(async () => {
  try { await refresh(); }
  catch (error) { if (error.status === 404 || error.status === 503 || error.status === 401) { mine = null; render(); return; } throw error; }
  if (mine.enabled === false) { mine = null; render(); return; }
  try {
    const response = await fetch('/frige/api/stex/projects', { signal: AbortSignal.timeout(3000) });
    const value = await response.json();
    if (response.ok && value.schemaVersion === 'stex.projects.summary.v1') frigeProjects = value.projects.filter((p) => typeof p.reference === 'string');
  } catch { /* the project list stays empty and the form says so by having no choices */ }
  render();
});
