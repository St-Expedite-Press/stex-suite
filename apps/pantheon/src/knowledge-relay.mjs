/**
 * Knowledge relay: Pantheon's side of the knowledge API when the Python
 * platform API owns the journals (STEX_KNOWLEDGE_SERVICE=platform).
 *
 * Purpose: keep `/api/knowledge/v1` and its browser behaviour unchanged while
 * moving journal ownership out of Pantheon. Pantheon still checks the browser
 * origin (it is the browser-facing host) and still decides who is signed in;
 * the platform API decides everything else.
 *
 * Ownership: Pantheon owns admission and presentation only. It never opens,
 * reads or writes a knowledge journal on this path.
 *
 * Security boundary: only the method, the path below `/api/knowledge/v1`, the
 * query string, a bounded JSON body and its content type are forwarded. Cookies
 * and every other browser header are dropped. The stex.platform.actor.v1
 * headers are added only when the server admitted a signed-in person and holds
 * the shared secret (hosted); the platform API verifies them. Beside them goes
 * `x-stex-actor-journal`, the admitted username's journal directory digest
 * (the same digest the Node library uses), so usernames that travel as a
 * `sha256-` actor id keep their existing journal directory.
 *
 * Failure behaviour: an unreachable, slow, redirecting, non-JSON or oversized
 * platform answer becomes 503 `KNOWLEDGE_UNAVAILABLE`; nothing is cached or guessed.
 */

import { personDirectoryName } from '../../../services/knowledge/src/library.mjs';

const PREFIX = '/api/knowledge/v1';
/** The admitted person's journal directory name (a digest), sent beside the actor. */
const PERSON_HEADER = 'x-stex-actor-journal';
/** Sent on every request from a hosted Pantheon; a platform API not in hosted mode then refuses (one shared journal would otherwise serve every account). */
const HOSTED_HEADER = 'x-stex-knowledge-hosted';
/** Browser request bodies keep the existing 16,384-byte limit. */
const MAX_REQUEST_BYTES = 16_384;
/** Exports can approach the 8 MB journal limit plus their views. */
const MAX_RESPONSE_BYTES = 20_000_000;
/** Access checks alone may take six seconds; acceptance adds an owner call. */
const TIMEOUT_MS = 20_000;

/** Builds the relay's failure shape. */
const fail = (status, code, message) => Object.assign(new Error(message), { status, code });

/**
 * Reads a bounded request body.
 *
 * @param {import('node:http').IncomingMessage} request
 * @returns {Promise<Buffer>}
 */
async function readBody(request) {
  const parts = []; let size = 0;
  for await (const part of request) {
    size += part.length;
    if (size > MAX_REQUEST_BYTES) throw fail(413, 'INVALID_REQUEST', 'Keep this request below 16,384 bytes.');
    parts.push(part);
  }
  return Buffer.concat(parts);
}

/**
 * Creates the relay route.
 *
 * @param {object} options
 * @param {URL} options.target  The platform API origin (validated by the caller).
 * @param {boolean} [options.hosted]  Pantheon is hosted: every relayed request says so.
 * @param {typeof fetch} [options.fetchImpl]  Test seam.
 * @returns {(request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse, url: URL, context?: { user?: { username?: string } | null, actor?: Record<string, string> | null }) => Promise<void>}
 */
export function knowledgeRelay({ target, hosted = false, fetchImpl = fetch }) {
  return async (request, response, url, { user = null, actor = null } = {}) => {
    /** Sends a JSON answer with the knowledge API's headers. */
    const send = (status, body) => {
      response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
      response.end(body);
    };
    try {
      const origin = request.headers.origin;
      if (request.headers['sec-fetch-site'] === 'cross-site' || (origin && origin !== `http://${request.headers.host}`)) throw fail(403, 'INVALID_REQUEST', 'Foreign browser origin refused.');
      if (!['GET', 'POST'].includes(request.method)) throw fail(405, 'INVALID_REQUEST', 'Method not allowed.');
      if (url.pathname !== PREFIX && !url.pathname.startsWith(`${PREFIX}/`)) throw fail(404, 'INVALID_REQUEST', 'Unknown knowledge route.');
      const headers = { accept: 'application/json', 'accept-encoding': 'identity', ...(hosted ? { [HOSTED_HEADER]: '1' } : {}) };
      let body;
      if (request.method === 'POST') {
        headers['content-type'] = String(request.headers['content-type'] || '');
        body = await readBody(request);
      }
      if (actor && typeof user?.username === 'string') Object.assign(headers, actor, { [PERSON_HEADER]: personDirectoryName(user.username) });
      const upstream = new URL(`${url.pathname}${url.search}`, target);
      let reply;
      try { reply = await fetchImpl(upstream, { method: request.method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) }); }
      catch { throw fail(503, 'KNOWLEDGE_UNAVAILABLE', 'The knowledge service is unavailable.'); }
      /** Discards an unusable answer. */
      const refuse = async () => { await reply.body?.cancel().catch(() => {}); throw fail(503, 'KNOWLEDGE_UNAVAILABLE', 'The knowledge service is unavailable.'); };
      if (reply.status >= 300 && reply.status < 400) return await refuse();
      if (!/^application\/json\b/i.test(reply.headers.get('content-type') || '')) return await refuse();
      if ((reply.headers.get('content-encoding') || 'identity').toLowerCase() !== 'identity') return await refuse();
      const chunks = []; let size = 0;
      try {
        for await (const chunk of reply.body) {
          size += chunk.length;
          if (size > MAX_RESPONSE_BYTES) return await refuse();
          chunks.push(chunk);
        }
      } catch (error) { if (error.status) throw error; throw fail(503, 'KNOWLEDGE_UNAVAILABLE', 'The knowledge service is unavailable.'); }
      return send(reply.status, Buffer.concat(chunks));
    } catch (error) {
      return send(error.status || 400, JSON.stringify({ error: error.status ? error.message : 'Knowledge could not apply this request.', code: error.code || 'INVALID_REQUEST' }));
    }
  };
}
