import { startScreenlabPalette } from './palette.js';

startScreenlabPalette();
const list = document.querySelector('#project-list');
const form = document.querySelector('#project-form');

async function api(path, options = {}) {
  const response = await fetch(path, { headers: { 'content-type': 'application/json' }, ...options });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || 'Request failed.');
  return value;
}

function render(projects) {
  list.replaceChildren(...projects.map((project) => {
    const card = document.createElement('article');
    card.className = 'project';
    const intent = project.context?.editorialIntent || project.context?.bookDesign || 'Context is ready for page-by-page work.';
    const route = project.settings?.podProfile === 'cross-pod' ? 'Amazon + wide POD' : project.settings?.podProfile || 'POD route not chosen';
    card.innerHTML = '<h3></h3><p></p><small></small><a>Open in TexGraph →</a>';
    card.querySelector('h3').textContent = project.title;
    card.querySelector('p').textContent = intent;
    card.querySelector('small').textContent = `${route} · ${project.settings?.trimSize || 'trim not chosen'}`;
    card.querySelector('a').href = `http://127.0.0.1:4310/?project=${encodeURIComponent(project.id)}`;
    return card;
  }));
}

async function refresh() { render(await api('/api/projects')); }

async function loadFonts() {
  try {
    const result = await api('/api/fonts');
    const fontList = document.querySelector('#font-list');
    fontList.replaceChildren(...result.fonts.map((font) => { const option = document.createElement('option'); option.value = font; return option; }));
    document.querySelector('#font-source').textContent = result.source === 'google-fonts' ? 'Google Fonts catalog connected. Font metadata is proxied by STEX Lab.' : 'Curated font fallback. Add GOOGLE_FONTS_API_KEY to enable the live catalog.';
  } catch {
    document.querySelector('#font-source').textContent = 'Font catalog unavailable; the curated defaults remain usable.';
  }
}

function setSuggested(name, value) {
  const field = form.elements.namedItem(name);
  if (!field || field.dataset.touched === 'true') return;
  field.value = value;
  field.dataset.suggested = 'true';
}

function applyPlayground() {
  const sequence = document.querySelector('#play-sequence').value;
  const object = document.querySelector('#play-object').value;
  const page = document.querySelector('#play-page').value;
  const pod = document.querySelector('#play-pod').value;
  const movement = {
    lyric: ['poetry-collection', 'A lyric sequence whose ordering lets images and echoes accumulate across page turns.'],
    narrative: ['hybrid', 'A sequence with a discernible narrative pressure while preserving the autonomy of each poem.'],
    fragment: ['chapbook', 'A modular field of fragments where white space and juxtaposition carry structure.'],
  }[sequence];
  const physical = {
    intimate: ['5 × 7 in', 'saddle-stitched', '36'],
    standard: ['5.5 × 8.5 in', 'perfect-bound', '72'],
    archive: ['6 × 9 in', 'case-bound', '120'],
  }[object];
  const typography = {
    air: ['Crimson Pro', 'Cormorant Garamond', '11 pt', '16 pt', 'Favor white space, careful lineation, and page turns that give poems room to breathe.'],
    density: ['Source Serif 4', 'Fraunces', '10.5 pt', '14 pt', 'Support dense reading, notes, and longer poem sequences without crowding the page.'],
    voice: ['Literata', 'Alegreya', '11 pt', '15 pt', 'Favor a voiced, performative page with clear stanza rhythm and expressive display settings.'],
  }[page];
  const production = {
    'cross-pod': ['cross-pod', '6 × 9 in', 'perfect-bound', 'black-white', 'white', 'no-bleed', '0.5 in', 'matte', 'own-isbn', 'order-proof', 'separate-wrap-cover'],
    'amazon-kdp': ['amazon-kdp', '5.5 × 8.5 in', 'perfect-bound', 'black-white', 'cream', 'no-bleed', '0.5 in', 'matte', 'platform-isbn', 'order-proof', 'separate-wrap-cover'],
    ingramspark: ['ingramspark', '6 × 9 in', 'perfect-bound', 'black-white', 'white', 'no-bleed', '0.5 in', 'matte', 'own-isbn', 'order-proof', 'separate-wrap-cover'],
    lulu: ['lulu', '6 × 9 in', 'perfect-bound', 'black-white', 'white', 'no-bleed', '0.5 in', 'matte', 'own-isbn', 'order-proof', 'separate-wrap-cover'],
  }[pod];
  [
    ['bookType', movement[0]], ['trimSize', physical[0]], ['binding', physical[1]], ['pageCountGoal', physical[2]],
    ['bodyFont', typography[0]], ['displayFont', typography[1]], ['fontSize', typography[2]],
    ['leading', typography[3]], ['editorialIntent', movement[1]], ['bookDesign', typography[4]],
    ['podProfile', production[0]], ['trimSize', production[1]], ['binding', production[2]], ['interiorInk', production[3]],
    ['paperStock', production[4]], ['bleed', production[5]], ['margins', production[6]], ['coverFinish', production[7]],
    ['isbnPlan', production[8]], ['proofPlan', production[9]], ['coverPlan', production[10]],
  ].forEach(([name, value]) => setSuggested(name, value));
}

form.querySelectorAll('input,textarea,select').forEach((field) => field.addEventListener('input', () => { field.dataset.touched = 'true'; }));
document.querySelector('#apply-playground').addEventListener('click', applyPlayground);
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const values = new FormData(event.currentTarget);
  const button = event.currentTarget.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    await api('/api/projects', { method: 'POST', body: JSON.stringify(Object.fromEntries(values)) });
    event.currentTarget.reset();
    event.currentTarget.querySelectorAll('[data-touched],[data-suggested]').forEach((field) => { delete field.dataset.touched; delete field.dataset.suggested; });
    await refresh();
  } catch (error) { window.alert(error.message); } finally { button.disabled = false; }
});

loadFonts();
refresh().catch((error) => { list.textContent = error.message; });
