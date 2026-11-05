import { createReadStream, existsSync } from 'node:fs';
import { access, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { BookStore } from './src/project-store.mjs';
import { ProjectStore } from './src/project-store-vault.mjs';
import { buildPage, TRIM_SIZES } from './src/lualatex.mjs';
import { buildBook, resolveHeadTitle } from './src/book-assembler.mjs';
import { designHash } from './src/design-settings.mjs';
import { runPreflight } from './src/preflight.mjs';
import { gatewaySettings, inferenceHealth, requestPageRevision, requestScopeTurn } from './src/inference-client.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const publicDirectory = path.join(directory, 'public');
const appEnvironment = new Set(['STEX_INFERENCE_URL', 'STEX_INFERENCE_SHARED_SECRET', 'STEX_FRIGE_INFERENCE_MODE', 'STEX_FRIGE_PORT', 'STEX_FRIGE_PROJECT_DIR', 'STEX_FRIGE_PROJECTS_DIR', 'STEX_FRIGE_BOOKS_DIR', 'STEX_FRIGE_BASE_PATH', 'STEX_FRIGE_SHELL_URL', 'TEXGRAPH_INFERENCE_MODE', 'TEXGRAPH_PORT', 'TEXGRAPH_PROJECT_DIR', 'TEXGRAPH_PROJECTS_DIR', 'TEXGRAPH_BOOKS_DIR', 'TEXGRAPH_BASE_PATH', 'TEXGRAPH_SHELL_URL']);
try {
  const localEnv = await readFile(path.resolve(directory, '..', '..', '.env'), 'utf8');
  for (const line of localEnv.split(/\r?\n/)) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (match && appEnvironment.has(match[1]) && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
} catch { /* The host may provide application-safe configuration directly. */ }
function configuration(canonical, legacy, fallback) {
  const current = process.env[canonical]; const previous = process.env[legacy];
  if (current && previous && current !== previous) console.warn(`${canonical} takes precedence over ${legacy}.`);
  return current || previous || fallback;
}
function preservedDefault(current, legacy) { return existsSync(current) || !existsSync(legacy) ? current : legacy; }
const legacyDirectory = path.join(directory, '..', 'texgraph');
const projectDirectory = path.resolve(configuration('STEX_FRIGE_PROJECT_DIR', 'TEXGRAPH_PROJECT_DIR', preservedDefault(path.join(directory, '.local-book'), path.join(legacyDirectory, '.local-book'))));
const projectsDirectory = path.resolve(configuration('STEX_FRIGE_PROJECTS_DIR', 'TEXGRAPH_PROJECTS_DIR', preservedDefault(path.join(directory, '..', 'pantheon', '.local-projects'), path.join(directory, '..', 'lab', '.local-projects'))));
const booksDirectory = path.resolve(configuration('STEX_FRIGE_BOOKS_DIR', 'TEXGRAPH_BOOKS_DIR', path.join(directory, 'books')));
const defaultStore = new BookStore(projectDirectory);
const projectStores = new Map();
const port = Number(configuration('STEX_FRIGE_PORT', 'TEXGRAPH_PORT', 4310));
function basePath(value) {
  const normalized = String(value || '').trim().replace(/\/+$/, '');
  if (!normalized) return '';
  if (!/^\/[a-z0-9-]+(?:\/[a-z0-9-]+)*$/i.test(normalized)) throw new Error('STEX_FRIGE_BASE_PATH must be an absolute path without traversal.');
  return normalized;
}
const mountedAt = basePath(configuration('STEX_FRIGE_BASE_PATH', 'TEXGRAPH_BASE_PATH', ''));
const shellUrl = String(configuration('STEX_FRIGE_SHELL_URL', 'TEXGRAPH_SHELL_URL', mountedAt ? '/home/' : '')).trim() || '/';

const mimeTypes = { '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.pdf': 'application/pdf' };
// The proof viewer's PDF.js browser build; only these two files are exposed.
const pdfjsFiles = new Set(['pdf.min.mjs', 'pdf.worker.min.mjs']);
function pdfjsFile(name) {
  try { return path.join(path.dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json')), 'build', name); } catch { return null; }
}

function json(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(value));
}

async function body(request) {
  let raw = '';
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 12_000_000) throw new Error('Request is too large.');
  }
  try { return raw ? JSON.parse(raw) : {}; } catch { throw new Error('Request body must be JSON.'); }
}

function pageId(url) {
  const match = url.pathname.match(/^\/api\/pages\/([a-z0-9-]+)(?:\/|$)/);
  return match?.[1] || null;
}

async function serveFile(response, file) {
  try {
    await access(file);
    response.writeHead(200, { 'content-type': mimeTypes[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    createReadStream(file).pipe(response);
  } catch {
    json(response, 404, { error: 'Not found.' });
  }
}

async function storeFor(url) {
  const bookId = url.searchParams.get('book');
  if (bookId) {
    if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(bookId)) throw new Error('Invalid book id.');
    const bookRoot = path.resolve(booksDirectory, bookId);
    if (!bookRoot.startsWith(`${booksDirectory}${path.sep}`)) throw new Error('Invalid book path.');
    try { await access(path.join(bookRoot, 'manuscript', 'Programme.md')); } catch { throw new Error('Book project not found.'); }
    // Map the vault once per server start so diagnostics reflect the current manuscript and parser.
    if (!projectStores.has(`book:${bookId}`)) {
      const created = new ProjectStore(bookRoot);
      projectStores.set(`book:${bookId}`, created.initialize().then(() => created.refreshGraph()).then(() => created).catch((error) => { projectStores.delete(`book:${bookId}`); throw error; }));
    }
    const store = await projectStores.get(`book:${bookId}`); await store.initialize(); return store;
  }
  const projectId = url.searchParams.get('project');
  if (!projectId) return defaultStore;
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(projectId)) throw new Error('Invalid project id.');
  const projectRoot = path.resolve(projectsDirectory, projectId);
  if (!projectRoot.startsWith(`${projectsDirectory}${path.sep}`)) throw new Error('Invalid project path.');
  try { await access(path.join(projectRoot, 'project.json')); } catch { throw new Error('Project not found.'); }
  if (!projectStores.has(projectId)) projectStores.set(projectId, new BookStore(path.join(projectRoot, 'texgraph')));
  const store = projectStores.get(projectId);
  await store.initialize();
  return store;
}

// The Frige root is a chooser, not an implicit mutation of any manuscript.
// A selected project remains explicit in the `book` query parameter.
async function availableBooks() {
  const entries = await readdir(booksDirectory, { withFileTypes: true }).catch(() => []);
  const records = await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
    if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(entry.name)) return null;
    const root = path.join(booksDirectory, entry.name);
    try { await access(path.join(root, 'manuscript', 'Programme.md')); } catch { return null; }
    const readme = await readFile(path.join(root, 'README.md'), 'utf8').catch(() => '');
    const title = /^#\s+(.+)$/m.exec(readme)?.[1]?.trim() || entry.name.replaceAll('-', ' ');
    return { id: entry.name, title, reference: `stex://frige/project/${entry.name}` };
  }));
  return records.filter(Boolean).sort((left, right) => left.title.localeCompare(right.title));
}

