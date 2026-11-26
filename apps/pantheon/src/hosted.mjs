/**
 * Pantheon hosted mode: Pantheon published at a public origin (through
 * Cloudflare Tunnel), with Igor's password accounts as the one sign-in.
 *
 * Pantheon's local splash "Sign in" is a credential-free single-user entry.
 * Hosted, Pantheon holds no credentials and implements no account store:
 * Igor owns accounts, passwords, sessions and sign-out. Pantheon composes Igor
 * at /igor/ exactly as it does locally, so Igor's sign-in page and session
 * cookie live on Pantheon's origin, and Pantheon asks Igor (over loopback,
 * GET /igor/api/session) whether each request is signed in. Without a valid
 * session nothing but Igor's own sign-in route is served, and Igor being
 * unreachable refuses requests rather than admitting them.
 *
 * An admitted public request is normalised to the loopback shape the rest of
 * Pantheon, Igor and the engines already enforce (loopback Host and Origin),
 * after its real Host and Origin have been checked against the public origin.
 */
import http from 'node:http';
import { isLoopbackHost } from './shell.mjs';

/** Igor's password-mode session cookie (host-only, Secure, HttpOnly). */
export const IGOR_SESSION_COOKIE = '__Host-igor_session';
const SESSION_CACHE_MS = 5_000;
const SESSION_CACHE_LIMIT = 200;
// Headers only Cloudflare's edge or a proxy adds: their presence means the request was not made on this machine.
const proxyHeaders = ['cf-connecting-ip', 'cf-ray', 'x-forwarded-for', 'x-forwarded-host'];

/** A refusal carrying the HTTP status (and optional redirect) Pantheon answers with. */
export class HostedRefusal extends Error {
  /**
   * @param {number} status  401 not signed in, 403 refused, 503 sign-in check unavailable, 303 sign in first.
   * @param {string} message  Visitor-safe explanation; never includes cookie or session content.
   * @param {string} [location]  Redirect target for a 303.
   */
  constructor(status, message, location) { super(message); this.status = status; this.location = location; }
}

/**
 * Reads hosted-mode settings.
 *
 * @param {Record<string, string | undefined>} env  Process environment.
 * @returns {null | { publicOrigin: string, publicHost: string }}  null when Pantheon is local-only.
 * @throws {Error} when STEX_PANTHEON_PUBLIC_ORIGIN is not an https origin.
 */
export function hostedConfig(env) {
  const value = (env.STEX_PANTHEON_PUBLIC_ORIGIN || '').trim();
  if (!value) return null;
  let origin;
  try { origin = new URL(value); } catch { throw new Error('STEX_PANTHEON_PUBLIC_ORIGIN is not a valid URL.'); }
  if (origin.protocol !== 'https:' || origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password) {
    throw new Error('STEX_PANTHEON_PUBLIC_ORIGIN must be an https origin such as https://pantheon.example.com.');
  }
  return { publicOrigin: origin.origin, publicHost: origin.host };
}

/** Returns only Igor's session cookie pair from a Cookie header, or ''. */
export function igorSessionCookie(cookie) {
  return String(cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(`${IGOR_SESSION_COOKIE}=`)) || '';
}

/** Removes Igor's session cookie, so it is never forwarded to an engine or generated code. */
export function withoutIgorSession(cookie) {
  if (typeof cookie !== 'string') return cookie;
  const kept = cookie.split(';').map((part) => part.trim()).filter((part) => part && !part.startsWith(`${IGOR_SESSION_COOKIE}=`));
  return kept.length ? kept.join('; ') : undefined;
}

/**
 * Creates the session check against Igor's loopback session endpoint.
 * Results are cached for five seconds per cookie, so a page's asset burst
 * costs one check; sign-out and revocation take effect within that window.
 *
 * @param {URL} igorTarget  Igor's loopback origin.
 * @param {string} shellAddress  Pantheon's loopback host:port, reported as x-forwarded-host.
 * @param {{ request?: typeof http.request, now?: () => number }} [options]  Test seams.
 * @returns {(cookie: string) => Promise<{ username: string, role: string } | null>}  Throws HostedRefusal(503) when Igor cannot answer.
 */
