import http from 'node:http';
import { createHermesClient } from './src/hermes-client.mjs';
import { legacyHermesRequest } from './src/texgraph-adapter.mjs';

const positive = (value, fallback) => (Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : fallback);
const config = {
  host: process.env.STEX_INFERENCE_HOST || '127.0.0.1',
  port: positive(process.env.STEX_INFERENCE_PORT, 8100),
  sharedSecret: process.env.STEX_INFERENCE_SHARED_SECRET || '',
  hermesTransport: process.env.STEX_HERMES_TRANSPORT === 'remote' ? 'remote' : 'fake',
  hermesUrl: (process.env.STEX_HERMES_URL || '').trim(),
  // API_SERVER_KEY belongs to the locally installed upstream Hermes gateway.
  // The old token name remains a migration fallback only.
  hermesApiKey: process.env.STEX_HERMES_API_KEY || process.env.STEX_HERMES_TOKEN || '',
  hermesApiMode: process.env.STEX_HERMES_API_MODE === 'responses' ? 'responses' : 'chat-completions',
  hermesModel: (process.env.STEX_HERMES_MODEL || 'hermes-agent').trim(),
  hermesIsolation: process.env.STEX_HERMES_ISOLATION || '',
  hermesToolPolicy: process.env.STEX_HERMES_TOOL_POLICY || '',
  hermesMaxConcurrentTurns: positive(process.env.STEX_HERMES_MAX_CONCURRENT_TURNS, 1),
  hermesMaxContextChars: positive(process.env.STEX_HERMES_MAX_CONTEXT_CHARS, 96_000),
  hermesMaxOutputChars: positive(process.env.STEX_HERMES_MAX_OUTPUT_CHARS, 20_000),
  hermesMaxTimeoutMs: positive(process.env.STEX_HERMES_MAX_TIMEOUT_SECONDS, 60) * 1000,
};
const hermes = createHermesClient({ config });
const legacyRoutes = new Map([['/v1/texgraph/interview-turn', 'interview'], ['/v1/texgraph/page-turn', 'page-turn'], ['/v1/texgraph/scope-turn', 'scope-turn']]);

async function body(request) {
  let raw = '';
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 250_000) throw Object.assign(new Error('Request too large.'), { status: 413, code: 'REQUEST_TOO_LARGE' });
  }
  try { return raw ? JSON.parse(raw) : {}; } catch { throw Object.assign(new Error('Request body must be JSON.'), { status: 400, code: 'INVALID_REQUEST' }); }
}
function json(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(value));
}
async function legacyTurn(kind, token, value, signal) {
  const reply = await hermes.turn({ token, body: legacyHermesRequest(kind, value), signal });
  const commentary = String(reply.events.find((event) => event.type === 'message')?.payload?.text || 'Hermes completed without commentary.');
  const base = { commentary, noChange: true, proposal: null, graphSuggestions: [], ticketUpdates: null, meta: { model: `stex.hermes.${reply.usage.transport}`, usage: reply.usage } };
  return kind === 'scope-turn' ? { ...base, changes: [], parts: [{ type: 'text', text: commentary }], droppedParts: [] } : base;
}

// Aborts only when the caller disconnects before its reply is written. Node 24
// aborts request.signal as soon as the request body has been read, which would
// cancel every remote turn before submission.
function callerGone(response) {
  const controller = new AbortController();
  response.once('close', () => { if (!response.writableFinished) controller.abort(); });
  return controller.signal;
}

http.createServer(async (request, response) => {
  const url = new URL(request.url, 'http://gateway');
  const disconnected = callerGone(response);
  try {
    if (request.method === 'GET' && url.pathname === '/health') return json(response, 200, { ...(url.searchParams.get('probe') === '1' ? await hermes.probe({ token: request.headers['x-stex-inference-token'] }) : hermes.health()), provider: 'hermes' });
    if (request.method === 'GET' && url.pathname === '/v1/hermes/health') return json(response, 200, url.searchParams.get('probe') === '1' ? await hermes.probe({ token: request.headers['x-stex-inference-token'] }) : hermes.health());
    const token = request.headers['x-stex-inference-token'];
    if (url.pathname === '/v1/hermes/turn' && request.method === 'POST') return json(response, 200, await hermes.turn({ token, body: await body(request), signal: disconnected }));
    if (url.pathname === '/v1/settings/models' || url.pathname === '/v1/models/catalog') return json(response, 410, { error: 'The legacy provider roster has been removed. Configure remote Hermes outside STEX.', code: 'GONE' });
    const kind = legacyRoutes.get(url.pathname);
    if (request.method !== 'POST' || !kind) return json(response, 404, { error: 'Not found.', code: 'NOT_FOUND' });
    return json(response, 200, await legacyTurn(kind, token, await body(request), disconnected));
  } catch (error) {
    if (!error.code) console.error(error);
    json(response, error.status || 500, { error: error.code ? error.message : 'The inference gateway failed unexpectedly.', code: error.code || 'GATEWAY_ERROR' });
  }
}).listen(config.port, config.host, () => console.log(`STEX inference gateway ready at http://${config.host}:${config.port} (Hermes: ${config.hermesTransport})`));
