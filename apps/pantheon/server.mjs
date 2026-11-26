/** Pantheon HTTP entry point for shell pages, mounted workspaces, and loopback proxies. */
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pipeline } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { deferredStudioPage, homePage, projectsPage, studiosPage, tabs, unbuiltPage, developmentPage, publishingPage, directorPage, graphPage } from './src/pages.mjs';
import { bindAddress, internalHosts, isLoopbackHost, localProxyTarget, mountedApplication, platformPath, proxyApplication, requestPlatform, shellApplications, validateRegistry } from './src/shell.mjs';
import { openKnowledgeLibrary } from '../../services/knowledge/src/library.mjs';
import { ACTOR_RECEIVERS, actorHeaders, actorSecret, stripActorHeaders } from './src/actor.mjs';
import { knowledgeApi } from './src/knowledge-api.mjs';
import { knowledgeRelay } from './src/knowledge-relay.mjs';
import { createHostedGate, createIgorSessionCheck, hostedConfig, HostedRefusal, withoutIgorSession } from './src/hosted.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const publicDirectory = path.join(directory, 'public');
const publishingDirectory = path.join(directory, 'workspaces', 'frige');
const publishingTemplates = {
  library: await readFile(path.join(publishingDirectory, 'lobby.html'), 'utf8'),
  workstation: await readFile(path.join(publishingDirectory, 'index.html'), 'utf8'),
};
const publishingAssets = new Set(['app.js', 'base-path.js', 'history.js', 'lobby.css', 'lobby.js', 'line-diff.js', 'proof-viewer.js', 'sessions.js', 'style.css', 'thread.js', 'workspace.js']);
const port = Number(process.env.STEX_PANTHEON_PORT || 4300);
const registryFile = path.join(directory, '..', '..', 'protocol', 'applications', 'registry.v2.json');
let applications = shellApplications;
try { applications = validateRegistry(JSON.parse(await readFile(registryFile, 'utf8'))); }
catch (error) { console.warn(`Pantheon is using its built-in registry fallback: ${error.message}`); }
// A host may defer an otherwise active application (for example Seaxneat until its
// generated-code processes have an OS boundary): it then renders the honest deferred
// page and is never proxied. Only known application ids are accepted.
const deferredHere = new Set(String(process.env.STEX_PANTHEON_DEFERRED || '').split(',').map((id) => id.trim()).filter(Boolean));
for (const id of deferredHere) if (!applications.some((entry) => entry.id === id) || id === 'igor') throw new Error(`STEX_PANTHEON_DEFERRED names an unknown or required application: ${id}`);
if (deferredHere.size) applications = Object.freeze(applications.map((entry) => (deferredHere.has(entry.id) ? Object.freeze({ ...entry, state: 'deferred' }) : entry)));
// Container deployments name their fixed peers (STEX_INTERNAL_HOSTS) and bind all
// interfaces (STEX_BIND_ALL=1); native defaults stay loopback-only.
const internal = internalHosts(process.env.STEX_INTERNAL_HOSTS);
const listenAddress = bindAddress(process.env.STEX_BIND_ALL);
const proxyTargets = {
  frige: localProxyTarget(process.env.STEX_FRIGE_URL, 'http://127.0.0.1:4310', internal),
  seaxneat: localProxyTarget(process.env.STEX_SEAXNEAT_URL, 'http://127.0.0.1:4320', internal),
  igor: localProxyTarget(process.env.STEX_IGOR_URL, 'http://127.0.0.1:4330', internal),
};
const platformTarget = localProxyTarget(process.env.STEX_PLATFORM_URL, 'http://127.0.0.1:4340', internal);
// Hosted mode (STEX_PANTHEON_PUBLIC_ORIGIN): Igor's password accounts are the
// one sign-in; every public request outside Igor's own sign-in route needs a
// session Igor confirms. An invalid public origin stops startup.
const hosted = hostedConfig(process.env);
// The hosted gate admits a loopback probe without a session on a native host only. Bound to
// every interface (a container), a peer could claim a loopback Host, so that exemption is off
// and health probes use /healthz, which reports liveness and nothing else.
const containerMode = listenAddress !== '127.0.0.1';
const admitHosted = hosted ? createHostedGate(hosted, { port, loopbackExempt: !containerMode, checkSession: createIgorSessionCheck(proxyTargets.igor, `127.0.0.1:${port}`) }) : null;
// stex.platform.actor.v1 sender (D-028). The secret is validated here so a short
// one refuses startup. Hosted without it sends no actor, so engines cannot
// attribute requests to a person: that is allowed but warned about.
const platformActorSecret = actorSecret(process.env);
if (hosted && !platformActorSecret) console.warn('STEX_PLATFORM_ACTOR_SECRET is not set: hosted Pantheon will not tell the engines who is signed in, so they cannot attribute requests to a person.');
const mime = {
  '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.avif': 'image/avif', '.mp4': 'video/mp4', '.webm': 'video/webm', '.woff2': 'font/woff2',
};
// Knowledge is personal state (D-028). Two paths, chosen at startup:
// - STEX_KNOWLEDGE_SERVICE=platform: the Python platform API owns the journals
//   (backend/stex/knowledge). Pantheon only checks the browser origin and relays
//   the request with the admitted actor; it never opens or writes a journal, so a
//   journal directory configured here as well is refused (two writers).
// - unset (native default): the in-process library, exactly as before.
const knowledgeService = process.env.STEX_KNOWLEDGE_SERVICE || '';
if (!['', 'platform'].includes(knowledgeService)) throw new Error('STEX_KNOWLEDGE_SERVICE must be "platform" or unset.');
if (knowledgeService === 'platform' && process.env.STEX_KNOWLEDGE_DATA_DIR) throw new Error('STEX_KNOWLEDGE_DATA_DIR belongs to the platform API when STEX_KNOWLEDGE_SERVICE=platform; unset it for Pantheon.');
let knowledgeRoute;
if (knowledgeService === 'platform') knowledgeRoute = knowledgeRelay({ target: platformTarget, hosted: Boolean(hosted) });
else {
  const knowledge = await openKnowledgeLibrary({ directory: process.env.STEX_KNOWLEDGE_DATA_DIR || '', hosted: Boolean(hosted), legacyOwner: process.env.STEX_KNOWLEDGE_LEGACY_OWNER || '' });
  // Deferred studios get no target, so the knowledge API never contacts them.
  knowledgeRoute = knowledgeApi({ library: knowledge, targets: Object.fromEntries(Object.entries(proxyTargets).filter(([id]) => !deferredHere.has(id))) });
}
// The shared design system is served from its own package; only its public folders are reachable.
const designSystemDirectory = path.dirname(createRequire(import.meta.url).resolve('@stex/design-system/package.json'));
const designSystemFolders = new Set(['src', 'fonts', 'brand', 'icons', 'specimen']);
const pages = {
  /** Renders the command center for the shell route. */
  '/home/': () => homePage(applications),
  /** Renders the combined project library. */
  '/projects/': () => projectsPage(),
  /** Renders the studio navigation page. */
  '/studios/': () => studiosPage(applications),
  /** Renders the optional knowledge view using journal availability. */
  '/graph/': () => graphPage(),
  /** Renders the deferred activity view. */
  '/activity/': () => unbuiltPage('activity'),
  /** Renders the website workspace entry document. */
  '/workspaces/seaxneat/': () => developmentPage(),
};
/** Sends the route result with its selected status and response headers. */
function send(response, status, value) { response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); response.end(JSON.stringify(value)); }
/** Sends a shell document with its HTML and security headers. */
function sendPage(response, html, headers = {}) { response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers }); response.end(html); }

