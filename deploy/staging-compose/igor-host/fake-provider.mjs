/**
 * Recording fake model provider for the staging Igor host (OpenAI-compatible chat completions).
 *
 * Hermes's `openrouter` provider is pointed here (127.0.0.1:9999/api/v1) in staging only. Every
 * request body is appended to /tmp/provider/requests.jsonl so the verifier can see exactly what a
 * turn sent: the context, the system prompt and any tool definitions. It answers with a fixed
 * reply, streaming or not. It never forwards anywhere; nothing here is a real model.
 */
import { appendFile } from 'node:fs/promises';
import http from 'node:http';

const LOG = '/tmp/provider/requests.jsonl';
const REPLY = 'Staging reply from the fake provider.';

http.createServer(async (request, response) => {
  let body = ''; for await (const chunk of request) body += chunk;
  const url = request.url || '';
  if (request.method === 'GET' && /\/models$/.test(url)) {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ data: [{ id: 'x-ai/grok-4.7' }, { id: 'x-ai/grok-4.3' }, { id: 'x-ai/grok-4.20' }] }));
    return;
  }
  if (request.method !== 'POST' || !/\/chat\/completions$/.test(url)) { response.writeHead(404); response.end(); return; }
  let value = {};
  try { value = JSON.parse(body); } catch { /* recorded as raw */ }
  await appendFile(LOG, `${JSON.stringify({ at: new Date().toISOString(), url, body: value })}\n`);
  const id = `chatcmpl-staging-${Date.now()}`; const created = Math.floor(Date.now() / 1000); const model = value.model || 'x-ai/grok-4.7';
  const usage = { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 };
  if (value.stream) {
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    const chunk = (delta, finish = null) => `data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
    response.write(chunk({ role: 'assistant', content: REPLY }));
    response.write(chunk({}, 'stop'));
    response.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [], usage })}\n\n`);
    response.end('data: [DONE]\n\n');
    return;
  }
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ id, object: 'chat.completion', created, model, choices: [{ index: 0, message: { role: 'assistant', content: REPLY }, finish_reason: 'stop' }], usage }));
}).listen(9999, '127.0.0.1', () => console.log('fake provider ready on 127.0.0.1:9999'));
