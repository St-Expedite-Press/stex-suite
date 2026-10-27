import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const publicDirectory = path.join(directory, 'public');
const projectsDirectory = path.resolve(process.env.STEX_PROJECTS_DIR || path.join(directory, '.local-projects'));
const port = Number(process.env.STEX_LAB_PORT || 4300);
const mime = { '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
try {
  const localEnv = await readFile(path.resolve(directory, '..', '..', '.env'), 'utf8');
  for (const line of localEnv.split(/\r?\n/)) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
} catch { /* Deployment supplies secrets through its managed environment. */ }
const curatedFonts = ['Crimson Pro', 'EB Garamond', 'Literata', 'Source Serif 4', 'Cormorant Garamond', 'Libre Baskerville', 'Spectral', 'Alegreya', 'Noto Serif', 'Fraunces', 'Inter', 'Source Sans 3'];
let fontsCache = null;

function idFor(title) {
  const stem = String(title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'poetry-collection';
  return `${stem}-${createHash('sha256').update(`${Date.now()}-${Math.random()}`).digest('hex').slice(0, 6)}`;
}
async function atomic(file, content) { const temp = `${file}.${process.pid}.tmp`; await writeFile(temp, content, 'utf8'); await rename(temp, file); }
function send(response, status, value) { response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); response.end(JSON.stringify(value)); }
async function body(request) { let raw = ''; for await (const part of request) { raw += part; if (raw.length > 50_000) throw new Error('Request too large.'); } return raw ? JSON.parse(raw) : {}; }
async function projects() {
  await mkdir(projectsDirectory, { recursive: true });
  const entries = await readdir(projectsDirectory, { withFileTypes: true });
  const records = await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
    try { return JSON.parse(await readFile(path.join(projectsDirectory, entry.name, 'project.json'), 'utf8')); } catch { return null; }
  }));
  return records.filter(Boolean).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
async function createProject(payload) {
  const title = String(payload.title || '').trim();
  if (!title || title.length > 140) throw new Error('A collection title is required.');
  const id = idFor(title); const root = path.join(projectsDirectory, id); const now = new Date().toISOString();
  const settings = {
    bookType: String(payload.bookType || 'poetry-collection'), author: String(payload.author || 'Author').trim().slice(0, 160), language: String(payload.language || 'English').trim().slice(0, 80), trimSize: String(payload.trimSize || '5.5 × 8.5 in'), binding: String(payload.binding || 'perfect-bound'), pageCountGoal: String(payload.pageCountGoal || '').trim().slice(0, 20), bodyFont: String(payload.bodyFont || 'Crimson Pro').trim().slice(0, 120), displayFont: String(payload.displayFont || 'Cormorant Garamond').trim().slice(0, 120), fontSize: String(payload.fontSize || '11 pt'), leading: String(payload.leading || '15 pt'), margins: String(payload.margins || '0.85 in'), engine: 'lualatex',
  };
  const project = { id, title, kind: settings.bookType, createdAt: now, updatedAt: now, settings, context: { editorialIntent: String(payload.editorialIntent || '').trim().slice(0, 4000), bookDesign: String(payload.bookDesign || '').trim().slice(0, 4000), sourceNotes: String(payload.sourceNotes || '').trim().slice(0, 4000) } };
  await mkdir(path.join(root, 'texgraph', 'pages'), { recursive: true });
  await atomic(path.join(root, 'project.json'), `${JSON.stringify(project, null, 2)}\n`);
  await atomic(path.join(root, 'texgraph', 'book.json'), `${JSON.stringify({ title, author: settings.author, design: project.context.bookDesign || 'A poetry collection with deliberate lineation, generous white space, and attentive page turns.', settings, context: project.context, pages: [{ id: 'page-001', title: 'Opening page' }] }, null, 2)}\n`);
  await atomic(path.join(root, 'texgraph', 'pages', 'page-001.tex'), `% ${title}\n\n`);
  return project;
}
async function fonts(query) {
  const normalized = String(query || '').trim().toLowerCase();
  if (!fontsCache && process.env.GOOGLE_FONTS_API_KEY) {
    try {
      const response = await fetch('https://www.googleapis.com/webfonts/v1/webfonts?sort=popularity', { headers: { 'x-goog-api-key': process.env.GOOGLE_FONTS_API_KEY } });
      if (response.ok) fontsCache = (await response.json()).items.map((item) => item.family);
    } catch { /* Curated fallback remains available offline. */ }
  }
  const source = fontsCache || curatedFonts;
  return source.filter((font) => !normalized || font.toLowerCase().includes(normalized)).slice(0, 60);
}
async function staticFile(response, file) { try { await access(file); response.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream' }); createReadStream(file).pipe(response); } catch { send(response, 404, { error: 'Not found.' }); } }

http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  try {
    if (url.pathname === '/api/projects' && request.method === 'GET') return send(response, 200, await projects());
    if (url.pathname === '/api/projects' && request.method === 'POST') return send(response, 201, await createProject(await body(request)));
    if (url.pathname === '/api/fonts' && request.method === 'GET') return send(response, 200, { fonts: await fonts(url.searchParams.get('q')), source: fontsCache ? 'google-fonts' : 'curated-fallback' });
    const target = url.pathname === '/' ? '/suite.html' : url.pathname.endsWith('/') ? `${url.pathname}index.html` : url.pathname;
    const file = path.resolve(publicDirectory, `.${target}`);
    if (!file.startsWith(`${publicDirectory}${path.sep}`)) return send(response, 403, { error: 'Invalid path.' });
    await staticFile(response, file);
  } catch (error) { send(response, 400, { error: error.message || 'Request failed.' }); }
}).listen(port, '127.0.0.1', () => console.log(`STEX Lab is ready at http://127.0.0.1:${port}`));