export function createIgorSessionCheck(igorTarget, shellAddress, { request = http.request, now = () => Date.now() } = {}) {
  const cache = new Map();
  /** One bounded GET /igor/api/session with only the session cookie. */
  const ask = (pair) => new Promise((resolve, reject) => {
    const outgoing = request({
      protocol: igorTarget.protocol, hostname: igorTarget.hostname, port: igorTarget.port, method: 'GET', path: '/igor/api/session',
      headers: { host: igorTarget.host, 'x-forwarded-host': shellAddress, cookie: pair, accept: 'application/json' }, timeout: 3_000,
    }, (response) => {
      const chunks = []; let bytes = 0;
      response.on('data', (chunk) => { bytes += chunk.length; if (bytes > 16_384) response.destroy(new Error('oversized')); else chunks.push(chunk); });
      response.on('end', () => {
        if (response.statusCode === 401) return resolve(null);
        if (response.statusCode !== 200) return reject(new Error(`session ${response.statusCode}`));
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          // Only password mode is a real sign-in; a local-mode Igor would admit anyone.
          if (body?.mode !== 'password' || typeof body.username !== 'string' || !body.username) return reject(new Error('not a password-mode session'));
          resolve({ username: body.username, role: String(body.role || '') });
        } catch (error) { reject(error); }
      });
      response.on('error', reject);
    });
    outgoing.on('timeout', () => outgoing.destroy(new Error('timeout')));
    outgoing.on('error', reject);
    outgoing.end();
  });
  return async function check(cookie) {
    const pair = igorSessionCookie(cookie);
    if (!pair) return null;
    const cached = cache.get(pair);
    if (cached && now() - cached.at < SESSION_CACHE_MS) return cached.user;
    let user;
    try { user = await ask(pair); }
    catch { throw new HostedRefusal(503, 'Pantheon could not check your sign-in. Try again shortly.'); }
    if (cache.size >= SESSION_CACHE_LIMIT) {
      // Expired entries go first, so a burst of forged cookies cannot evict live sessions early.
      for (const [key, entry] of cache) if (now() - entry.at >= SESSION_CACHE_MS) cache.delete(key);
      if (cache.size >= SESSION_CACHE_LIMIT) cache.delete(cache.keys().next().value);
    }
    cache.set(pair, { user, at: now() });
    return user;
  };
}

/**
 * Whether a request is part of signing in, and so must work before a session
 * exists: Igor's sign-in page, its session endpoint (GET answers 401, POST
 * signs in, DELETE signs out), and the brand files the sign-in page loads.
 * The list is explicit on purpose. Every other path, Igor's own included, needs
 * a session that Igor confirms in password mode, so an Igor that ever started
 * without password sign-in would fail closed here instead of open.
 *
 * @param {string} pathname  The raw request pathname.
 * @param {string} method  HTTP method.
 */
export function isSignInRequest(pathname, method) {
  if (pathname === '/igor/api/session') return true;
  if (!['GET', 'HEAD'].includes(method)) return false;
  if (pathname === '/igor/login') return true;
  return /\.[a-z0-9]{2,5}$/i.test(pathname) && ['/design-system/', '/igor/splash/', '/igor/media/splash/', '/igor/media/masthead/'].some((prefix) => pathname.startsWith(prefix));
}

/**
 * Creates the hosted request gate.
 *
 * - A loopback Host with no proxy headers (health checks and local processes)
 *   keeps local behaviour, on a native host only (`loopbackExempt`).
 * - Any other Host than the public one is refused.
 * - A public request from another site, or naming another Origin, is refused.
 * - Sign-in requests (isSignInRequest) pass to Igor, which serves them.
 * - Everything else needs a signed-in Igor session: pages redirect to Igor's
 *   sign-in, other requests are refused with 401.
 * Admitted requests are rewritten in place to Pantheon's loopback address.
 *
 * @param {{ publicOrigin: string, publicHost: string }} config  Hosted settings.
 * @param {{ port: number, checkSession: (cookie: string) => Promise<object | null>, loopbackExempt?: boolean }} options  `loopbackExempt` false in container mode.
 * @returns {(request: import('node:http').IncomingMessage) => Promise<{ user: object | null }>}  Throws HostedRefusal to refuse.
 */
export function createHostedGate(config, { port, checkSession, loopbackExempt = true }) {
  const loopbackAddress = `127.0.0.1:${port}`;
  return async function admit(request) {
    const { headers } = request;
    // Native hosts bind 127.0.0.1, so a loopback Host without proxy headers is this machine.
    // In a container (bound to every interface) a peer could send that Host, so there is no
    // such exemption: probes use /healthz, everything else needs the public host and a session.
    if (loopbackExempt && isLoopbackHost(headers.host) && proxyHeaders.every((name) => headers[name] === undefined)) return { user: null };
    if (headers.host !== config.publicHost) throw new HostedRefusal(403, 'Pantheon answers only on its published address.');
    const origin = headers.origin;
    if (headers['sec-fetch-site'] === 'cross-site' || (origin && origin !== config.publicOrigin)) throw new HostedRefusal(403, 'Foreign browser origin refused.');
    let pathname;
    try { pathname = new URL(request.url, 'http://pantheon.invalid').pathname; } catch { throw new HostedRefusal(400, 'Invalid request path.'); }
    // Dot segments are refused later by the proxy too; refusing here keeps the
    // Igor-owned exception from being reached by a path that only looks like one.
    let decoded;
    try { decoded = decodeURIComponent(pathname); } catch { throw new HostedRefusal(400, 'Invalid request path.'); }
    if (decoded.split('/').some((part) => part === '.' || part === '..')) throw new HostedRefusal(400, 'Invalid request path.');
    let user = null;
    if (!isSignInRequest(pathname, request.method)) {
      user = await checkSession(headers.cookie);
      if (!user) {
        const page = ['GET', 'HEAD'].includes(request.method) && !pathname.startsWith('/api/') && !/^\/[a-z]+\/api\//.test(pathname);
        if (page) throw new HostedRefusal(303, 'Sign in to use Pantheon.', '/igor/login?next=%2Figor%2F');
        throw new HostedRefusal(401, 'Sign in to use Pantheon.');
      }
    }
    headers.host = loopbackAddress;
    if (origin) headers.origin = `http://${loopbackAddress}`;
    return { user };
  };
}
