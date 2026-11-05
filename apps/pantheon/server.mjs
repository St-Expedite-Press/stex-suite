import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pipeline } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { IGOR_LIMITS, IgorError, assertSameOrigin, igorTurn } from './src/igor.mjs';
import { deferredStudioPage, homePage, projectsPage, studiosPage, tabs, unbuiltPage } from './src/pages.mjs';
import { localProxyTarget, mountedApplication, proxyApplication, shellApplications, validateRegistry } from './src/shell.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const publicDirectory = path.join(directory, 'public');
const booksDirectory = path.resolve(process.env.STEX_FRIGE_BOOKS_DIR || process.env.STEX_BOOKS_DIR || path.join(directory, '..', 'frige', 'books'));
const port = Number(process.env.STEX_PANTHEON_PORT || process.env.STEX_LAB_PORT || 4300);
const registryFile = path.join(directory, '..', '..', 'protocol', 'applications', 'registry.v1.json');
let applications = shellApplications;
try { applications = validateRegistry(JSON.parse(await readFile(registryFile, 'utf8'))); }
catch (error) { console.warn(`Pantheon is using its built-in registry fallback: ${error.message}`); }
const proxyTargets = {
  frige: localProxyTarget(process.env.STEX_FRIGE_URL, 'http://127.0.0.1:4310'),
  seaxneat: localProxyTarget(process.env.STEX_SEAXNEAT_URL, 'http://127.0.0.1:4320'),
};
const mime = {
  '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.avif': 'image/avif', '.mp4': 'video/mp4', '.webm': 'video/webm', '.woff2': 'font/woff2',
};
// The shared design system is served from its own package; only its public folders are reachable.
const designSystemDirectory = path.dirname(createRequire(import.meta.url).resolve('@stex/design-system/package.json'));
const designSystemFolders = new Set(['src', 'fonts', 'brand', 'icons', 'specimen']);
const inference = { inferenceUrl: process.env.STEX_INFERENCE_URL || '', sharedSecret: process.env.STEX_INFERENCE_SHARED_SECRET || '' };
const pages = {
  '/home/': () => homePage(applications),
  '/projects/': () => projectsPage(),
  '/studios/': () => studiosPage(applications),
  '/graph/': () => unbuiltPage('graph'),
  '/activity/': () => unbuiltPage('activity'),
};
function sendPage(response, html) { response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); response.end(html); }
// Counts bytes as they arrive and stops before parsing anything oversized.
async function boundedJson(request, limit) {
  const parts = []; let bytes = 0;
  for await (const part of request) { bytes += part.length; if (bytes > limit) throw new IgorError(413, 'INVALID_REQUEST', 'That request is too large.'); parts.push(part); }
  try { return bytes ? JSON.parse(Buffer.concat(parts).toString('utf8')) : {}; } catch { throw new IgorError(400, 'INVALID_REQUEST', 'Request body must be JSON.'); }
}

function idFor(title) { const stem = String(title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'book'; return `${stem}-${createHash('sha256').update(`${Date.now()}-${Math.random()}`).digest('hex').slice(0, 6)}`; }
function requireBookId(id) { if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(id)) throw new Error('Invalid book id.'); return id; }
function bookRoot(id) { const root = path.resolve(booksDirectory, requireBookId(id)); if (!root.startsWith(`${booksDirectory}${path.sep}`)) throw new Error('Invalid book path.'); return root; }
function setting(source, name, fallback, maximum = 4000) { return String(source[name] || fallback).trim().slice(0, maximum); }
async function atomic(file, content) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, content, 'utf8');
  try {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try { await rename(temporary, file); return; }
      catch (error) {
        if (!['EACCES', 'EBUSY', 'EPERM'].includes(error?.code) || attempt === 7) throw error;
        await new Promise((resolve) => setTimeout(resolve, Math.min(500, 25 * (2 ** attempt))));
      }
    }
  } finally { await rm(temporary, { force: true }).catch(() => {}); }
}
async function exists(file) { try { await access(file); return true; } catch { return false; } }
async function textIfPresent(file) { try { return await readFile(file, 'utf8'); } catch { return ''; } }
function send(response, status, value) { response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); response.end(JSON.stringify(value)); }
async function body(request) { let raw = ''; for await (const part of request) { raw += part; if (raw.length > 12_000_000) throw new Error('Request too large.'); } try { return raw ? JSON.parse(raw) : {}; } catch { throw new Error('Request body must be JSON.'); } }

