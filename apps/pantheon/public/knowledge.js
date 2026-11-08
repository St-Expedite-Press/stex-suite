const root = document.querySelector('#knowledge-content');
const notice = document.querySelector('#knowledge-notice');
let view; let catalog; let busy = false; let projects = [];
const node = (tag, text, className) => { const value = document.createElement(tag); if (text !== undefined) value.textContent = text; if (className) value.className = className; return value; };
function button(text, action) { const value = node('button', text, 'stex-button stex-button--secondary'); value.type = 'button'; value.addEventListener('click', () => run(action)); return value; }
function input(label, name, value = '') { const wrap = node('label', label); const control = node('input'); control.name = name; control.value = value; control.required = true; control.maxLength = 300; wrap.append(control); return wrap; }
async function api(route = '', body) {
  const response = await fetch('/api/knowledge/v1' + route, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(30000), ...(body ? { body: JSON.stringify(body) } : {}) });
  const result = await response.json(); if (!response.ok) throw Error(result.error || 'Knowledge is unavailable.'); return result;
}
async function run(action) { if (busy) return; busy = true; root.inert = true; try { await action(); } catch (error) { notice.textContent = error.message; } finally { busy = false; root.inert = false; } }
const mutation = (route, value) => api(route, { ...value, expectedVersion: view.version, idempotencyKey: crypto.randomUUID() });
function render() {
  root.replaceChildren();
  if (!view.enabled) { notice.textContent = 'Knowledge is not enabled for this workspace.'; return; }
  notice.textContent = 'Knowledge is local and optional. Acceptance stores source identities and revision metadata. Raw source text is not retained here.';
  const discover = node('form'); discover.append(node('h2', 'Accept project sources'));
  const projectLabel = node('label', 'Project'); const projectSelect = node('select'); projectSelect.name = 'project'; projectSelect.required = true;
  const empty = node('option', 'Choose a project'); empty.value = ''; projectSelect.append(empty);
  const choices = new Map([...view.graph.projects, ...projects].map((project) => [project.reference, project]));
  for (const project of choices.values()) { const option = node('option', `${project.title} · ${project.application}`); option.value = project.reference; projectSelect.append(option); }
  projectSelect.value = catalog?.project.reference || new URLSearchParams(location.search).get('project') || '';
  projectLabel.append(projectSelect); discover.append(projectLabel);
  discover.append(node('button', 'Inspect project sources', 'stex-button stex-button--secondary'));
  discover.addEventListener('submit', (event) => { event.preventDefault(); void run(async () => { catalog = await api('/sources?project=' + encodeURIComponent(new FormData(discover).get('project'))); render(); }); }); root.append(discover);
  if (catalog) {
    const selection = node('form'); selection.append(node('h3', catalog.project.title), node('p', 'Select up to four source references. Revision hashes below are checked again when you accept.'));
    catalog.sources.forEach((source) => { const label = node('label'); const box = node('input'); box.type = 'checkbox'; box.value = source.id; box.name = 'source'; box.disabled = !source.available; label.append(box, document.createTextNode(`${source.title} · ${source.bytes} bytes · ${source.revision || 'unavailable'}`)); selection.append(label); });
    if (catalog.nextOffset !== null) selection.append(button('More project sources', async () => { const next = await api('/sources?project=' + encodeURIComponent(catalog.project.reference) + '&offset=' + catalog.nextOffset); const unique = new Map([...catalog.sources, ...next.sources].map((entry) => [entry.id, entry])); catalog = { ...next, sources: [...unique.values()] }; render(); notice.textContent = 'More source references loaded. Select the revisions to accept.'; }));
    selection.append(node('button', 'Accept selected revisions', 'stex-button stex-button--secondary'));
    selection.addEventListener('submit', (event) => { event.preventDefault(); void run(async () => { const ids = new FormData(selection).getAll('source'); if (!ids.length || ids.length > 4) throw Error('Select one to four sources.'); view = await mutation('/accept', { project: catalog.project.reference, sources: ids.map((id) => { const entry = catalog.sources.find((s) => s.id === id); return { id, revision: entry.revision }; }) }); catalog = null; render(); notice.textContent = 'Accepted revisions updated the source and project views together.'; }); }); root.append(selection);
  }
  root.append(node('h2', 'Accepted projects and evidence'));
  if (!view.graph.projects.length) root.append(node('p', 'No project knowledge has been accepted.'));
  for (const project of view.graph.projects) {
    const card = node('section'); card.append(node('h3', project.title), node('code', project.reference), node('p', project.consent ? 'Accepted source references' : 'Consent withdrawn'));
    const link = node('a', 'Discuss current project with Igor', 'stex-button stex-button--secondary'); link.href = '/igor/new?project=' + encodeURIComponent(project.reference); card.append(link);
    view.knowledge.sources.filter((s) => s.project === project.reference).forEach((source) => { const p = node('p', `${source.title} · ${source.access} · ${source.revision}`); p.append(node('br'), node('code', source.reference)); card.append(p); });
    if (project.consent) card.append(button('Withdraw project knowledge', async () => { view = await mutation('/revoke', { project: project.reference }); render(); })); root.append(card);
  }
  root.append(node('h2', 'Assertions and inferred relationships'));
  const relation = node('form');
  const subjectLabel = node('label', 'Subject project'); const subject = node('select'); subject.name = 'subject'; subject.required = true;
  view.graph.projects.filter((project) => project.consent).forEach((project) => { const option = node('option', project.title); option.value = project.reference; subject.append(option); }); subjectLabel.append(subject);
  relation.append(subjectLabel, input('Relationship', 'predicate'), input('Concept, preference or commitment', 'object'));
  const kindLabel = node('label', 'Record kind'); const kind = node('select'); kind.name = 'kind'; for (const [value, text] of [['assertion', 'My assertion'], ['inference', 'Proposed inference']]) { const option = node('option', text); option.value = value; kind.append(option); } kindLabel.append(kind); relation.append(kindLabel);
  const evidenceLabel = node('label', 'Revision evidence'); const evidence = node('select'); evidence.name = 'evidence'; view.knowledge.sources.filter((s) => s.access === 'current').forEach((s) => { const option = node('option', `${s.title} · ${s.revision.slice(0, 12)}`); option.value = s.reference; evidence.append(option); }); evidenceLabel.append(evidence); relation.append(evidenceLabel, input('Confidence for an inference (0 to 1)', 'confidence', '0.5'));
  const save = node('button', 'Record relationship', 'stex-button stex-button--secondary'); save.disabled = !evidence.options.length; relation.append(save);
  relation.addEventListener('submit', (event) => { event.preventDefault(); void run(async () => { const data = new FormData(relation); const source = view.knowledge.sources.find((s) => s.reference === data.get('evidence') && s.access === 'current'); view = await mutation('/relation', { relation: { id: crypto.randomUUID(), kind: data.get('kind'), subject: data.get('subject'), predicate: data.get('predicate'), object: data.get('object'), evidence: [{ reference: source.reference, revision: source.revision }], ...(data.get('kind') === 'inference' ? { confidence: Number(data.get('confidence')) } : {}) } }); render(); }); }); root.append(relation);
  for (const item of view.graph.relations) {
    const card = node('section'); card.append(node('h3', `${item.predicate}: ${item.object}`), node('p', `${item.kind} · ${item.status} · evidence ${item.evidenceState}${item.confidence !== undefined ? ' · confidence ' + item.confidence : ''}`), node('code', item.subject));
    item.evidence.forEach((entry) => card.append(node('p', `${entry.reference} · ${entry.revision}`)));
    for (const status of ['accepted', 'rejected']) card.append(button(status === 'accepted' ? 'Accept relationship' : 'Reject relationship', async () => { view = await mutation('/revise', { id: item.id, status }); render(); }));
    card.append(button('Correct relationship', async () => { const object = prompt('Corrected concept, preference or commitment', item.object); if (!object) return; view = await mutation('/revise', { id: item.id, status: 'accepted', object }); render(); })); root.append(card);
  }
  const acceptedRelations = view.graph.relations.filter((item) => item.status === 'accepted' && item.evidenceState === 'current');
  if (acceptedRelations.length) {
    const text = 'Discuss this explicitly approved project knowledge. Inferences remain hypotheses.\n\n' + acceptedRelations.map((item) => `${item.kind}${item.confidence !== undefined ? ' (confidence ' + item.confidence + ')' : ''}: ${item.subject} ${item.predicate} ${item.object}\nEvidence: ${item.evidence.map((e) => e.reference + '@' + e.revision).join(', ')}`).join('\n\n');
    const preview = node('details'); preview.append(node('summary', 'Preview knowledge for Igor'), node('pre', text));
    const version = view.version;
    const handoffKey = crypto.randomUUID();
    const send = button('Send approved knowledge to Igor', async () => {
      if (text.length > 6000) throw Error('This knowledge exceeds one message. Review fewer accepted relationships.');
      const current = await api();
      if (current.version !== version || acceptedRelations.some((item) => !current.graph.relations.some((entry) => entry.id === item.id && entry.status === 'accepted' && entry.evidenceState === 'current'))) throw Error('Knowledge or source access changed. Refresh and preview again.');
      const response = await fetch('/igor/api/conversations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idempotencyKey: handoffKey, message: text }) });
      const result = await response.json(); if (!response.ok) throw Error(result.error || 'Igor is unavailable.');
      if (!/^\/igor\/c\/[a-z0-9]{12}$/.test(result.route)) throw Error('Igor returned an invalid conversation route.');
      location.assign(result.route);
    });
    preview.append(send); root.append(preview);
  }
  const actions = node('div'); actions.append(button('Refresh source access', async () => { view = await api(); render(); }), button('Export knowledge', async () => { const data = await api('/export'); const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })); const link = node('a'); link.href = url; link.download = 'pantheon-knowledge.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }), button('Delete all knowledge', async () => { if (!confirm('Delete this knowledge journal, assertions and relationships? Engine sources and conversations are preserved.')) return; view = await mutation('/erase', { confirmation: 'delete-knowledge' }); catalog = null; render(); })); root.append(actions);
}
void run(async () => {
  view = await api();
  if (view.enabled) {
    const result = await Promise.allSettled(['frige', 'seaxneat'].map(async (application) => { const response = await fetch(`/${application}/api/stex/projects`, { signal: AbortSignal.timeout(3000) }); const value = await response.json(); if (!response.ok || value.schemaVersion !== 'stex.projects.summary.v1' || value.application !== application || !Array.isArray(value.projects)) throw Error('Project engine unavailable'); return value.projects.map((project) => ({ ...project, application })); }));
    projects = result.flatMap((entry) => entry.status === 'fulfilled' ? entry.value : []);
  }
  render();
});
