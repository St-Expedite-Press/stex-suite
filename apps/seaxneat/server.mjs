import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SeaxneatStore } from './src/project-store.mjs';
import { previewPath, previewTarget } from './src/preview-proxy.mjs';
import { workspaceApi } from './src/workspace-api.mjs';
import { projectSummaries } from './src/project-summary.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.SEAXNEAT_PORT || 4320);
const basePath = (process.env.SEAXNEAT_BASE_PATH || '/seaxneat').replace(/\/$/, '');
const dataDirectory = path.resolve(process.env.STEX_SEAXNEAT_DATA_DIR || path.join(directory, '.local-data'));
const platformOrigin = new URL(process.env.STEX_PANTHEON_URL || 'http://127.0.0.1:4300');
if (platformOrigin.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(platformOrigin.hostname) || platformOrigin.username || platformOrigin.password || platformOrigin.pathname !== '/' || platformOrigin.search || platformOrigin.hash) throw new Error('STEX_PANTHEON_URL must be a loopback HTTP origin.');
const previews = new Map();
const corepackEntry = path.join(path.dirname(process.execPath), 'node_modules', 'corepack', 'dist', 'corepack.js');
const previewStarter = async ({ project, workspace }) => {
  const existing = previews.get(project.id); if (existing && !existing.child.killed) return { state: 'running', target: existing.target };
  const port = 4400 + (parseInt(createHash('sha256').update(project.id).digest('hex').slice(0, 4), 16) % 1000);
  const args = ['pnpm', 'exec', 'next', 'start', '--hostname', '127.0.0.1', '--port', String(port)];
  const env = { ...process.env, NEXT_BASE_PATH: `/seaxneat/api/projects/${project.id}/preview` };
  const child = process.platform === 'win32'
    ? spawn(process.execPath, [corepackEntry, ...args], { cwd: workspace, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env })
    : spawn('corepack', args, { cwd: workspace, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env });
  const target = `http://127.0.0.1:${port}`;
  child.on('error', () => previews.delete(project.id));
  child.on('exit', () => previews.delete(project.id)); previews.set(project.id, { child, target });
  await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('Preview server did not become ready.')); }, 15000);
    const collect = (data) => { output = (output + data).slice(-4000); if (/Ready in/.test(output)) { clearTimeout(timer); resolve(); } };
    child.stdout.on('data', collect); child.stderr.on('data', collect);
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('exit', () => { clearTimeout(timer); reject(new Error(`Preview server stopped: ${output}`)); });
  });
  return { state: 'running', target };
};
function stopPreviews() {
  for (const { child } of previews.values()) if (child && !child.killed) child.kill();
  previews.clear();
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { stopPreviews(); process.exit(0); });
const store = await new SeaxneatStore({ root: dataDirectory, previewStarter }).initialize();
function send(response, status, value) { response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); response.end(JSON.stringify(value)); }
async function body(request) { let raw = ''; for await (const chunk of request) { raw += chunk; if (raw.length > 200_000) throw new Error('Request too large.'); } try { return raw ? JSON.parse(raw) : {}; } catch { throw new Error('Request body must be JSON.'); } }
function proxyPreview(request, response, target, relative, search, mountPrefix) {
  const upstream = previewTarget(target); upstream.pathname = relative === undefined ? mountPrefix : `${mountPrefix}${previewPath(relative)}`; upstream.search = search || '';
  const relay = http.request(upstream, { method: request.method, headers: { accept: request.headers.accept || '*/*' } }, (upstreamResponse) => {
    if (upstreamResponse.headers.location) {
      let location;
      try { location = new URL(upstreamResponse.headers.location, upstream); } catch { /* Refuse malformed generated redirects. */ }
      if (!location || location.origin !== upstream.origin || (location.pathname !== mountPrefix && !location.pathname.startsWith(`${mountPrefix}/`))) {
        upstreamResponse.resume(); return send(response, 502, { code: 'PREVIEW_UNAVAILABLE', error: 'The preview redirected outside its project.' });
      }
      response.setHeader('location', `${location.pathname}${location.search}${location.hash}`);
    }
    if (request.headers.origin === 'null') response.setHeader('access-control-allow-origin', 'null');
    const headers = {}; for (const name of ['content-type', 'cache-control', 'content-length']) if (upstreamResponse.headers[name]) headers[name] = upstreamResponse.headers[name]; headers['content-security-policy'] = "sandbox allow-scripts; frame-ancestors 'self'"; headers['x-content-type-options'] = 'nosniff'; response.writeHead(upstreamResponse.statusCode || 502, headers); upstreamResponse.pipe(response);
  }); relay.on('error', () => send(response, 502, { error: 'The local preview is unavailable.', code: 'PREVIEW_UNAVAILABLE' })); relay.end();
}
const workspace = workspaceApi(store, { body, send });
const server = http.createServer(async (request, response) => { try {
  if (!/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(request.headers.host || '')) return send(response, 403, { code: 'FORBIDDEN', error: 'Seaxneat answers only on its local address.' });
  const url = new URL(request.url, `http://${request.headers.host}`);
  const pathname = url.pathname === basePath ? '/' : url.pathname.startsWith(`${basePath}/`) ? url.pathname.slice(basePath.length) : url.pathname;
  const origin = request.headers.origin;
  const previewRead = ['GET', 'HEAD'].includes(request.method) && /^\/api\/projects\/[a-z0-9][a-z0-9-]{0,62}\/preview(?:\/|$)/.test(pathname);
  const opaquePreviewRead = previewRead && (!origin || origin === 'null');
  if (!opaquePreviewRead && (request.headers['sec-fetch-site'] === 'cross-site' || (origin && origin !== `http://${request.headers.host}` && origin !== platformOrigin.origin))) return send(response, 403, { code: 'FORBIDDEN', error: 'Foreign browser origin refused.' });
  if (pathname === '/api/health') return send(response, 200, { ok: true, dataDirectory, vault: 'disabled', transport: 'deterministic' });
  if (pathname === '/api/stex/projects' && request.method === 'GET') return send(response, 200, projectSummaries(store.list()));
  const previewMatch = /^\/api\/projects\/([a-z0-9][a-z0-9-]{0,62})\/preview(?:\/(.*))?$/.exec(pathname);
  if (previewMatch && ['GET', 'HEAD'].includes(request.method)) { const project = store.get(previewMatch[1]); return proxyPreview(request, response, project.preview?.target, previewMatch[2], url.search, `${basePath}/api/projects/${project.id}/preview`); }
  if (pathname === '/api/projects' || pathname.startsWith('/api/projects/') || pathname === '/api/stex/workspace/v1' || pathname.startsWith('/api/stex/workspace/v1/')) {
    const routed = new URL(url); routed.pathname = pathname;
    return await workspace(request, response, routed);
  }
  if (pathname === '/' && ['GET', 'HEAD'].includes(request.method)) {
    const target = new URL('/workspaces/seaxneat/', platformOrigin); target.search = url.search;
    response.writeHead(308, { location: target.href }); response.end(); return;
  }
  return send(response, 404, { error: 'Not found.' });
} catch (error) { send(response, error.code === 'BUILD_FAILED' ? 422 : 400, { error: error.message || 'Request failed.', code: error.code || 'INVALID_REQUEST' }); } });
server.listen(port, '127.0.0.1', () => console.log(`Seaxneat is ready at http://127.0.0.1:${port}`));