async function markdownCount(root) {
  let total = 0;
  async function visit(current) {
    const entries = await readdir(current, { withFileTypes: true });
    await Promise.all(entries.map(async (entry) => { if (entry.isDirectory()) await visit(path.join(current, entry.name)); else if (entry.isFile() && entry.name.endsWith('.md')) total += 1; }));
  }
  try { await visit(root); } catch { return 0; }
  return total;
}

async function bookSummary(id) {
  const root = bookRoot(id);
  const readme = await textIfPresent(path.join(root, 'README.md'));
  let settings = null;
  try { settings = JSON.parse(await readFile(path.join(root, 'frige', 'settings.json'), 'utf8')); }
  catch { try { settings = JSON.parse(await readFile(path.join(root, 'texgraph', 'settings.json'), 'utf8')); } catch { /* Existing project metadata remains readable. */ } }
  const manuscript = path.join(root, 'manuscript');
  const programme = await exists(path.join(manuscript, 'Programme.md'));
  const fallbackTitle = /^#\s+(.+)$/m.exec(readme)?.[1]?.trim() || id.replace(/-/g, ' ');
  const fallbackDescription = readme.split(/\r?\n/).find((line) => line.trim() && !line.startsWith('#') && !line.startsWith('-'))?.trim().replaceAll('*', '') || 'Manuscript project';
  return { id, title: settings?.identity?.title || fallbackTitle, author: settings?.identity?.author || '', description: settings?.editorial?.intent || fallbackDescription, state: settings ? 'configured' : programme ? 'manuscript-detected' : 'folder-detected', manuscriptNodes: await markdownCount(manuscript), programme, settingsTicket: Boolean(settings) };
}

async function books() {
  await mkdir(booksDirectory, { recursive: true });
  const entries = await readdir(booksDirectory, { withFileTypes: true });
  const records = await Promise.all(entries.filter((entry) => entry.isDirectory()).map((entry) => bookSummary(entry.name).catch(() => null)));
  return records.filter(Boolean).sort((left, right) => left.title.localeCompare(right.title));
}

function acceptedTicket(payload, id) {
  const input = payload.ticket || {};
  const title = setting(input, 'title', '', 140);
  if (!title) throw new Error('The interview needs a working title before the project vault can be created.');
  return {
    schemaVersion: 1, id, acceptedAt: new Date().toISOString(),
    identity: { title, author: setting(input, 'author', 'Author', 160), subtitle: setting(input, 'subtitle', '', 180) },
    editorial: { kind: setting(input, 'bookType', 'poetry-collection', 80), intent: setting(input, 'editorialIntent', '', 4000), sourceMode: setting(input, 'sourceMode', 'start-blank', 80) },
    production: { podProfile: setting(input, 'podProfile', 'cross-pod', 60), format: 'paperback', trimSize: setting(input, 'trimSize', '6 × 9 in', 40), binding: 'perfect-bound', interiorInk: setting(input, 'interiorInk', 'black-white', 60), paperStock: setting(input, 'paperStock', 'white', 60), bleed: setting(input, 'bleed', 'no-bleed', 60), margins: setting(input, 'margins', '0.5 in', 30), isbnPlan: setting(input, 'isbnPlan', 'unassigned', 60), proofPlan: setting(input, 'proofPlan', 'order-proof', 60), coverFinish: setting(input, 'coverFinish', 'matte', 60) },
    structure: { manuscriptRoot: 'manuscript', programme: 'manuscript/Programme.md', notesRoot: 'notes', compiledRoot: 'compiled', assemblyStatus: 'not-mapped' },
  };
}

