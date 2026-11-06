// Igor: the conversational interface of the Pantheon Director. Serves
// stex.igor.conversations.v1 (protocol/igor) and the built interface under /igor/,
// loopback only. Replies come from services/inference; the browser never sees
// the shared secret or a Hermes payload.
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAccessVerifier, hostedConfig } from './server/access.mjs';
import { createConversations } from './server/conversations.mjs';
import { IgorError, assertLoopbackHost, assertSameOrigin, readJson, sendError, sendJson } from './server/http.mjs';
import { createInference } from './server/inference.mjs';
import { serveDesignSystem, serveInterface } from './server/static.mjs';
import { ConversationStore } from './server/store.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.STEX_IGOR_PORT || 4330);
const dataDirectory = path.resolve(process.env.STEX_IGOR_DATA_DIR || path.join(directory, '.local-data'));
const distDirectory = path.resolve(process.env.STEX_IGOR_DIST_DIR || path.join(directory, 'dist'));

let store;
try { store = await new ConversationStore(dataDirectory).load(); }
catch (error) { console.error(`Igor could not open its conversations: ${error.message}`); process.exit(1); }
let inference;
try { inference = createInference({ url: process.env.STEX_INFERENCE_URL || '', sharedSecret: process.env.STEX_INFERENCE_SHARED_SECRET || '' }); }
catch (error) { console.error(`Igor will not start: ${error.message}`); process.exit(1); }
const conversations = createConversations({ store, inference });
// Hosted mode (behind Cloudflare Tunnel and Access) is off unless configured,
// and refuses to start half-configured.
let hosted;
try { hosted = hostedConfig(process.env); }
catch (error) { console.error(`Igor will not start: ${error.message}`); process.exit(1); }
const verifyAccess = hosted ? createAccessVerifier(hosted) : null;
const origin = hosted ? { publicHost: hosted.publicHost, publicOrigin: hosted.publicOrigin } : {};

const notFound = () => new IgorError(404, 'NOT_FOUND', 'Not found.');
const notAllowed = () => new IgorError(405, 'INVALID_REQUEST', 'That method is not supported here.');
const withRoute = (conversation) => ({ conversation, route: `/igor/c/${conversation.id}` });

async function api(request, response, route) {
  assertLoopbackHost(request.headers, origin);
  const method = request.method;
  if (['POST', 'PATCH', 'DELETE'].includes(method)) assertSameOrigin(request.headers, origin);
  if (route === '/health') {
    if (method !== 'GET') throw notAllowed();
    return sendJson(response, 200, await inference.health());
  }
  if (route === '/conversations') {
    if (method === 'GET') return sendJson(response, 200, conversations.list());
    if (method !== 'POST') throw notAllowed();
    const { status, conversation } = await conversations.create(await readJson(request));
    return sendJson(response, status, withRoute(conversation));
  }
  let match = /^\/conversations\/([a-z0-9]{12})$/.exec(route);
  if (match) {
    if (method === 'GET') return sendJson(response, 200, { conversation: conversations.get(match[1]) });
    if (method === 'PATCH') return sendJson(response, 200, { conversation: await conversations.update(match[1], await readJson(request)) });
    if (method !== 'DELETE') throw notAllowed();
    await readJson(request);
    await conversations.remove(match[1]);
    response.writeHead(204, { 'cache-control': 'no-store' }); response.end(); return;
  }
  match = /^\/conversations\/([a-z0-9]{12})\/messages$/.exec(route);
  if (match) {
    if (method !== 'POST') throw notAllowed();
    const { status, conversation } = await conversations.post(match[1], await readJson(request));
    return sendJson(response, status, { conversation });
  }
  match = /^\/conversations\/([a-z0-9]{12})\/messages\/([A-Za-z0-9_-]{8,80})\/retry$/.exec(route);
  if (match) {
    if (method !== 'POST') throw notAllowed();
    await readJson(request);
    return sendJson(response, 202, { conversation: await conversations.retry(match[1], match[2]) });
  }
  throw notFound();
}

const server = http.createServer(async (request, response) => {
  // A fixed base keeps URL parsing independent of the (untrusted) Host header.
  let url;
  try { url = new URL(request.url, 'http://igor.invalid'); } catch { return sendError(response, new IgorError(400, 'INVALID_REQUEST', 'Invalid request path.')); }
  const { pathname } = url;
  try {
    // Nothing, not even the page shell, is served to a request Access did not sign.
    if (verifyAccess) { assertLoopbackHost(request.headers, origin); await verifyAccess(request.headers); }
    if (pathname === '/' || pathname === '/igor') { response.writeHead(308, { location: `/igor/${url.search}` }); response.end(); return; }
    if (pathname.startsWith('/igor/api/')) return await api(request, response, pathname.slice('/igor/api'.length));
    const readable = ['GET', 'HEAD'].includes(request.method);
    if (pathname.startsWith('/igor/')) { if (!readable) throw notAllowed(); return await serveInterface(request, response, pathname, distDirectory); }
    if (pathname.startsWith('/design-system/')) { if (!readable) throw notAllowed(); return await serveDesignSystem(request, response, pathname); }
    throw notFound();
  } catch (error) {
    if (response.headersSent) { response.destroy(); return; }
    if (error instanceof IgorError) return sendError(response, error);
    console.error(`Igor request failed: ${error?.code || error?.name || 'error'}`);
    sendJson(response, 500, { error: 'Igor failed unexpectedly.', code: 'INTERNAL' });
  }
});

function stop() { server.close(); store.queue.finally(() => process.exit(0)); }
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
server.listen(port, '127.0.0.1', () => console.log(`Igor is ready at http://127.0.0.1:${port}/igor/${hosted ? ` (hosted as ${hosted.publicOrigin}, Cloudflare Access required)` : ''}`));
