import http from 'node:http';
import { createHermesClient } from './src/hermes-client.mjs';

const positive = (value, fallback) => (Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : fallback);
const config = {
  host: process.env.STEX_INFERENCE_HOST || '127.0.0.1',
  port: positive(process.env.STEX_INFERENCE_PORT, 8100),
  sharedSecret: process.env.STEX_INFERENCE_SHARED_SECRET || '',
  hermesTransport: process.env.STEX_HERMES_TRANSPORT === 'remote' ? 'remote' : 'fake',
  hermesUrl: (process.env.STEX_HERMES_URL || '').trim(),
  hermesToken: process.env.STEX_HERMES_TOKEN || '',
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
function legacyHermesRequest(kind, value) {
  const turns = Array.isArray(value.turns) ? value.turns : [];
  const message = String(value.message || '').trim();
  return {
    contract: 'stex.hermes.turn.v1', requestId: `texgraph-${kind}-${Date.now()}`, product: 'frige',
    conversation: { id: String(value.book?.id || value.scope?.id || value.page?.id || 'texgraph').slice(0, 80), messages: [...turns.map((turn) => ({ role: turn?.role === 'assistant' ? 'assistant' : 'user', content: String(turn?.message || turn?.commentary || '').slice(0, 6_000) })).filter((turn) => turn.content), ...(message ? [{ role: 'user', content: message.slice(0, 6_000) }] : [])].slice(-20) },
    operation: { kind: 'conversation', payload: { legacyContract: String(value.contract || ''), kind } },
    context: { legacy: { scope: value.scope || null, page: value.page ? { id: value.page.id, title: value.page.title, sourceHash: value.page.sourceHash || value.page.hash || null } : null, sourceCount: Array.isArray(value.scopeSources) ? value.scopeSources.length : 0 } },
    budget: { maxContextChars: 96_000, maxOutputChars: 20_000, timeoutMs: 30_000 },
  };
}
async function legacyTurn(kind, token, value, signal) {
  const reply = await hermes.turn({ token, body: legacyHermesRequest(kind, value), signal });
  const commentary = String(reply.events.find((event) => event.type === 'message')?.payload?.text || 'Hermes completed without commentary.');
  const base = { commentary, noChange: true, proposal: null, graphSuggestions: [], ticketUpdates: null, meta: { model: `stex.hermes.${reply.usage.transport}`, usage: reply.usage } };
  return kind === 'scope-turn' ? { ...base, changes: [], parts: [{ type: 'text', text: commentary }], droppedParts: [] } : base;
}

http.createServer(async (request, response) => {
  const url = new URL(request.url, 'http://gateway');
  try {
    if (request.method === 'GET' && url.pathname === '/health') return json(response, 200, { ...hermes.health(), provider: 'hermes', model: null });
    if (request.method === 'GET' && url.pathname === '/v1/hermes/health') return json(response, 200, hermes.health());
    const token = request.headers['x-stex-inference-token'];
    if (url.pathname === '/v1/hermes/turn' && request.method === 'POST') return json(response, 200, await hermes.turn({ token, body: await body(request), signal: request.signal }));
    if (url.pathname === '/v1/settings/models' || url.pathname === '/v1/models/catalog') return json(response, 410, { error: 'The legacy provider roster has been removed. Configure remote Hermes outside STEX.', code: 'GONE' });
    const kind = legacyRoutes.get(url.pathname);
    if (request.method !== 'POST' || !kind) return json(response, 404, { error: 'Not found.', code: 'NOT_FOUND' });
    return json(response, 200, await legacyTurn(kind, token, await body(request), request.signal));
  } catch (error) {
    if (!error.code) console.error(error);
    json(response, error.status || 500, { error: error.code ? error.message : 'The inference gateway failed unexpectedly.', code: error.code || 'GATEWAY_ERROR' });
  }
}).listen(config.port, config.host, () => console.log(`STEX inference gateway ready at http://${config.host}:${config.port} (Hermes: ${config.hermesTransport})`));