function markdownTicket(settings) {
  const { identity, editorial, production, structure } = settings;
  return ['---', `title: "${identity.title.replaceAll('"', '\\"')}"`, `author: "${identity.author.replaceAll('"', '\\"')}"`, 'tags:', '  - frige', '  - settings-ticket', 'status: accepted', `accepted: ${settings.acceptedAt}`, '---', '', '# Global Settings Ticket', '', '> [!success] Accepted project brief', '> This ticket came from the Frige interview. It is the readable, editable brief for this book.', '', '## Identity', '', `- **Title:** ${identity.title}`, `- **Author:** ${identity.author}`, `- **Kind:** ${editorial.kind}`, '', '## Editorial intent', '', editorial.intent || '_To be developed in the manuscript conversation._', '', '## Production brief', '', `- **Route:** ${production.podProfile}`, `- **Format:** ${production.format}; ${production.binding}`, `- **Trim:** ${production.trimSize}`, `- **Interior:** ${production.interiorInk}, ${production.paperStock}, ${production.bleed}`, `- **Safe margin:** ${production.margins}`, `- **ISBN:** ${production.isbnPlan}`, `- **Proof:** ${production.proofPlan}`, `- **Cover finish:** ${production.coverFinish}`, '', '## Manuscript graph', '', `- **Source mode:** ${editorial.sourceMode}`, `- **Programme:** [[../${structure.programme.replace('.md', '')}|Programme]]`, `- **Notes:** [[../${structure.notesRoot}|Project notes]]`, `- **Compiled deliverables:** \`${structure.compiledRoot}/\``, '', '> [!note] Assembly boundary', '> Reading order belongs to the Programme, not folder order. Manuscript, notes, and compiled deliverables are reconciled deliberately.', ''].join('\n');
}

async function createBook(payload) {
  const id = idFor(setting(payload.ticket || {}, 'title', 'book', 140));
  const root = bookRoot(id); const settings = acceptedTicket(payload, id);
  const transcript = Array.isArray(payload.transcript) ? payload.transcript.slice(-40).map((turn) => ({ role: setting(turn, 'role', 'user', 20), message: setting(turn, 'message', '', 4000), at: setting(turn, 'at', new Date().toISOString(), 50) })) : [];
  await Promise.all(['manuscript/00_Front_Matter', 'notes', 'compiled', 'frige', '.texgraph'].map((relative) => mkdir(path.join(root, relative), { recursive: true })));
  const titlePage = ['# ' + settings.identity.title, '', settings.identity.subtitle, settings.identity.author, ''].filter(Boolean).join('\n');
  const programme = ['---', `title: "${settings.identity.title.replaceAll('"', '\\"')}"`, 'tags:', '  - texgraph', '  - programme', '---', '', '# Programme', '', '- [[00_Front_Matter/Title Page|Title Page]]', '', '> [!todo] Map the reading order', '> Add movements, cycles, poems, and apparatus here. This programme, rather than folder order, will be the canonical reading sequence.', ''].join('\n');
  await Promise.all([
    atomic(path.join(root, 'README.md'), `# ${settings.identity.title}\n\n${settings.editorial.intent || 'A Frige book project.'}\n`),
    atomic(path.join(root, 'manuscript', 'Programme.md'), programme),
    atomic(path.join(root, 'manuscript', '00_Front_Matter', 'Title Page.md'), titlePage),
    atomic(path.join(root, 'frige', 'settings.json'), `${JSON.stringify(settings, null, 2)}\n`),
    atomic(path.join(root, 'frige', 'Global Settings Ticket.md'), markdownTicket(settings)),
    atomic(path.join(root, '.texgraph', 'interview.jsonl'), `${transcript.map((turn) => JSON.stringify(turn)).join('\n')}${transcript.length ? '\n' : ''}`),
  ]);
  return bookSummary(id);
}

const documentExtensions = new Set(['.md', '.txt', '.tex', '.csv', '.json', '.pdf', '.docx']);
const directlyReadableExtensions = new Set(['.md', '.txt', '.tex', '.csv', '.json']);

function documentPath(id, name) {
  const supplied = String(name || '');
  const base = path.basename(supplied);
  const extension = path.extname(base).toLowerCase();
  if (!base || base !== supplied || !documentExtensions.has(extension)) throw new Error('Unsupported document name or type.');
  const safeName = base.replace(/[^A-Za-z0-9._ -]/g, '_').slice(0, 160);
  return { extension, safeName };
}

async function documentManifest(root) {
  try {
    const value = JSON.parse(await readFile(path.join(root, '.texgraph', 'documents.json'), 'utf8'));
    return Array.isArray(value) ? value : [];
  } catch { return []; }
}