// Newest modification time in a book, from file metadata only (manuscripts are
// never opened). Hidden folders (.git, .texgraph, .obsidian) and node_modules
// are tooling, not author changes. Symlinks are not followed (Dirent uses
// lstat). At most 5,000 entries per book are visited; files in a folder are
// stat-ed together.
async function newestChange(root, budget = { entries: 5000 }) {
  const entries = (await readdir(root, { withFileTypes: true }).catch(() => []))
    .filter((entry) => !entry.name.startsWith('.') && entry.name !== 'node_modules')
    .slice(0, Math.max(0, budget.entries));
  budget.entries -= entries.length;
  const files = await Promise.all(entries.filter((entry) => entry.isFile()).map((entry) => stat(path.join(root, entry.name)).then((info) => info.mtimeMs, () => 0)));
  let newest = Math.max(0, ...files);
  for (const entry of entries) if (entry.isDirectory() && budget.entries > 0) newest = Math.max(newest, await newestChange(path.join(root, entry.name), budget));
  return newest;
}

// stex.projects.summary.v1 (protocol/projects): read-only summaries for Pantheon.
async function projectSummaries() {
  const books = await availableBooks();
  const projects = await Promise.all(books.map(async (book) => {
    const changed = await newestChange(path.join(booksDirectory, book.id));
    return { reference: book.reference, id: book.id, title: book.title, kind: 'book', updatedAt: changed ? new Date(changed).toISOString() : null, status: { state: 'ready', label: 'Manuscript' }, openPath: `/?book=${encodeURIComponent(book.id)}` };
  }));
  return { schemaVersion: 'stex.projects.summary.v1', application: 'frige', projects };
}

