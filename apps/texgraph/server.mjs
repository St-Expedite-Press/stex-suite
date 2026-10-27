import { createReadStream } from 'node:fs';
import { access, readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BookStore } from './src/project-store.mjs';
import { buildPage } from './src/lualatex.mjs';
import { requestPageRevision } from './src/inference-client.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const publicDirectory = path.join(directory, 'public');
const projectDirectory = path.resolve(process.env.TEXGRAPH_PROJECT_DIR || path.join(directory, '.local-book'));
const projectsDirectory = path.resolve(process.env.TEXGRAPH_PROJECTS_DIR || path.join(directory, '..', 'lab', '.local-projects'));
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
    if (raw.length > 250_000) throw new Error('Request is too large.');
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

async function api(request, response, url, store) {
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
    const page = await store.page(id);
    const result = await buildPage(store, page);
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
