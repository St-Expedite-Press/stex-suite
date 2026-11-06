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
export const isLoopbackHost = (value) => loopbackHost.test(String(value || ''));

export function localProxyTarget(value, fallback) {
  let target;
  try { target = new URL(value || fallback); } catch { throw new Error('The application proxy target is invalid.'); }
  if (target.protocol !== 'http:' || !['127.0.0.1', 'localhost', '::1'].includes(target.hostname) || target.username || target.password || target.pathname !== '/' || target.search || target.hash) {
    throw new Error('The application proxy target must be a loopback HTTP origin.');
  }
  return target;
}

export function mountedApplication(pathname, applications = shellApplications) {
  return applications.find((application) => pathname === application.route.slice(0, -1) || pathname.startsWith(application.route)) || null;
}

function safeProxyPath(url, prefix) {
  if (!url.pathname.startsWith(prefix)) throw new Error('Invalid application path.');
  const suffix = url.pathname;
  let decoded;
  try { decoded = decodeURIComponent(suffix); } catch { throw new Error('Invalid encoded application path.'); }
  if (decoded.split('/').some((part) => part === '.' || part === '..')) throw new Error('Invalid application path.');
  return `${suffix}${url.search}`;
}

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