async function addDocuments(id, payload) {
  const root = bookRoot(id);
  if (!(await exists(root))) throw new Error('Book not found.');
  const uploads = Array.isArray(payload.documents) ? payload.documents : [];
  if (!uploads.length || uploads.length > 10) throw new Error('Choose between one and ten documents.');
  const manifest = await documentManifest(root);
  const created = [];
  for (const upload of uploads) {
    const { extension, safeName } = documentPath(id, upload?.name);
    if (typeof upload?.contentBase64 !== 'string' || upload.contentBase64.length > 11_200_000) throw new Error('Document content is missing or too large.');
    const bytes = Buffer.from(upload.contentBase64, 'base64');
    if (!bytes.length || bytes.length > 8_000_000) throw new Error('Each document must be between 1 byte and 8 MB.');
    const storedAs = `${Date.now()}-${createHash('sha256').update(bytes).digest('hex').slice(0, 10)}-${safeName}`;
    const destination = path.join(root, 'sources', storedAs);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, bytes, { flag: 'wx' });
    const documentId = createHash('sha256').update(`${storedAs}-${Date.now()}`).digest('hex').slice(0, 16);
    const record = { id: documentId, name: safeName, storedAs, mimeType: setting(upload, 'mimeType', 'application/octet-stream', 160), bytes: bytes.length, uploadedAt: new Date().toISOString(), contextState: 'awaiting-extraction' };
    if (directlyReadableExtensions.has(extension)) {
      const extraction = `extractions/${documentId}.txt`;
      await mkdir(path.join(root, '.texgraph', 'extractions'), { recursive: true });
      await atomic(path.join(root, '.texgraph', extraction), bytes.toString('utf8').slice(0, 200_000));
      record.extraction = extraction; record.contextState = 'pending-review'; record.extractedAt = new Date().toISOString();
    }
    manifest.push(record); created.push(record);
  }
  await mkdir(path.join(root, '.texgraph'), { recursive: true });
  await atomic(path.join(root, '.texgraph', 'documents.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return created;
}

async function reviewDocument(id, documentId, payload) {
  const root = bookRoot(id); const manifest = await documentManifest(root); const document = manifest.find((entry) => entry.id === documentId);
  if (!document) throw new Error('Document not found.');
  if (payload.approved !== true) { document.contextState = 'rejected'; document.reviewedAt = new Date().toISOString(); }
  else if (document.contextState === 'pending-review' && document.extraction) { document.contextState = 'approved'; document.reviewedAt = new Date().toISOString(); }
  else throw new Error('This document has no reviewed extraction to approve.');
  await atomic(path.join(root, '.texgraph', 'documents.json'), `${JSON.stringify(manifest, null, 2)}\n`); return document;
}

// Static files revalidate by ETag and honour a single byte range, which browsers
// (Safari in particular) require before they will play <video>.
async function staticFile(request, response, file) {
  let info;
  try { info = await stat(file); } catch { return send(response, 404, { error: 'Not found.' }); }
  if (!info.isFile()) return send(response, 404, { error: 'Not found.' });
  const etag = `W/"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`;
  const headers = { 'content-type': mime[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache', etag, 'last-modified': info.mtime.toUTCString(), 'accept-ranges': 'bytes', 'x-content-type-options': 'nosniff' };
  if (request.headers['if-none-match'] === etag) { response.writeHead(304, headers); response.end(); return; }
  let start = 0; let end = info.size - 1; let status = 200;
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range || '');
  // An invalid range (last before first) is ignored and the whole file is sent.
  if (range && (range[1] || range[2]) && !(range[1] && range[2] && Number(range[2]) < Number(range[1]))) {
    if (range[1]) { start = Number(range[1]); end = range[2] ? Math.min(Number(range[2]), info.size - 1) : info.size - 1; }
    else { start = Math.max(0, info.size - Number(range[2])); }
    if (start >= info.size || start > end) { response.writeHead(416, { ...headers, 'content-range': `bytes */${info.size}` }); response.end(); return; }
    status = 206; headers['content-range'] = `bytes ${start}-${end}/${info.size}`;
  }
  response.writeHead(status, { ...headers, 'content-length': info.size ? end - start + 1 : 0 });
  if (request.method === 'HEAD' || !info.size) { response.end(); return; }
  // pipeline closes the file when a browser aborts a range request and contains read errors.
  pipeline(createReadStream(file, { start, end }), response, () => {});
}

function designSystemFile(pathname) {
  const relative = pathname.slice('/design-system/'.length);
  const file = path.resolve(designSystemDirectory, relative.endsWith('/') || !relative ? `${relative}index.html` : relative);
  const folder = path.relative(designSystemDirectory, file).split(path.sep)[0];
  return file.startsWith(`${designSystemDirectory}${path.sep}`) && designSystemFolders.has(folder) ? file : null;
}

http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  try {
    if (url.pathname === '/texgraph' || url.pathname.startsWith('/texgraph/')) {
      response.writeHead(308, { location: `/frige/${url.search}` }); response.end(); return;
    }
    if (url.pathname === '/screenlab' || url.pathname.startsWith('/screenlab/')) {
      response.writeHead(308, { location: `/eostre/${url.search}` }); response.end(); return;
    }
    if (url.pathname === '/novelgraph' || url.pathname.startsWith('/novelgraph/')) {
      response.writeHead(308, { location: `/woden/${url.search}` }); response.end(); return;
    }
    const application = mountedApplication(url.pathname, applications);
    if (application?.state === 'deferred') {
      const description = shellApplications.find((entry) => entry.id === application.id)?.description || '';
      sendPage(response, deferredStudioPage(application, description)); return;
    }
    if (application) {
      try { await proxyApplication(request, response, proxyTargets[application.id], url, application.route); }
      catch (error) { if (!response.headersSent) send(response, error.message === 'Invalid application path.' || error.message?.startsWith('Invalid encoded') ? 400 : 502, { error: error.message === 'Invalid application path.' || error.message?.startsWith('Invalid encoded') ? error.message : `${application.name} is not available locally.` }); }
      return;
    }
    if (url.pathname === '/api/applications' && request.method === 'GET') return send(response, 200, { schemaVersion: 'stex.applications.registry.v1', applications });
    if (url.pathname === '/api/books' && request.method === 'GET') return send(response, 200, await books());
    if (url.pathname === '/api/books' && request.method === 'POST') return send(response, 201, await createBook(await body(request)));
    const documentMatch = /^\/api\/books\/([a-z0-9][a-z0-9-]{0,62})\/documents$/.exec(url.pathname);
    if (documentMatch && request.method === 'GET') return send(response, 200, await documentManifest(bookRoot(documentMatch[1])));
    if (documentMatch && request.method === 'POST') return send(response, 201, await addDocuments(documentMatch[1], await body(request)));
    const reviewMatch = /^\/api\/books\/([a-z0-9][a-z0-9-]{0,62})\/documents\/([a-f0-9]{16})\/review$/.exec(url.pathname);
    if (reviewMatch && request.method === 'POST') return send(response, 200, await reviewDocument(reviewMatch[1], reviewMatch[2], await body(request)));
    const tab = tabs.find((entry) => url.pathname === entry.route.slice(0, -1));
    if (tab) { response.writeHead(308, { location: `${tab.route}${url.search}` }); response.end(); return; }
    if (pages[url.pathname] && ['GET', 'HEAD'].includes(request.method)) return sendPage(response, pages[url.pathname]());
    if (url.pathname === '/api/igor/turn' && request.method === 'POST') {
      try { assertSameOrigin(request.headers); return send(response, 200, await igorTurn(await boundedJson(request, IGOR_LIMITS.requestBytes), inference)); }
      catch (error) { if (error instanceof IgorError) return send(response, error.status, { error: error.message, code: error.code }); throw error; }
    }
    if (url.pathname.startsWith('/design-system/')) {
      const file = designSystemFile(url.pathname);
      return file ? await staticFile(request, response, file) : send(response, 404, { error: 'Not found.' });
    }
    // "/" is the public splash (index.html); "/home/" is the command center.
    const target = url.pathname.endsWith('/') ? `${url.pathname}index.html` : url.pathname;
    const file = path.resolve(publicDirectory, `.${target}`);
    if (!file.startsWith(`${publicDirectory}${path.sep}`)) return send(response, 403, { error: 'Invalid path.' });
    await staticFile(request, response, file);
  } catch (error) { send(response, 400, { error: error.message || 'Request failed.' }); }
}).listen(port, '127.0.0.1', () => console.log(`Pantheon is ready at http://127.0.0.1:${port}`));
