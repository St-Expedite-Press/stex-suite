/** Seaxneat HTTP entry point for workspace operations and isolated preview processes. */
import { execFileSync, spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SeaxneatStore } from './src/project-store.mjs';
import { workspaceEnvironment } from './src/child-environment.mjs';
import { PREVIEW_CONTENT_SECURITY_POLICY, previewPath, previewTarget } from './src/preview-proxy.mjs';
import { candidatePorts, firstFreePort, portInUse } from './src/preview-port.mjs';
import { workspaceApi } from './src/workspace-api.mjs';
import { projectContext } from './src/project-context.mjs';
import { knowledgeEvent } from './src/knowledge-event.mjs';
import { projectSummaries } from './src/project-summary.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.SEAXNEAT_PORT || 4320);
const basePath = (process.env.SEAXNEAT_BASE_PATH || '/seaxneat').replace(/\/$/, '');
const dataDirectory = path.resolve(process.env.STEX_SEAXNEAT_DATA_DIR || path.join(directory, '.local-data'));
const platformOrigin = new URL(process.env.STEX_PANTHEON_URL || 'http://127.0.0.1:4300');
if (platformOrigin.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(platformOrigin.hostname) || platformOrigin.username || platformOrigin.password || platformOrigin.pathname !== '/' || platformOrigin.search || platformOrigin.hash) throw new Error('STEX_PANTHEON_URL must be a loopback HTTP origin.');
const previews = new Map();
const corepackEntry = path.join(path.dirname(process.execPath), 'node_modules', 'corepack', 'dist', 'corepack.js');
/**
 * Terminates a preview child and everything it started.
 * WHY a tree kill: `corepack pnpm exec next start` runs `next` as a grandchild,
 * and killing only the direct child would leave the preview port bound and the
 * old build still being served.
 * @param {import('node:child_process').ChildProcess} child
 * @returns {Promise<void>} Resolves once the child exited or after a bounded wait.
 */
async function killPreviewTree(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  if (process.platform === 'win32') { try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); } catch { child.kill(); } }
  else { try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill(); } }
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5000))]);
}
/**
 * Spawns `next start` on one candidate port and waits for readiness.
 * @param {string} projectId
 * @param {string} workspacePath
 * @param {number} port
 * @returns {Promise<string>} The loopback target URL once the server is ready.
 * @throws {Error} With `addressInUse: true` when the port was taken after the probe (probe/bind race or foreign listener).
 */
function launchPreview(projectId, workspacePath, port) {
  const args = ['pnpm', 'exec', 'next', 'start', '--hostname', '127.0.0.1', '--port', String(port)];
  const env = workspaceEnvironment(projectId); // generated code never sees Seaxneat's environment
  // Non-Windows children get their own process group so a stop can signal the whole tree.
  const options = { cwd: workspacePath, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env, detached: process.platform !== 'win32' };
  const child = process.platform === 'win32' ? spawn(process.execPath, [corepackEntry, ...args], options) : spawn('corepack', args, options);
  const target = `http://127.0.0.1:${port}`;
  // Only forget the entry this child registered: an older child exiting after a restart must not unregister its replacement.
  const forget = () => { if (previews.get(projectId)?.child === child) previews.delete(projectId); };
  child.on('error', forget); child.on('exit', forget); previews.set(projectId, { child, target });
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => { void killPreviewTree(child); reject(new Error('Preview server did not become ready.')); }, 15000);
    /** Captures bounded preview process output for status reporting. */
    const collect = (data) => { output = (output + data).slice(-4000); if (/Ready in/.test(output)) { clearTimeout(timer); resolve(target); } };
    child.stdout.on('data', collect); child.stderr.on('data', collect);
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('exit', () => { clearTimeout(timer); reject(Object.assign(new Error(`Preview server stopped: ${output}`), { addressInUse: /EADDRINUSE|address already in use/i.test(output) })); });
  });
}
/**
 * Starts or reuses the selected workspace preview on a free loopback port.
 * Ports already held by another project or a foreign listener are skipped, and
 * a bind race (EADDRINUSE after the probe) moves on to the next candidate, all
 * inside a bounded range; exhaustion fails with `NO_PREVIEW_PORT`.
 */
const previewStarter = async ({ project, workspace }) => {
  const existing = previews.get(project.id); if (existing && existing.child.exitCode === null) return { state: 'running', target: existing.target };
  const skip = new Set(); let lastError;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const port = await firstFreePort(candidatePorts(project.id), portInUse, skip);
    try { return { state: 'running', target: await launchPreview(project.id, workspace, port) }; }
    catch (error) { lastError = error; skip.add(port); if (!error.addressInUse) throw error; }
  }
  throw lastError;
};
/** Stops one project's preview child; a no-op when none is running. */
const previewStopper = async ({ project }) => {
  const entry = previews.get(project.id); previews.delete(project.id);
  if (entry) await killPreviewTree(entry.child);
};
/** Stops the active preview children during engine shutdown. */
function stopPreviews() {
  for (const { child } of previews.values()) if (child.exitCode === null) { if (process.platform === 'win32') { try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); } catch { child.kill(); } } else { try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill(); } } }
  previews.clear();
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { stopPreviews(); process.exit(0); });
const store = await new SeaxneatStore({ root: dataDirectory, previewStarter, previewStopper }).initialize();
/** Sends the route result with its selected status and response headers. */
function send(response, status, value) { response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); response.end(JSON.stringify(value)); }
/** Reads and validates a bounded JSON request body. */
async function body(request) { let raw = ''; for await (const chunk of request) { raw += chunk; if (raw.length > 200_000) throw new Error('Request too large.'); } try { return raw ? JSON.parse(raw) : {}; } catch { throw new Error('Request body must be JSON.'); } }
/** Streams the preview response through the sandboxed mount. */
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
    const headers = {}; for (const name of ['content-type', 'cache-control', 'content-length']) if (upstreamResponse.headers[name]) headers[name] = upstreamResponse.headers[name]; headers['content-security-policy'] = PREVIEW_CONTENT_SECURITY_POLICY; headers['x-content-type-options'] = 'nosniff'; response.writeHead(upstreamResponse.statusCode || 502, headers); upstreamResponse.pipe(response);
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
  if (pathname.startsWith('/api/stex/context/v1/')) {
    const observation = /^\/api\/stex\/context\/v1\/projects\/([a-z0-9][a-z0-9-]{0,62})\/observation$/.exec(pathname);
    if (observation && request.method === 'POST') return send(response, 200, await knowledgeEvent(store, observation[1], await body(request)));
    const match = /^\/api\/stex\/context\/v1\/projects\/([a-z0-9][a-z0-9-]{0,62})(?:\/sources\/(page|layout|styles))?$/.exec(pathname);
    if (!match) return send(response, 404, { code: 'NOT_FOUND', error: 'Unknown project context route.' });
    if (request.method !== 'GET') { response.setHeader('allow', 'GET'); return send(response, 405, { error: 'Method not allowed.' }); }
    return send(response, 200, await projectContext(store, match[1], { sourceId: match[2], revision: url.searchParams.get('revision') }));
  }
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
} catch (error) { send(response, error.status || (error.code === 'BUILD_FAILED' ? 422 : 400), { error: error.message || 'Request failed.', code: error.code || 'INVALID_REQUEST' }); } });
server.listen(port, '127.0.0.1', () => console.log(`Seaxneat is ready at http://127.0.0.1:${port}`));
