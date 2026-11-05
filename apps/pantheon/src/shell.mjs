import http from 'node:http';

export const shellApplications = Object.freeze([
  { id: 'frige', name: 'Frige', route: '/frige/', state: 'active', description: 'Books, proofs, and publishing' },
  { id: 'seaxneat', name: 'Seaxneat', route: '/seaxneat/', state: 'active', description: 'Websites and source revisions' },
  { id: 'eostre', name: 'Eostre', route: '/eostre/', state: 'deferred', description: 'Visual work and print production' },
  { id: 'woden', name: 'Woden', route: '/woden/', state: 'deferred', description: 'Narrative structure and manuscripts' },
]);

export function validateRegistry(value) {
  const applications = value?.schemaVersion === 'stex.applications.registry.v1' && Array.isArray(value.applications) ? value.applications : null;
  if (!applications || applications.length !== 4) throw new Error('The STEX application registry is invalid.');
  const ids = new Set();
  for (const application of applications) {
    if (!application || !['frige', 'seaxneat', 'eostre', 'woden'].includes(application.id) || ids.has(application.id) || typeof application.name !== 'string' || !/^\/[a-z]+\/$/.test(application.route) || !['active', 'deferred'].includes(application.state) || !Array.isArray(application.referenceKinds)) throw new Error('The STEX application registry is invalid.');
    ids.add(application.id);
  }
  return Object.freeze(applications.map((application) => Object.freeze({ ...application })));
}

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
  const headers = { ...request.headers, host: target.host, 'x-forwarded-prefix': prefix.slice(0, -1) };
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

// Registry names stay ASCII; the interface shows the correct spelling.
const displayNames = { eostre: 'Ēostre' };

export function deferredPage(application) {
  const name = displayNames[application.id] || application.name;
  // The versioned registry carries no description, so it comes from the built-in identities.
  const description = shellApplications.find((entry) => entry.id === application.id)?.description || '';
  return `<!doctype html><html lang="en" data-stex-app="${application.id}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${name} · STEX Pantheon</title><link rel="icon" href="/design-system/brand/pantheon-favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/design-system/src/stex.css"><link rel="stylesheet" href="/home/home.css"></head><body><main class="home"><a class="home-back" href="/home/">← Studios</a><h1 class="home-title">${name}</h1><p class="home-lede">${description}</p><p class="stex-meta">This application is registered in the STEX alpha but is not implemented yet.</p></main></body></html>`;
}
