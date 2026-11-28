/** Pantheon server source that implements shell navigation and validates server-side integration routes. */
import http from 'node:http';

// Mirrors protocol/applications/registry.v2.json; used only when it cannot be read.
export const shellApplications = Object.freeze([
  { id: 'frige', name: 'Frige', kind: 'studio', route: '/frige/', state: 'active', description: 'Books, proofs, and publishing' },
  { id: 'seaxneat', name: 'Seaxneat', kind: 'studio', route: '/seaxneat/', state: 'active', description: 'Websites and source revisions' },
  { id: 'eostre', name: 'Eostre', kind: 'studio', route: '/eostre/', state: 'deferred', description: 'Visual work and print production' },
  { id: 'woden', name: 'Woden', kind: 'studio', route: '/woden/', state: 'deferred', description: 'Narrative structure and manuscripts' },
  { id: 'igor', name: 'Igor', kind: 'application', route: '/igor/', state: 'active', description: 'Conversations with the Pantheon Director' },
]);

const registryIds = ['frige', 'seaxneat', 'eostre', 'woden', 'igor'];

/** Validates the route identities and runtime-safe application registry values. */
export function validateRegistry(value) {
  const applications = value?.schemaVersion === 'stex.applications.registry.v2' && Array.isArray(value.applications) ? value.applications : null;
  if (!applications || applications.length !== registryIds.length) throw new Error('The STEX application registry is invalid.');
  const ids = new Set();
  for (const application of applications) {
    if (!application || !registryIds.includes(application.id) || ids.has(application.id) || typeof application.name !== 'string' || !['studio', 'application'].includes(application.kind) || !/^\/[a-z]+\/$/.test(application.route) || !['active', 'deferred'].includes(application.state) || !Array.isArray(application.referenceKinds)) throw new Error('The STEX application registry is invalid.');
    ids.add(application.id);
  }
  return Object.freeze(applications.map((application) => Object.freeze({ ...application })));
}

// Pantheon listens on 127.0.0.1 only, so any other Host is a DNS-rebound page.
const loopbackHost = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/;
/** Checks whether a request targets a permitted local host. */
export const isLoopbackHost = (value) => loopbackHost.test(String(value || ''));

/**
 * Parses STEX_INTERNAL_HOSTS: the fixed peer service names of a container
 * deployment (for example `frige,platform` in deploy/compose). Each name is a
 * single DNS label; nothing else is accepted. Empty (the native default)
 * means loopback only, exactly as before.
 *
 * @param {string | undefined} value  Comma-separated service names.
 * @returns {ReadonlySet<string>}  The permitted peer hostnames.
 * @throws {Error} when a name is not a single lowercase DNS label.
 */
export function internalHosts(value) {
  const names = String(value || '').split(',').map((name) => name.trim()).filter(Boolean);
  for (const name of names) if (!/^[a-z][a-z0-9-]{0,62}$/.test(name) || name === 'localhost') throw new Error(`STEX_INTERNAL_HOSTS contains an invalid service name: ${name}`);
  return Object.freeze(new Set(names));
}

/**
 * Chooses the listen address. Native runs keep 127.0.0.1. `STEX_BIND_ALL=1`
 * binds every interface, for use inside a container whose port is published
 * only to the host's loopback; any other value is refused.
 *
 * @param {string | undefined} value  STEX_BIND_ALL.
 * @returns {'127.0.0.1' | '0.0.0.0'}
 */
export function bindAddress(value) {
  if (value === undefined || value === '' || value === '0') return '127.0.0.1';
  if (value === '1') return '0.0.0.0';
  throw new Error('STEX_BIND_ALL must be 1 or unset.');
}

/**
 * Accepts only a server-configured HTTP origin on loopback or on one of the
 * fixed internal service names. Browser input never reaches this function.
 *
 * @param {string | undefined} value  Configured origin.
 * @param {string} fallback  Native default origin.
 * @param {ReadonlySet<string>} [internal]  Permitted container peer names.
 * @returns {URL}
 */
