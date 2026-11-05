const projects = document.querySelector('#projects');
const createForm = document.querySelector('#create-project');
const createState = document.querySelector('#create-state');

function card(project) {
  const link = document.createElement('a');
  link.className = 'project';
  link.href = `./?book=${encodeURIComponent(project.id)}`;
  link.innerHTML = `<span class="mark">F</span><span class="project-copy"><strong></strong><small></small></span><span class="go" aria-hidden="true">→</span>`;
  link.querySelector('strong').textContent = project.title;
  link.querySelector('small').textContent = project.reference;
  return link;
}

async function load() {
  const response = await fetch('./api/books', { headers: { accept: 'application/json' } });
  const list = await response.json();
  if (!response.ok) throw new Error(list.error || 'The local project list could not be loaded.');
  projects.replaceChildren(...(list.length ? list.map(card) : [Object.assign(document.createElement('p'), { className: 'empty', textContent: 'No Frige manuscripts are available in this local workspace.' })]));
}

createForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = createForm.querySelector('button');
  button.disabled = true; createState.textContent = 'Creating local book project…';
  try {
    const data = new FormData(createForm);
    const response = await fetch('./api/books', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: data.get('title'), author: data.get('author') }) });
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
