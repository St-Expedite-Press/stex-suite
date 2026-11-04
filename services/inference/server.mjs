import { readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGateway } from './src/gateway.mjs';
import { createModelSettings } from './src/model-settings.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
try {
  const source = await readFile(path.resolve(directory, '..', '..', '.env'), 'utf8');
  for (const line of source.split(/\r?\n/)) { const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line); if (match && !process.env[match[1]]) process.env[match[1]] = match[2]; }
} catch { /* Environment may be supplied by the host. */ }
const number = (value, fallback) => (Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : fallback);
// Zero is a meaningful setting for retries (none); an unset value keeps the default.
const count = (value, fallback) => (value !== undefined && value !== '' && Number.isInteger(Number(value)) && Number(value) >= 0 ? Number(value) : fallback);
const config = {
  host: process.env.STEX_INFERENCE_HOST || '127.0.0.1', port: number(process.env.STEX_INFERENCE_PORT, 8100),
  sharedSecret: process.env.STEX_INFERENCE_SHARED_SECRET || '',
  openRouterKey: process.env.OPENROUTER_API_KEY || '', model: (process.env.OPENROUTER_MODEL || '').trim(),
  baseUrl: (process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/+$/, ''),
  siteUrl: process.env.OPENROUTER_SITE_URL || '', appName: process.env.OPENROUTER_APP_NAME || 'STEX Suite',
  timeoutMs: number(process.env.OPENROUTER_REQUEST_TIMEOUT_SECONDS, 90) * 1000, maxRetries: count(process.env.OPENROUTER_MAX_RETRIES, 2),
  maxInputTokens: number(process.env.STEX_INFERENCE_MAX_INPUT_TOKENS, 24_000), maxOutputTokens: number(process.env.STEX_INFERENCE_MAX_OUTPUT_TOKENS, 4096),
};
// The agent roster and model stacks, edited from Settings → Configure models.
const models = createModelSettings({ file: path.join(process.env.STEX_INFERENCE_STATE_DIR ? path.resolve(process.env.STEX_INFERENCE_STATE_DIR) : path.join(directory, '.state'), 'models.json'), envModel: config.model });
await models.load();
const gateway = createGateway({ config, models });
const routes = new Map([['/v1/texgraph/interview-turn', 'interview'], ['/v1/texgraph/page-turn', 'page-turn'], ['/v1/texgraph/scope-turn', 'scope-turn']]);
async function body(request) { let raw = ''; for await (const chunk of request) { raw += chunk; if (raw.length > 250_000) throw Object.assign(new Error('Request too large.'), { status: 413, code: 'REQUEST_TOO_LARGE' }); } try { return raw ? JSON.parse(raw) : {}; } catch { throw Object.assign(new Error('Request body must be JSON.'), { status: 400, code: 'INVALID_REQUEST' }); } }
function json(response, status, value) { response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); response.end(JSON.stringify(value)); }
http.createServer(async (request, response) => {
  const url = new URL(request.url, 'http://gateway');
  try {
    if (request.method === 'GET' && url.pathname === '/health') return json(response, 200, await gateway.health({ probe: url.searchParams.get('probe') === '1' }));
    const token = request.headers['x-stex-inference-token'];
    if (url.pathname === '/v1/settings/models' && request.method === 'GET') return json(response, 200, await gateway.models({ token }));
    if (url.pathname === '/v1/settings/models' && request.method === 'PUT') return json(response, 200, await gateway.saveModels({ token, body: await body(request) }));
    if (url.pathname === '/v1/models/catalog' && request.method === 'GET') return json(response, 200, await gateway.catalog({ token }));
    const kind = routes.get(url.pathname);
    if (request.method !== 'POST' || !kind) return json(response, 404, { error: 'Not found.', code: 'NOT_FOUND' });
    return json(response, 200, await gateway.handle({ token, kind, body: await body(request) }));
  } catch (error) {
    // Unexpected failures are logged server-side; callers see a code and a safe message.
    if (!error.code) console.error(error);
    json(response, error.status || 500, { error: error.code ? error.message : 'The inference gateway failed unexpectedly.', code: error.code || 'GATEWAY_ERROR', ...(error.errors ? { errors: error.errors } : {}) });
  }
}).listen(config.port, config.host, () => console.log(`STEX inference gateway ready at http://${config.host}:${config.port} (director: ${models.profile('director').stack.join(' → ') || 'no model set'})`));