// Static files revalidate by ETag and honour a single byte range, which browsers
// (Safari in particular) require before they will play <video>.
/** Streams a static file with the server's content and cache headers. */
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

/** Resolves a permitted public design-system resource. */
function designSystemFile(pathname) {
  const relative = pathname.slice('/design-system/'.length);
  const file = path.resolve(designSystemDirectory, relative.endsWith('/') || !relative ? `${relative}index.html` : relative);
  const folder = path.relative(designSystemDirectory, file).split(path.sep)[0];
  return file.startsWith(`${designSystemDirectory}${path.sep}`) && designSystemFolders.has(folder) ? file : null;
}

http.createServer(async (request, response) => {
  // The actor headers are Pantheon's alone to set: drop any a client sent, in every mode, before routing.
  stripActorHeaders(request.headers);
  // Container probes: liveness only, no data, no session, nothing proxied.
  if (containerMode && request.url === '/healthz' && request.method === 'GET') { send(response, 200, { status: 'ok' }); return; }
  let user = null;
  // Refused before routing: the proxy would otherwise lend a rebound page a loopback Host.
  if (admitHosted) {
    try { ({ user } = await admitHosted(request)); }
    catch (error) {
      if (error instanceof HostedRefusal && error.location) { response.writeHead(error.status, { location: error.location, 'cache-control': 'no-store' }); response.end(); return; }
      send(response, error instanceof HostedRefusal ? error.status : 403, { error: error instanceof HostedRefusal ? error.message : 'Request refused.' }); return;
    }
  } else if (!isLoopbackHost(request.headers.host)) { send(response, 403, { error: 'Pantheon answers only on its local address.' }); return; }
  const url = new URL(request.url, `http://${request.headers.host}`);
  // Set only on requests proxied to an engine (never Igor), only for an admitted signed-in user, only with the secret.
  const actor = hosted ? actorHeaders(user, platformActorSecret) : null;
  try {
    if (url.pathname === '/api/knowledge/v1' || url.pathname.startsWith('/api/knowledge/v1/')) return await knowledgeRoute(request, response, url, { user: hosted ? user : null, actor });
    if (url.pathname === '/api/platform/v1' || url.pathname.startsWith('/api/platform/v1/')) {
      const upstreamPath = platformPath(url.pathname);
      if (!upstreamPath) return send(response, 404, { error: 'Not found.' });
      if (!['GET', 'HEAD'].includes(request.method)) return send(response, 405, { error: 'Method not allowed.' });
      let reply;
      try { reply = await requestPlatform(platformTarget, upstreamPath); }
      catch { return send(response, 502, { error: 'The platform API is not available locally.' }); }
      response.writeHead(reply.status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
      response.end(request.method === 'HEAD' ? undefined : reply.body);
      return;
    }
    if (url.pathname === '/igor') { response.writeHead(308, { location: `/igor/${url.search}` }); response.end(); return; }
    // Igor's page routes are composed here; everything else under /igor/ (its API and
    // assets) is proxied below. /igor/team is the shared Company screen (Wave 4a); its
    // query (for example ?app=frige) is read by Igor's renderer, not by Pantheon.
    const companyRoute = /^\/igor\/team\/?$/.test(url.pathname);
    if (companyRoute || ['/igor/', '/igor/new'].includes(url.pathname) || /^\/igor\/c\/[^/]+\/?$/.test(url.pathname)) {
      if (!['GET', 'HEAD'].includes(request.method)) return send(response, 405, { error: 'Method not allowed.' });
      return sendPage(response, directorPage({ view: companyRoute ? 'company' : 'conversations' }), { 'content-security-policy': "img-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'self'" });
    }
    if (url.pathname === '/frige') { response.writeHead(308, { location: `/frige/${url.search}` }); response.end(); return; }
    if (url.pathname === '/frige/' && ['GET', 'HEAD'].includes(request.method)) {
      const workstation = Boolean(url.searchParams.get('book') || url.searchParams.get('project'));
      return sendPage(response, publishingPage(publishingTemplates[workstation ? 'workstation' : 'library'], workstation));
    }
    if (url.pathname.startsWith('/frige/') && publishingAssets.has(url.pathname.slice('/frige/'.length))) {
      return await staticFile(request, response, path.join(publishingDirectory, url.pathname.slice('/frige/'.length)));
    }
    if (deferredHere.has('seaxneat') && (url.pathname.startsWith('/workspaces/seaxneat') || url.pathname.startsWith('/workspace-assets/seaxneat'))) {
      const seaxneat = applications.find((entry) => entry.id === 'seaxneat');
      return sendPage(response, deferredStudioPage(seaxneat, shellApplications.find((entry) => entry.id === 'seaxneat')?.description || ''));
    }
    if (url.pathname === '/seaxneat' || url.pathname === '/seaxneat/' || url.pathname === '/workspaces/seaxneat') {
      response.writeHead(308, { location: `/workspaces/seaxneat/${url.search}` }); response.end(); return;
    }
    if (url.pathname.startsWith('/workspace-assets/')) {
      const name = url.pathname.slice('/workspace-assets/'.length);
      if (!['seaxneat.js', 'seaxneat.css'].includes(name)) return send(response, 404, { error: 'Not found.' });
      return await staticFile(request, response, path.join(directory, 'dist', 'workspaces', name));
    }
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
    // Igor's session cookie goes to Igor alone, never to an engine or generated code.
    if (application?.id !== 'igor') {
      const cookie = withoutIgorSession(request.headers.cookie);
      if (cookie === undefined) delete request.headers.cookie; else request.headers.cookie = cookie;
    }
    if (application) {
      // Only an application that verifies the actor receives it: never Igor, never an engine that would ignore the token.
      if (actor && ACTOR_RECEIVERS.has(application.id)) Object.assign(request.headers, actor);
      try { await proxyApplication(request, response, proxyTargets[application.id], url, application.route); }
      catch (error) { if (!response.headersSent) send(response, error.message === 'Invalid application path.' || error.message?.startsWith('Invalid encoded') ? 400 : 502, { error: error.message === 'Invalid application path.' || error.message?.startsWith('Invalid encoded') ? error.message : `${application.name} is not available locally.` }); }
      return;
    }
    if (url.pathname === '/api/applications' && request.method === 'GET') return send(response, 200, { schemaVersion: 'stex.applications.registry.v2', applications });
    if (url.pathname === '/api/books' || url.pathname.startsWith('/api/books/')) {
      const upstream = new URL(url);
      upstream.pathname = '/frige/api/stex/legacy-books/v1' + url.pathname.slice('/api/books'.length);
      if (actor) Object.assign(request.headers, actor);
      try { await proxyApplication(request, response, proxyTargets.frige, upstream, '/frige/'); }
      catch { if (!response.headersSent) send(response, 502, { error: 'Frige is not available locally.' }); }
      return;
    }
    const tab = tabs.find((entry) => url.pathname === entry.route.slice(0, -1));
    if (tab) { response.writeHead(308, { location: `${tab.route}${url.search}` }); response.end(); return; }
    if (pages[url.pathname] && ['GET', 'HEAD'].includes(request.method)) return sendPage(response, pages[url.pathname]());
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
}).listen(port, listenAddress, () => console.log(`Pantheon is ready at http://127.0.0.1:${port}${listenAddress === '127.0.0.1' ? '' : ` (bound to ${listenAddress} inside its container)`}${hosted ? ` (hosted at ${hosted.publicOrigin}; Igor sign-in required)` : ''}`));
