import { createReadStream } from 'node:fs';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BookStore } from './src/project-store.mjs';
import { ProjectStore } from './src/project-store-vault.mjs';
import { buildPage } from './src/lualatex.mjs';
import { buildBook } from './src/book-assembler.mjs';
import { requestPageRevision } from './src/inference-client.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const publicDirectory = path.join(directory, 'public');
const appEnvironment = new Set(['STEX_INFERENCE_URL', 'STEX_INFERENCE_SHARED_SECRET', 'TEXGRAPH_PORT', 'TEXGRAPH_PROJECT_DIR', 'TEXGRAPH_PROJECTS_DIR']);
try {
  const localEnv = await readFile(path.resolve(directory, '..', '..', '.env'), 'utf8');
  for (const line of localEnv.split(/\r?\n/)) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (match && appEnvironment.has(match[1]) && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
} catch { /* The host may provide application-safe configuration directly. */ }
const projectDirectory = path.resolve(process.env.TEXGRAPH_PROJECT_DIR || path.join(directory, '.local-book'));
const projectsDirectory = path.resolve(process.env.TEXGRAPH_PROJECTS_DIR || path.join(directory, '..', 'lab', '.local-projects'));
const booksDirectory = path.resolve(process.env.TEXGRAPH_BOOKS_DIR || path.join(directory, 'books'));
const defaultStore = new BookStore(projectDirectory);
const projectStores = new Map();
const port = Number(process.env.TEXGRAPH_PORT || 4310);

const mimeTypes = { '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.pdf': 'application/pdf' };

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
    if (!projectStores.has(`book:${bookId}`)) projectStores.set(`book:${bookId}`, new ProjectStore(bookRoot));
    const store = projectStores.get(`book:${bookId}`); await store.initialize(); return store;
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
  if (request.method === 'GET' && url.pathname === '/api/project/page-map') {
    try { return json(response, 200, JSON.parse(await readFile(path.join(store.buildDirectory(), 'page-map.json'), 'utf8'))); } catch { return json(response, 200, null); }
  }
  if (request.method === 'POST' && url.pathname === '/api/project/build') {
    const payload = await body(request);
    const result = await buildBook(store, { scopeId: payload.scopeId || 'book' }); return json(response, result.ok ? 200 : 422, await store.recordBuild(result));
  }
  if (!id) return false;
  if (request.method === 'GET' && url.pathname.endsWith('/turns')) return json(response, 200, await store.turns(id));
  if (request.method === 'GET' && url.pathname.endsWith('/proposal')) return json(response, 200, await store.proposal(id));
  if (request.method === 'GET' && url.pathname === `/api/nodes/${id}`) return json(response, 200, await store.node(id));
  if (request.method === 'PUT' && url.pathname === `/api/nodes/${id}`) { const payload = await body(request); return json(response, 200, await store.updateNode(id, payload.source, payload.baseHash)); }
  if (request.method === 'POST' && url.pathname.endsWith('/turn')) {
    const payload = await body(request); if (typeof payload.message !== 'string' || !payload.message.trim() || payload.message.length > 12_000) throw new Error('A concise message is required.');
    const scope = await store.scope(payload.scopeId || id);
    const userTurn = await store.appendTurn(id, { role: 'user', message: payload.message.trim() });
    const [node, graph, priorTurns, approvedSourceExcerpts, settings] = await Promise.all([store.node(id), store.graph({ refresh: true }), store.turns(id), store.approvedSourceExcerpts(), store.settingsTicket()]);
    const result = await requestPageRevision({ book: { title: path.basename(store.root), design: 'Programme-led manuscript vault', graph, settings, context: { scope } }, page: node, approvedSourceExcerpts, turns: priorTurns, message: userTurn.message });
    const assistantTurn = await store.appendTurn(id, { role: 'assistant', commentary: result.commentary, availability: result.availability });
    const proposal = scope.kind === 'node' && result.proposal ? await store.createProposal(id, result.proposal) : null;
    return json(response, 200, { userTurn, assistantTurn, proposal, availability: result.availability });
  }
  if (request.method === 'POST' && url.pathname.endsWith('/proposal/accept')) { const payload = await body(request); return json(response, 200, await store.acceptProposal(id, payload.proposalId)); }
  if (request.method === 'POST' && url.pathname.endsWith('/proposal/reject')) { const payload = await body(request); return json(response, 200, await store.rejectProposal(id, payload.proposalId)); }
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
    if (url.pathname.startsWith('/api/')) {
      const activeStore = await storeFor(url);
      const handled = await api(request, response, url, activeStore);
      if (handled === false) json(response, 404, { error: 'Unknown API route.' });
      return;
    }
    const requested = url.pathname === '/' ? '/index.html' : url.pathname;
    const file = path.resolve(publicDirectory, `.${requested}`);
    if (!file.startsWith(`${publicDirectory}${path.sep}`)) return json(response, 403, { error: 'Invalid path.' });
    await serveFile(response, file);
  } catch (error) {
    json(response, error.code === 'STALE_SOURCE' || error.code === 'STALE_PROPOSAL' ? 409 : 400, { error: error.message || 'Unexpected server error.' });
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`TexGraph Studio is ready at http://127.0.0.1:${port}`);
  console.log(`Book project: ${projectDirectory}`);
});
