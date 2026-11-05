// Loads stex.projects.summary.v1 (protocol/projects) from each active studio
// through Pantheon's proxy and renders Continue working, Recent projects, the
// Projects table, and studio counts. A studio that does not answer within 2 s,
// or answers with anything but a valid v1 document, is shown as unavailable.
const names = { frige: 'Frige', seaxneat: 'Seaxneat', eostre: 'Ēostre', woden: 'Woden' };
const kinds = { book: 'Book', website: 'Website' };
const icons = { frige: 'book-open', seaxneat: 'code-xml' };
const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

// Element.append(null) would insert the text "null": optional nodes go through add().
const add = (parent, ...children) => { parent.append(...children.filter((child) => child !== null && child !== undefined)); return parent; };

function element(tag, attributes = {}, ...children) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (name === 'class') node.className = value; else node.setAttribute(name, value);
  }
  return add(node, ...children);
}

function ago(iso) {
  const time = Date.parse(iso);
  if (!iso || Number.isNaN(time)) return null;
  const seconds = (time - Date.now()) / 1000;
  // Under a day is always hours: "13 hours ago", never "yesterday" for this morning.
  if (Math.abs(seconds) < 3_600) return relative.format(Math.round(seconds / 60), 'minute');
  if (Math.abs(seconds) < 86_400) return relative.format(Math.round(seconds / 3_600), 'hour');
  const days = Math.round(seconds / 86_400);
  if (Math.abs(days) < 30) return relative.format(days, 'day');
  return new Date(time).toLocaleDateString('en', { year: 'numeric', month: 'short', day: 'numeric' });
}

function statusText(project) {
  const when = ago(project.updatedAt);
  if (project.status.state === 'ready' && project.kind === 'book') return when ? `Edited ${when}` : project.status.label;
  return when ? `${project.status.label} · ${when}` : project.status.label;
}

const validProject = (project) => project && typeof project.id === 'string' && typeof project.title === 'string' && project.title
  && typeof project.kind === 'string' && typeof project.openPath === 'string' && /^\/(?!\/)/.test(project.openPath) && !/(^|\/)\.\.(\/|\?|$)/.test(project.openPath)
  && ['ready', 'working', 'attention', 'failed'].includes(project.status?.state) && typeof project.status.label === 'string';

async function loadStudio(application) {
  try {
    const response = await fetch(`${application.route}api/stex/projects`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(2_000) });
    if (!response.ok) throw new Error(String(response.status));
    const summary = await response.json();
    if (summary?.schemaVersion !== 'stex.projects.summary.v1' || summary.application !== application.id || !Array.isArray(summary.projects)) throw new Error('invalid summary');
    return { application, projects: summary.projects.filter(validProject).map((project) => ({ ...project, studio: application.id, href: `${application.route}${project.openPath.slice(1)}` })) };
  } catch {
    return { application, unavailable: true, projects: [] };
  }
}

async function loadAll() {
  const registry = await (await fetch('/api/applications', { headers: { accept: 'application/json' } })).json();
  const active = registry.applications.filter((application) => application.state === 'active');
  const results = await Promise.all(active.map(loadStudio));
  const projects = results.flatMap((result) => result.projects).sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0));
  return { results, projects, unavailable: results.filter((result) => result.unavailable).map((result) => result.application.id) };
}

const unavailableNote = (ids) => ids.length ? element('p', { class: 'stex-meta notice' }, `${ids.map((id) => names[id] || id).join(' and ')} ${ids.length > 1 ? 'are' : 'is'} not responding, so ${ids.length > 1 ? 'their' : 'its'} projects are missing here.`) : null;

function emptyState() {
  return element('div', { class: 'empty' },
    element('p', {}, 'No projects yet.'),
    element('p', { class: 'stex-meta' }, element('a', { href: '/frige/' }, 'Start a book in Frige'), ' · ', element('a', { href: '/seaxneat/' }, 'Start a website in Seaxneat')));
}

// The unavailable-studio note appears once per page: in the project list or
// table. Continue working shows it only when it is the sole project view.
function renderContinue(container, { projects, unavailable }) {
  const latest = projects[0];
  const noteHere = !document.querySelector('[data-projects="recent"], [data-projects="all"]');
  if (!latest) { add(container, emptyState(), noteHere ? unavailableNote(unavailable) : null); return; }
  container.dataset.stexApp = latest.studio;
  add(container,
    element('h2', { class: 'continue-title' }, latest.title),
    element('p', { class: 'continue-meta' }, `${names[latest.studio]} · ${kinds[latest.kind] || latest.kind}`, element('span', { class: `status status--${latest.status.state}` }, statusText(latest))),
    element('p', { class: 'continue-actions' }, element('a', { class: 'stex-button stex-button--primary', href: latest.href }, 'Open project')),
    noteHere ? unavailableNote(unavailable) : null,
  );
}

function projectRow(project) {
  return element('li', { 'data-stex-app': project.studio }, element('a', { class: 'project-row', href: project.href },
    element('span', { class: `project-icon project-icon--${icons[project.studio] || 'book-open'}`, 'aria-hidden': 'true' }),
    element('span', { class: 'project-text' }, element('span', { class: 'project-title' }, project.title), element('span', { class: 'project-meta' }, `${names[project.studio]} · ${kinds[project.kind] || project.kind}`)),
    element('span', { class: `status status--${project.status.state}` }, statusText(project))));
}

function renderList(container, { projects, unavailable }, limit) {
  if (!projects.length) { add(container, emptyState(), unavailableNote(unavailable)); return; }
  add(container, element('ul', { class: 'project-list' }, ...projects.slice(0, limit).map(projectRow)), unavailableNote(unavailable));
}

function renderTable(container, { projects, unavailable }) {
  if (!projects.length) { add(container, emptyState(), unavailableNote(unavailable)); return; }
  const header = element('tr', {}, ...['Project', 'Studio', 'Kind', 'Status'].map((label) => element('th', { scope: 'col' }, label)));
  const rows = projects.map((project) => element('tr', { 'data-stex-app': project.studio },
    element('th', { scope: 'row' }, element('a', { href: project.href }, project.title)),
    element('td', {}, names[project.studio]), element('td', {}, kinds[project.kind] || project.kind),
    element('td', {}, element('span', { class: `status status--${project.status.state}` }, statusText(project)))));
  add(container, element('table', { class: 'project-table' }, element('thead', {}, header), element('tbody', {}, ...rows)), unavailableNote(unavailable));
}

function renderCounts({ results }) {
  for (const result of results) {
    const slot = document.querySelector(`[data-project-count="${result.application.id}"]`);
    if (!slot) continue;
    const count = result.projects.length;
    slot.textContent = result.unavailable ? 'not responding' : count ? `${count} ${count === 1 ? 'project' : 'projects'}` : 'no projects yet';
  }
}

const views = { continue: renderContinue, recent: (container, data) => renderList(container, data, Number(container.dataset.limit) || 5), all: renderTable };

loadAll().then((data) => {
  for (const container of document.querySelectorAll('[data-projects]')) {
    container.querySelector('[data-projects-status]')?.remove();
    views[container.dataset.projects]?.(container, data);
  }
  renderCounts(data);
}).catch(() => {
  for (const status of document.querySelectorAll('[data-projects-status]')) status.textContent = 'Projects could not be loaded.';
  for (const slot of document.querySelectorAll('[data-project-count]')) slot.textContent = 'count unavailable';
});