async function createBookProject(payload) {
  const title = String(payload?.title || '').trim().replace(/\s+/g, ' ').slice(0, 140);
  const author = String(payload?.author || '').trim().replace(/\s+/g, ' ').slice(0, 160);
  if (!title) throw new Error('A book title is required.');
  const stem = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'book';
  const id = `${stem}-${createHash('sha256').update(`${title}:${Date.now()}:${Math.random()}`).digest('hex').slice(0, 6)}`;
  const root = path.resolve(booksDirectory, id);
  if (!root.startsWith(`${booksDirectory}${path.sep}`)) throw new Error('Invalid book path.');
  await Promise.all([
    mkdir(path.join(root, 'manuscript', '00_Front_Matter'), { recursive: true }),
    mkdir(path.join(root, 'notes'), { recursive: true }),
    mkdir(path.join(root, '.texgraph'), { recursive: true }),
  ]);
  const programme = ['---', `title: "${title.replaceAll('"', '\\"')}"`, '---', '', '# Programme', '', '- [[00_Front_Matter/Title Page|Title Page]]', '', '> [!todo] Add pieces to the reading order deliberately.', ''].join('\n');
  const titlePage = ['# ' + title, '', author, ''].filter(Boolean).join('\n');
  await Promise.all([
    writeFile(path.join(root, 'README.md'), `# ${title}\n\nA local Frige book project.\n`, { flag: 'wx' }),
    writeFile(path.join(root, 'manuscript', 'Programme.md'), programme, { flag: 'wx' }),
    writeFile(path.join(root, 'manuscript', '00_Front_Matter', 'Title Page.md'), titlePage, { flag: 'wx' }),
  ]);
  return { id, title, reference: `stex://frige/project/${id}` };
}

function nodeId(url) { return url.pathname.match(/^\/api\/nodes\/([a-z0-9-]+)(?:\/|$)/)?.[1] || null; }