export function localProxyTarget(value, fallback, internal = new Set()) {
  let target;
  try { target = new URL(value || fallback); } catch { throw new Error('The application proxy target is invalid.'); }
  if (target.protocol !== 'http:' || !(['127.0.0.1', 'localhost', '::1'].includes(target.hostname) || internal.has(target.hostname)) || target.username || target.password || target.pathname !== '/' || target.search || target.hash) {
    throw new Error('The application proxy target must be a loopback HTTP origin.');
  }
  return target;
}

/** Maps an eligible shell URL to its mounted application. */
export function mountedApplication(pathname, applications = shellApplications) {
  return applications.find((application) => pathname === application.route.slice(0, -1) || pathname.startsWith(application.route)) || null;
}

/** Validates a mounted path before it is forwarded upstream. */
function safeProxyPath(url, prefix) {
  if (!url.pathname.startsWith(prefix)) throw new Error('Invalid application path.');
  const suffix = url.pathname;
  let decoded;
  try { decoded = decodeURIComponent(suffix); } catch { throw new Error('Invalid encoded application path.'); }
  if (decoded.split('/').some((part) => part === '.' || part === '..')) throw new Error('Invalid application path.');
  return `${suffix}${url.search}`;
}

/** Streams a bounded request to its configured same-origin target. */
export function proxyApplication(request, response, target, url, prefix) {
  const requestPath = safeProxyPath(url, prefix);
  // x-forwarded-host lets an application match the browser's Origin to the shell's address.
  const headers = { ...request.headers, host: target.host, 'x-forwarded-host': request.headers.host || '', 'x-forwarded-prefix': prefix.slice(0, -1) };
  return new Promise((resolve, reject) => {
    const upstream = http.request({ protocol: target.protocol, hostname: target.hostname, port: target.port, method: request.method, path: requestPath, headers }, (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers);
      upstreamResponse.pipe(response);
      upstreamResponse.on('end', resolve);
    });
    upstream.once('error', reject);
    request.pipe(upstream);
  });
}

// Read-only routes into the Python platform API (backend/, protocol/platform).
// Only these exact paths are forwarded; nothing from the browser request except
// the method is passed on, so cookies and other headers never reach it.
const platformRoutes = new Map([['/api/platform/v1/projects', '/api/v1/projects']]);
/** Allows only the read-only project aggregation routes. */
export const platformPath = (pathname) => platformRoutes.get(pathname) || null;

export class PlatformUnavailable extends Error {}

// Only a 200 JSON answer is relayed; anything else (unreachable, timeout,
// redirect, other status, compressed or oversized body) is PlatformUnavailable.
/** Requests the platform API without inheriting browser authority. */
export async function requestPlatform(target, upstreamPath, { timeoutMs = 5_000, maxBytes = 4_000_000 } = {}) {
  const signal = AbortSignal.timeout(timeoutMs);
  let reply;
  try {
    reply = await fetch(new URL(upstreamPath, target), { headers: { accept: 'application/json', 'accept-encoding': 'identity' }, redirect: 'manual', signal });
  } catch { throw new PlatformUnavailable('The platform API is not reachable.'); }
  /** Sends the bounded failure response when the platform request cannot continue. */
  const refuse = async (reason) => { await reply.body?.cancel().catch(() => {}); throw new PlatformUnavailable(reason); };
  if (reply.status !== 200) return refuse(`The platform API answered ${reply.status}.`);
  if (!/^application\/json\b/i.test(reply.headers.get('content-type') || '')) return refuse('The platform API did not answer with JSON.');
  // Refusing any content-encoding keeps the bound on bytes actually received.
  if ((reply.headers.get('content-encoding') || 'identity').toLowerCase() !== 'identity') return refuse('The platform API answer is compressed.');
  if (Number(reply.headers.get('content-length') || 0) > maxBytes) return refuse('The platform API answer is too large.');
  const chunks = []; let size = 0;
  try {
    for await (const chunk of reply.body) {
      size += chunk.length;
      if (size > maxBytes) return refuse('The platform API answer is too large.');
      chunks.push(chunk);
    }
  } catch (error) {
    if (error instanceof PlatformUnavailable) throw error;
    throw new PlatformUnavailable('The platform API answer was interrupted.');
  }
  return { status: 200, body: Buffer.concat(chunks) };
}
