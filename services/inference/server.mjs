import { readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGateway } from './src/gateway.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
try {
  const source = await readFile(path.resolve(directory, '..', '..', '.env'), 'utf8');
  for (const line of source.split(/\r?\n/)) { const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line); if (match && !process.env[match[1]]) process.env[match[1]] = match[2]; }
} catch { /* Environment may be supplied by the host. */ }
const config = { host: process.env.STEX_INFERENCE_HOST || '127.0.0.1', port: Number(process.env.STEX_INFERENCE_PORT || 8100), sharedSecret: process.env.STEX_INFERENCE_SHARED_SECRET || '', apiKey: process.env.OPENROUTER_API_KEY || '', model: process.env.OPENROUTER_MODEL || '', baseUrl: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1', siteUrl: process.env.OPENROUTER_SITE_URL || 'http://127.0.0.1:4300', appName: process.env.OPENROUTER_APP_NAME || 'STEX Suite (local)', maxInputTokens: Number(process.env.STEX_INFERENCE_MAX_INPUT_TOKENS || 24_000), maxOutputTokens: Number(process.env.STEX_INFERENCE_MAX_OUTPUT_TOKENS || 4_000), timeoutMs: Number(process.env.STEX_INFERENCE_REQUEST_TIMEOUT_SECONDS || 120) * 1000 };
const gateway = createGateway({ config });
async function body(request) { let raw = ''; for await (const chunk of request) { raw += chunk; if (raw.length > 250_000) throw new Error('Request too large.'); } try { return raw ? JSON.parse(raw) : {}; } catch { throw new Error('Request body must be JSON.'); } }
function json(response, status, value) { response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); response.end(JSON.stringify(value)); }
http.createServer(async (request, response) => {
  try {
    if (request.method === 'GET' && request.url === '/health') return json(response, 200, gateway.health());
    const kind = request.url === '/v1/texgraph/interview-turn' ? 'interview' : request.url === '/v1/texgraph/page-turn' ? 'page-turn' : null;
    if (request.method !== 'POST' || !kind) return json(response, 404, { error: 'Not found.' });
    return json(response, 200, await gateway.handle({ token: request.headers['x-stex-inference-token'], kind, body: await body(request) }));
  } catch (error) { json(response, error.status || 400, { error: error.message || 'Inference request failed.' }); }
}).listen(config.port, config.host, () => console.log(`STEX inference gateway ready at http://${config.host}:${config.port}`));
