import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const serviceDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOKEN = 'inference-server-test-token';

// A loopback stand-in for the upstream Hermes API server. "hold" never answers.
async function startUpstream(context, port) {
  const seen = [];
  const server = http.createServer(async (request, response) => {
    let raw = ''; for await (const part of request) raw += part;
    const body = JSON.parse(raw); const entry = { body, closedEarly: false }; seen.push(entry);
    response.once('close', () => { if (!response.writableFinished) entry.closedEarly = true; });
    if (body.messages.at(-1).content === 'hold') return;
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ id: 'cmpl-test', model: 'hermes-agent', choices: [{ index: 0, message: { role: 'assistant', content: 'Hello from upstream' }, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 3, total_tokens: 6 } }));
  });
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  context.after(() => { server.closeAllConnections(); server.close(); });
  return seen;
}

async function startService(context, port, upstreamPort) {
  const child = spawn(process.execPath, ['server.mjs'], { cwd: serviceDirectory, env: { ...process.env,
    STEX_INFERENCE_PORT: String(port), STEX_INFERENCE_SHARED_SECRET: TOKEN, STEX_HERMES_TRANSPORT: 'remote',
    STEX_HERMES_URL: `http://127.0.0.1:${upstreamPort}`, STEX_HERMES_API_KEY: 'upstream-test-key',
    STEX_HERMES_ISOLATION: 'verified', STEX_HERMES_TOOL_POLICY: 'conversational-only' } });
  const exited = new Promise((resolve) => child.once('exit', resolve));
  context.after(async () => { if (child.exitCode === null) { child.kill(); await exited; } });
  await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`inference did not start: ${output}`)), 5_000);
    child.stdout.on('data', (data) => { output += data; if (output.includes('ready at')) { clearTimeout(timer); resolve(); } });
    child.once('exit', () => reject(new Error(`inference exited: ${output}`)));
  });
}

const turn = (content) => ({ contract: 'stex.hermes.turn.v1', requestId: `req-${content}`, product: 'igor', conversation: { id: 'conversation-1', messages: [{ role: 'user', content }] }, operation: { kind: 'conversation' } });
const post = (port, body, signal) => fetch(`http://127.0.0.1:${port}/v1/hermes/turn`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-stex-inference-token': TOKEN }, body: JSON.stringify(body), signal });

test('the real server submits a remote turn once its body is read, and cancels only when the caller leaves', async (context) => {
  const seen = await startUpstream(context, 8191);
  await startService(context, 8192, 8191);

  // Node 24 aborts request.signal after the body is read; a turn must still reach upstream.
  const response = await post(8192, turn('hello'));
  const reply = await response.json();
  assert.equal(response.status, 200, JSON.stringify(reply));
  assert.equal(reply.status, 'completed');
  assert.equal(reply.events[0].payload.text, 'Hello from upstream');
  assert.equal(seen.length, 1);

  // A caller that disconnects mid-turn closes the upstream request.
  const caller = new AbortController();
  const pending = post(8192, turn('hold'), caller.signal).catch((error) => error.name);
  const deadline = Date.now() + 5_000;
  while (seen.length < 2 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(seen.length, 2, 'the held turn reached upstream');
  caller.abort();
  assert.equal(await pending, 'AbortError');
  while (!seen[1].closedEarly && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(seen[1].closedEarly, true, 'the upstream request was closed when the caller left');
});
