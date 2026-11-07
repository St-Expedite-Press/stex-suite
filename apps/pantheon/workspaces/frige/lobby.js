import { appUrl } from './base-path.js';
const projects = document.querySelector('#projects');
const createForm = document.querySelector('#create-project');
const createState = document.querySelector('#create-state');

function card(project) {
  const item = document.createElement('li');
  const link = document.createElement('a');
  link.className = 'project';
  link.href = `./?book=${encodeURIComponent(project.id)}`;
  link.innerHTML = `<span class="mark" aria-hidden="true"></span><span class="project-copy"><strong></strong><small></small></span><span class="go" aria-hidden="true">→</span>`;
  link.querySelector('strong').textContent = project.title;
  link.querySelector('small').textContent = project.reference;
  item.append(link);
  return item;
}

async function load() {
  const response = await fetch(appUrl('/api/books'), { headers: { accept: 'application/json' } });
  const list = await response.json();
  if (!response.ok) throw new Error(list.error || 'The local project list could not be loaded.');
  const rows = Object.assign(document.createElement('ul'), { className: 'project-list' }); rows.append(...list.map(card));
  projects.replaceChildren(list.length ? rows : Object.assign(document.createElement('p'), { className: 'empty', textContent: 'No Frige manuscripts are available in this local workspace.' }));
}

createForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = createForm.querySelector('button');
  button.disabled = true; createState.textContent = 'Creating local book project…';
  try {
    const data = new FormData(createForm);
    const response = await fetch(appUrl('/api/books'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: data.get('title'), author: data.get('author') }) });
    const project = await response.json();
    if (!response.ok) throw new Error(project.error || 'Project creation failed.');
    location.assign(`./?book=${encodeURIComponent(project.id)}`);
  } catch (error) {
    createState.textContent = error.message;
    button.disabled = false;
  }
});

try {
  await load();
} catch (error) {
  projects.replaceChildren(Object.assign(document.createElement('p'), { className: 'empty error', textContent: error.message }));
}
