import { createReadStream } from 'node:fs';
import { access, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SeaxneatStore } from './src/project-store.mjs';
import { previewPath, previewTarget } from './src/preview-proxy.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.SEAXNEAT_PORT || 4320);
const basePath = (process.env.SEAXNEAT_BASE_PATH || '/seaxneat').replace(/\/$/, '');
const dataDirectory = path.resolve(process.env.STEX_SEAXNEAT_DATA_DIR || path.join(directory, '.local-data'));
const publicDirectory = path.join(directory, 'dist');
const fallbackPublic = path.join(directory, 'public');
const previews = new Map();
const corepackEntry = path.join(path.dirname(process.execPath), 'node_modules', 'corepack', 'dist', 'corepack.js');
const previewStarter = async ({ project, workspace }) => {
  const existing = previews.get(project.id); if (existing && !existing.killed) return { state: 'running', target: existing.target };
  const port = 4400 + (parseInt(createHash('sha256').update(project.id).digest('hex').slice(0, 4), 16) % 1000);
  const args = ['pnpm', 'exec', 'next', 'start', '--hostname', '127.0.0.1', '--port', String(port)];
  const env = { ...process.env, NEXT_BASE_PATH: `/seaxneat/api/projects/${project.id}/preview` };
  const child = process.platform === 'win32'
    ? spawn(process.execPath, [corepackEntry, ...args], { cwd: workspace, windowsHide: true, stdio: 'ignore', env })
    : spawn('corepack', args, { cwd: workspace, windowsHide: true, stdio: 'ignore', env });
  const target = `http://127.0.0.1:${port}`;
  child.on('error', () => previews.delete(project.id));
  child.on('exit', () => previews.delete(project.id)); previews.set(project.id, { child, target }); return { state: 'starting', target };
};
function stopPreviews() {
  for (const { child } of previews.values()) if (child && !child.killed) child.kill();
  previews.clear();
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { stopPreviews(); process.exit(0); });
const store = await new SeaxneatStore({ root: dataDirectory, previewStarter }).initialize();
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8' };
function send(response, status, value) { response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); response.end(JSON.stringify(value)); }
async function body(request) { let raw = ''; for await (const chunk of request) { raw += chunk; if (raw.length > 200_000) throw new Error('Request too large.'); } try { return raw ? JSON.parse(raw) : {}; } catch { throw new Error('Request body must be JSON.'); } }
async function serve(response, relative) { const root = await access(publicDirectory).then(() => publicDirectory).catch(() => fallbackPublic); const file = path.resolve(root, `.${relative === '/' ? '/index.html' : relative}`); if (!file.startsWith(`${root}${path.sep}`)) return send(response, 403, { error: 'Invalid path.' }); try { await access(file); response.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream' }); createReadStream(file).pipe(response); } catch { if (relative.includes('.')) send(response, 404, { error: 'Not found.' }); else serve(response, '/'); } }
function proxyPreview(request, response, target, relative, search, mountPrefix) {
  const upstream = previewTarget(target); upstream.pathname = relative === undefined ? mountPrefix : `${mountPrefix}${previewPath(relative)}`; upstream.search = search || '';
  const relay = http.request(upstream, { method: request.method, headers: { accept: request.headers.accept || '*/*' } }, (upstreamResponse) => {
    const headers = {}; for (const name of ['content-type', 'cache-control', 'content-length']) if (upstreamResponse.headers[name]) headers[name] = upstreamResponse.headers[name]; response.writeHead(upstreamResponse.statusCode || 502, headers); upstreamResponse.pipe(response);
  }); relay.on('error', () => send(response, 502, { error: 'The local preview is unavailable.', code: 'PREVIEW_UNAVAILABLE' })); relay.end();
}
const server = http.createServer(async (request, response) => { const url = new URL(request.url, `http://${request.headers.host}`); const pathname = url.pathname === basePath ? '/' : url.pathname.startsWith(`${basePath}/`) ? url.pathname.slice(basePath.length) : url.pathname; try {
  if (pathname === '/api/health') return send(response, 200, { ok: true, dataDirectory, vault: 'disabled', transport: 'deterministic' });
  if (pathname === '/api/projects' && request.method === 'GET') return send(response, 200, store.list());
  if (pathname === '/api/projects' && request.method === 'POST') return send(response, 201, await store.create(await body(request)));
  const previewMatch = /^\/api\/projects\/([a-z0-9][a-z0-9-]{0,62})\/preview(?:\/(.*))?$/.exec(pathname);
  if (previewMatch && ['GET', 'HEAD'].includes(request.method)) { const project = store.get(previewMatch[1]); return proxyPreview(request, response, project.preview?.target, previewMatch[2], url.search, `${basePath}/api/projects/${project.id}/preview`); }
  const match = /^\/api\/projects\/([a-z0-9][a-z0-9-]{0,62})(?:\/(proposal|apply|dismiss|diff|restore|preview))?$/.exec(pathname);
  if (match) { const [, id, action] = match; if (!action && request.method === 'GET') return send(response, 200, store.summary(store.get(id))); const payload = await body(request);
    if (action === 'proposal' && request.method === 'POST') return send(response, 201, await store.proposal(id, payload));
    if (action === 'apply' && request.method === 'POST') return send(response, 200, await store.apply(id, payload.proposalId));
    if (action === 'dismiss' && request.method === 'POST') return send(response, 200, await store.dismiss(id, payload.proposalId));
    if (action === 'diff' && request.method === 'GET') return send(response, 200, { diff: await store.diff(id, url.searchParams.get('revision')) });
    if (action === 'restore' && request.method === 'POST') return send(response, 200, await store.restore(id, payload.revision));
    if (action === 'preview' && request.method === 'POST') { const project = store.get(id); const build = await store.build(project); if (!build.ok) throw Object.assign(new Error('The workspace did not build; preview was not started.'), { code: 'BUILD_FAILED' }); return send(response, 200, await store.startPreview(id)); }
  }
  return serve(response, pathname);
} catch (error) { send(response, error.code === 'BUILD_FAILED' ? 422 : 400, { error: error.message || 'Request failed.', code: error.code || 'INVALID_REQUEST' }); } });
server.listen(port, '127.0.0.1', () => console.log(`Seaxneat is ready at http://127.0.0.1:${port}`));