const attachmentExtensions = new Set(['.md', '.txt', '.tex', '.csv', '.json', '.pdf', '.docx']);
const readableAttachmentExtensions = new Set(['.md', '.txt', '.tex', '.csv', '.json']);
async function attachmentManifest(store) { try { const value = JSON.parse(await readFile(path.join(store.stateDirectory, 'documents.json'), 'utf8')); return Array.isArray(value) ? value : []; } catch { return []; } }
async function saveAttachments(store, payload) {
  const uploads = Array.isArray(payload.attachments) ? payload.attachments : [];
  if (!uploads.length || uploads.length > 10) throw new Error('Attach between one and ten files.');
  const manifest = await attachmentManifest(store); const created = [];
  for (const upload of uploads) {
    const name = path.basename(String(upload?.name || '')); const extension = path.extname(name).toLowerCase();
    if (!name || name !== upload.name || !attachmentExtensions.has(extension)) throw new Error('Unsupported attachment type or filename.');
    if (typeof upload.contentBase64 !== 'string' || upload.contentBase64.length > 11_200_000) throw new Error('Attachment is missing or too large.');
    const bytes = Buffer.from(upload.contentBase64, 'base64'); if (!bytes.length || bytes.length > 8_000_000) throw new Error('Each attachment must be between 1 byte and 8 MB.');
    const id = createHash('sha256').update(`${Date.now()}-${name}-${bytes.length}`).digest('hex').slice(0, 16); const safeName = name.replace(/[^A-Za-z0-9._ -]/g, '_').slice(0, 160); const storedAs = `${Date.now()}-${id}-${safeName}`;
    const sourceDirectory = path.join(store.root, 'sources'); await mkdir(sourceDirectory, { recursive: true }); await writeFile(path.join(sourceDirectory, storedAs), bytes, { flag: 'wx' });
    const record = { id, name: safeName, storedAs, bytes: bytes.length, uploadedAt: new Date().toISOString(), contextState: 'awaiting-extraction' };
    if (readableAttachmentExtensions.has(extension)) { const extraction = `extractions/${id}.txt`; await mkdir(path.join(store.stateDirectory, 'extractions'), { recursive: true }); await writeFile(path.join(store.stateDirectory, extraction), bytes.toString('utf8').slice(0, 200_000), 'utf8'); record.extraction = extraction; record.contextState = 'pending-review'; }
    manifest.push(record); created.push(record);
  }
  await mkdir(store.stateDirectory, { recursive: true }); await writeFile(path.join(store.stateDirectory, 'documents.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8'); return created;
}
async function reviewAttachment(store, id) { const manifest = await attachmentManifest(store); const record = manifest.find((entry) => entry.id === id); if (!record || record.contextState !== 'pending-review' || !record.extraction) throw new Error('This attachment is not ready for review.'); record.contextState = 'approved'; record.reviewedAt = new Date().toISOString(); await writeFile(path.join(store.stateDirectory, 'documents.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8'); return record; }

// One conversation turn with a book, section or page. Hermes may propose changes;
// the store keeps only those for nodes whose text this turn offered.
async function scopeTurn(store, scopeId, payload) {
  // A turn is either a message or an answer to one of Hermes's choices or forms.
  // An answer is reserved, not recorded, until Hermes replies to it.
  let userTurn = null; let reservation = null;
  if (payload.answer && typeof payload.answer === 'object') {
    reservation = await store.reserveAnswer(scopeId, String(payload.answer.promptId || ''), payload.answer.values);
  } else {
    if (typeof payload.message !== 'string' || !payload.message.trim() || payload.message.length > 12_000) throw new Error('A concise message is required.');
    userTurn = await store.appendTurn(scopeId, { role: 'user', message: payload.message.trim() });
  }
  try {
    const [context, priorTurns, approvedSourceExcerpts, settings] = await Promise.all([store.scopeContext(scopeId), store.turns(scopeId, 12), store.approvedSourceExcerpts(), store.settingsTicket()]);
    const graph = { readingOrder: context.graph.readingOrder, sections: context.graph.book.sections.map(({ id, kind, title, nodeIds }) => ({ id, kind, title, nodeIds })), nodes: context.graph.nodes.map(({ id, title, kind, relativePath }) => ({ id, title, kind, relativePath })), diagnostics: context.graph.diagnostics.slice(0, 40) };
    const result = await requestScopeTurn({ book: { id: path.basename(store.root), title: context.graph.book.title, settings }, scope: context.scope, sources: context.sources, withheld: context.withheld, graph, approvedSourceExcerpts, turns: reservation ? priorTurns : priorTurns.slice(0, -1), message: (reservation || userTurn).message, answer: reservation ? { promptId: reservation.partId, values: reservation.values } : null });
    if (reservation) {
      // Hermes did not receive the answer: leave the question open and say why.
      if (result.availability !== 'available') throw Object.assign(new Error(result.commentary.replace(/\s*Your message was saved.*$/s, '')), { code: 'HERMES_UNAVAILABLE' });
      userTurn = await store.commitAnswer(reservation);
    }
    const { changeSet, dropped } = result.changes.length ? await store.createChangeSet(scopeId, { commentary: result.commentary, changes: result.changes }, context.sources) : { changeSet: null, dropped: [] };
    const stored = await store.storeParts(scopeId, result.parts, result.meta);
    const assistantTurn = await store.appendTurn(scopeId, { role: 'assistant', commentary: result.commentary, availability: result.availability, parts: stored.parts, droppedParts: [...result.droppedParts, ...stored.dropped], meta: result.meta, failure: result.failure || null, graphSuggestions: result.graphSuggestions || [], changeSetId: changeSet?.id || null, droppedChanges: dropped });
    return { userTurn, assistantTurn, changeSet, availability: result.availability };
  } finally { if (reservation) store.releaseAnswer(reservation); }
}

// Artifact content is served as inert data: images by their checked type, text as
// plain text, never as HTML or script, with a sandboxing policy and no sniffing.
async function artifactResponse(response, store, id, content, download) {
  if (!content) { const record = await store.artifact(id); return record ? json(response, 200, record) : json(response, 404, { error: 'Artifact not found.' }); }
  const found = await store.artifactContent(id);
  if (!found) return json(response, 404, { error: 'Artifact not found.' });
  const { record } = found;
  const type = record.kind === 'image' ? record.mediaType : 'text/plain; charset=utf-8';
  const textExtensions = new Set(['txt', 'md', 'json', 'csv', 'tsv', 'tex', 'yaml', 'yml', 'toml', 'css', 'sql', 'log']);
  const declared = String(record.language || '').toLowerCase();
  const extension = record.kind === 'image' ? record.mediaType.split('/')[1].replace('jpeg', 'jpg') : record.kind === 'document' ? 'md' : textExtensions.has(declared) ? declared : 'txt';
  const base = record.title.replace(/[^A-Za-z0-9 ._-]/g, '').trim().slice(0, 80) || record.id; const suffix = String(extension).replace(/[^a-z0-9]/gi, '').slice(0, 10) || 'txt';
  // A title that already ends with its extension keeps a single one.
  const name = base.toLowerCase().endsWith(`.${suffix.toLowerCase()}`) ? base : `${base}.${suffix}`;
  response.writeHead(200, { 'content-type': type, 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; sandbox", 'cache-control': 'private, max-age=31536000, immutable', ...(download ? { 'content-disposition': `attachment; filename="${name}"` } : {}) });
  response.end(found.content);
}

async function vaultApi(request, response, url, store) {
  const id = nodeId(url);
  const attachmentId = url.pathname.match(/^\/api\/project\/attachments\/([a-f0-9]{16})\/approve$/)?.[1];
  if (request.method === 'GET' && url.pathname === '/api/project/attachments') return json(response, 200, await attachmentManifest(store));
  if (request.method === 'POST' && url.pathname === '/api/project/attachments') return json(response, 201, await saveAttachments(store, await body(request)));
  if (request.method === 'POST' && attachmentId) return json(response, 200, await reviewAttachment(store, attachmentId));
  if (request.method === 'GET' && url.pathname === '/api/project/graph') return json(response, 200, await store.graph());
  if (request.method === 'POST' && url.pathname === '/api/project/refresh') return json(response, 200, await store.refreshGraph());
  if (request.method === 'GET' && url.pathname === '/api/project/preview') return serveFile(response, store.previewPath());
  if (request.method === 'GET' && url.pathname === '/api/project/build') return json(response, 200, await store.buildStatus());
  if (request.method === 'GET' && url.pathname === '/api/project/preflight') {
    const manifest = await readFile(path.join(store.buildDirectory(), 'page-map.json'), 'utf8').then(JSON.parse).catch(() => null);
    const pdfData = await readFile(store.previewPath()).catch(() => new Uint8Array());
    const [graph, design] = await Promise.all([store.graph(), store.design()]);
    return json(response, 200, await runPreflight({ manifest, pdfPath: store.previewPath(), pdfData, graph, currentDesign: design, currentHeadTitle: await resolveHeadTitle(store, graph, design) }));
  }
  if (request.method === 'GET' && url.pathname === '/api/project/design') { const design = await store.design(); return json(response, 200, { design, hash: designHash(design), defaultHash: designHash({}), trimSizes: [...TRIM_SIZES.keys()] }); }
  if (request.method === 'PUT' && url.pathname === '/api/project/design') { const design = await store.saveDesign(await body(request)); return json(response, 200, { design, hash: designHash(design) }); }
  if (request.method === 'GET' && url.pathname === '/api/inference/health') return json(response, 200, await inferenceHealth());
  if (request.method === 'GET' && url.pathname === '/api/project/artifacts') return json(response, 200, await store.artifacts());
  const artifactRoute = url.pathname.match(/^\/api\/artifacts\/(art-[a-f0-9]{16})(\/content)?$/);
  if (request.method === 'GET' && artifactRoute) return artifactResponse(response, store, artifactRoute[1], Boolean(artifactRoute[2]), url.searchParams.get('download') === '1');
  if (request.method === 'GET' && url.pathname === '/api/project/reference-map') return json(response, 200, await store.referenceMap());
  if (request.method === 'GET' && url.pathname === '/api/project/live-build') return json(response, 200, await store.liveBuildStatus());
  if (request.method === 'GET' && url.pathname === '/api/project/page-map') {
    try { return json(response, 200, JSON.parse(await readFile(path.join(store.buildDirectory(), 'page-map.json'), 'utf8'))); } catch { return json(response, 200, null); }
  }
  if (request.method === 'POST' && url.pathname === '/api/project/build') {
    const payload = await body(request);
    const result = await buildBook(store, { scopeId: payload.scopeId || 'book', mode: payload.mode === 'isolated' ? 'isolated' : 'prefix' }); return json(response, result.ok ? 200 : 422, await store.recordBuild(result));
  }
  if (request.method === 'POST' && url.pathname === '/api/project/live-build') {
    const payload = await body(request);
    return json(response, 201, await store.queueLiveBuild(payload.scopeId || 'book'));
  }
  const scoped = url.pathname.match(/^\/api\/scopes\/(book|[a-z][a-z0-9-]{5,80})\/(turns|turn|changes|changes\/decide)$/);
  if (scoped) {
    const [, scopeId, action] = scoped;
    if (request.method === 'GET' && action === 'turns') return json(response, 200, await store.turns(scopeId));
    if (request.method === 'GET' && action === 'changes') return json(response, 200, await store.changeSet(scopeId));
    if (request.method === 'POST' && action === 'changes/decide') { const payload = await body(request); return json(response, 200, await store.decideChanges(scopeId, payload.changeSetId, { nodeId: payload.nodeId || null, decision: payload.decision })); }
    if (request.method === 'POST' && action === 'turn') return json(response, 200, await scopeTurn(store, scopeId, await body(request)));
  }
  if (!id) return false;
  if (request.method === 'GET' && url.pathname === `/api/nodes/${id}`) return json(response, 200, await store.node(id));
  if (request.method === 'PUT' && url.pathname === `/api/nodes/${id}`) { const payload = await body(request); return json(response, 200, await store.updateNode(id, payload.source, payload.baseHash)); }
  return false;
}

async function api(request, response, url, store) {
  if (store instanceof ProjectStore) return vaultApi(request, response, url, store);
  const id = pageId(url);
  if (request.method === 'GET' && url.pathname === '/api/health') return json(response, 200, { ok: true, projectDirectory });
  if (request.method === 'GET' && url.pathname === '/api/book') return json(response, 200, await store.book());
  if (request.method === 'POST' && url.pathname === '/api/pages') {
    const payload = await body(request);
    return json(response, 201, await store.createPage(payload.title));
  }
  if (!id) return false;
  if (request.method === 'GET' && url.pathname.endsWith('/preview')) return serveFile(response, store.previewPath(id));
  if (request.method === 'GET' && url.pathname.endsWith('/turns')) return json(response, 200, await store.turns(id));
  if (request.method === 'GET' && url.pathname.endsWith('/proposal')) return json(response, 200, await store.proposal(id));
  if (request.method === 'GET' && url.pathname.endsWith('/build')) return json(response, 200, await store.buildStatus(id));
  if (request.method === 'GET' && url.pathname === `/api/pages/${id}`) return json(response, 200, await store.page(id));
  if (request.method === 'PUT' && url.pathname === `/api/pages/${id}`) {
    const payload = await body(request);
    return json(response, 200, await store.updatePage(id, payload.source, payload.baseHash));
  }
  if (request.method === 'POST' && url.pathname.endsWith('/turn')) {
    const payload = await body(request);
    if (typeof payload.message !== 'string' || !payload.message.trim() || payload.message.length > 12_000) throw new Error('A concise message is required.');
    const userTurn = await store.appendTurn(id, { role: 'user', message: payload.message.trim() });
    const [book, page, priorTurns] = await Promise.all([store.book(), store.page(id), store.turns(id)]);
    const result = await requestPageRevision({ book, page, turns: priorTurns, message: userTurn.message });
    const assistantTurn = await store.appendTurn(id, { role: 'assistant', commentary: result.commentary, availability: result.availability });
    const proposal = result.proposal ? await store.createProposal(id, result.proposal) : null;
    return json(response, 200, { userTurn, assistantTurn, proposal, availability: result.availability });
  }
  if (request.method === 'POST' && url.pathname.endsWith('/proposal/accept')) {
    const payload = await body(request);
    return json(response, 200, await store.acceptProposal(id, payload.proposalId));
  }
  if (request.method === 'POST' && url.pathname.endsWith('/proposal/reject')) {
    const payload = await body(request);
    return json(response, 200, await store.rejectProposal(id, payload.proposalId));
  }
  if (request.method === 'POST' && url.pathname.endsWith('/build')) {
    const [page, book] = await Promise.all([store.page(id), store.book()]);
    const result = await buildPage(store, page, book);
    return json(response, result.ok ? 200 : 422, await store.recordBuild(id, result, page.hash));
  }
  return false;
}

await defaultStore.initialize();
http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || '127.0.0.1'}`);
  try {
    if (mountedAt && url.pathname === mountedAt) {
      response.writeHead(308, { location: `${mountedAt}/${url.search}` }); response.end(); return;
    }
    if (mountedAt) {
      if (!url.pathname.startsWith(`${mountedAt}/`)) { json(response, 404, { error: 'Not found.' }); return; }
      url.pathname = url.pathname.slice(mountedAt.length) || '/';
    }
    // Suite settings belong to the gateway, not to a book.
    const relay = { 'GET /api/settings/models': ['GET', '/v1/settings/models'], 'PUT /api/settings/models': ['PUT', '/v1/settings/models'], 'GET /api/settings/model-catalog': ['GET', '/v1/models/catalog'] }[`${request.method} ${url.pathname}`];
    if (relay) { const result = await gatewaySettings(relay[0], relay[1], relay[0] === 'PUT' ? await body(request) : undefined); return json(response, result.status, result.body); }
    if (request.method === 'GET' && url.pathname === '/api/books') return json(response, 200, await availableBooks());
    if (request.method === 'GET' && url.pathname === '/api/stex/projects') return json(response, 200, await projectSummaries());
    if (request.method === 'POST' && url.pathname === '/api/books') return json(response, 201, await createBookProject(await body(request)));
    if (url.pathname.startsWith('/api/')) {
      const activeStore = await storeFor(url);
      const handled = await api(request, response, url, activeStore);
      if (handled === false) json(response, 404, { error: 'Unknown API route.' });
      return;
    }
    if (url.pathname === '/runtime-config.js') {
      response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
      response.end(`globalThis.STEX_SHELL_URL=${JSON.stringify(shellUrl)};`); return;
    }
    const vendored = url.pathname.match(/^\/vendor\/pdfjs\/([a-z.]+)$/)?.[1];
    if (vendored) { const file = pdfjsFiles.has(vendored) && pdfjsFile(vendored); return file ? serveFile(response, file) : json(response, 404, { error: 'Not found.' }); }
    const requested = url.pathname === '/' && !url.searchParams.get('book') && !url.searchParams.get('project') ? '/lobby.html' : url.pathname === '/' ? '/index.html' : url.pathname;
    const file = path.resolve(publicDirectory, `.${requested}`);
    if (!file.startsWith(`${publicDirectory}${path.sep}`)) return json(response, 403, { error: 'Invalid path.' });
    await serveFile(response, file);
  } catch (error) {
    json(response, error.code === 'STALE_SOURCE' || error.code === 'STALE_PROPOSAL' || error.code === 'ALREADY_ANSWERED' ? 409 : error.code === 'HERMES_UNAVAILABLE' ? 503 : 400, { error: error.message || 'Unexpected server error.' });
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`Frige Studio is ready at http://127.0.0.1:${port}${mountedAt || '/'}`);
  console.log(`Book project: ${projectDirectory}`);
});
