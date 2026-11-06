// Request guards and JSON helpers for stex.igor.conversations.v1 (protocol/igor).

export const BODY_LIMIT_BYTES = 64 * 1024;

export class IgorError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

const loopbackHost = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/;

// A loopback Host defeats DNS rebinding, so it is required for every API call,
// reads included: a rebound page must not read conversations either. Behind a
// proxy the Host is the proxy's own choice, so the browser's Host arrives as
// x-forwarded-host and must be loopback too.
export function assertLoopbackHost(headers) {
  if (!loopbackHost.test(String(headers.host || ''))) throw new IgorError(403, 'FORBIDDEN', 'Igor answers only on its local address.');
  if (headers['x-forwarded-host'] !== undefined && !loopbackHost.test(String(headers['x-forwarded-host']))) throw new IgorError(403, 'FORBIDDEN', 'Igor answers only on its local address.');
}

// Mutations need a JSON body (other sites cannot send one without a CORS
// preflight, which Igor never grants), a loopback Host, and no cross-site
// Origin or Sec-Fetch-Site. Pantheon's proxy rewrites Host to Igor's address
// and reports the browser's loopback Host as x-forwarded-host, so an Origin
// matching either loopback address is the same origin the browser saw.
export function assertSameOrigin(headers) {
  assertLoopbackHost(headers);
  if (!/^application\/json\s*(;|$)/i.test(String(headers['content-type'] || ''))) throw new IgorError(415, 'INVALID_REQUEST', 'Igor requests must be JSON.');
  const site = headers['sec-fetch-site'];
  if (site && !['same-origin', 'none'].includes(site)) throw new IgorError(403, 'FORBIDDEN', 'Igor answers only its own pages.');
  if (headers.origin) {
    const allowed = new Set([`http://${headers.host}`]);
    const forwarded = headers['x-forwarded-host'];
    if (typeof forwarded === 'string' && loopbackHost.test(forwarded)) allowed.add(`http://${forwarded}`);
    if (!allowed.has(headers.origin)) throw new IgorError(403, 'FORBIDDEN', 'Igor answers only its own pages.');
  }
}

// Counts bytes as they arrive and stops before parsing anything oversized.
export async function readJson(request, limit = BODY_LIMIT_BYTES) {
  const parts = []; let bytes = 0;
  for await (const part of request) {
    bytes += part.length;
    if (bytes > limit) throw new IgorError(413, 'INVALID_REQUEST', 'That request is too large.');
    parts.push(part);
  }
  let value;
  try { value = bytes ? JSON.parse(Buffer.concat(parts).toString('utf8')) : {}; } catch { throw new IgorError(400, 'INVALID_REQUEST', 'Request body must be JSON.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new IgorError(400, 'INVALID_REQUEST', 'Request body must be a JSON object.');
  return value;
}

export function sendJson(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  response.end(value === undefined ? undefined : JSON.stringify(value));
}

export function sendError(response, error) {
  sendJson(response, error.status, { error: error.message, code: error.code });
}
