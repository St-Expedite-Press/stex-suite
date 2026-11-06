import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { generateKeyPairSync, sign } from 'node:crypto';
import http from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createAccessVerifier, hostedConfig } from '../server/access.mjs';
import { turnHistory } from '../server/inference.mjs';
import { autoTitle } from '../server/store.mjs';

const appDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRET = 'igor-test-secret-value';
const json = { 'content-type': 'application/json' };

async function temporary(context, prefix) {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  context.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

// Spawns the real server; every byte it prints is kept so tests can check logs.
async function startIgor(context, port, { dataDir, distDir, inferenceUrl = '', env = {} }) {
  const child = spawn(process.execPath, ['server.mjs'], { cwd: appDirectory, env: { ...process.env, STEX_IGOR_PORT: String(port), STEX_IGOR_DATA_DIR: dataDir, STEX_IGOR_DIST_DIR: distDir, STEX_INFERENCE_URL: inferenceUrl, STEX_INFERENCE_SHARED_SECRET: SECRET, ...env } });
  const output = { text: '' };
  child.stderr.on('data', (data) => { output.text += data; });
  const exited = new Promise((resolve) => child.once('exit', resolve));
  context.after(async () => { if (child.exitCode === null) { child.kill(); await exited; } assert.ok(!output.text.includes(SECRET), 'secret in Igor logs'); });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Igor did not start: ${output.text}`)), 5_000);
    child.stdout.on('data', (data) => { output.text += data; if (output.text.includes(`Igor is ready at http://127.0.0.1:${port}/igor/`)) { clearTimeout(timeout); resolve(); } });
    child.once('exit', () => reject(new Error(`Igor exited: ${output.text}`)));
  });
  return { child, exited, output };
}

// A stub inference service. The last user message selects the behaviour.
async function startInference(context, port) {
  const calls = []; const health = { count: 0 }; const gates = []; const attempts = new Map(); const aborted = [];
  const server = http.createServer(async (request, response) => {
    const reply = (status, value) => { response.writeHead(status, json); response.end(JSON.stringify(value)); };
    if (request.method === 'GET' && request.url === '/v1/hermes/health') { health.count += 1; return reply(200, { ok: true, contract: 'stex.hermes.turn.v1', transport: 'fake', configured: true }); }
    let raw = ''; for await (const part of request) raw += part;
    const turn = JSON.parse(raw); calls.push({ token: request.headers['x-stex-inference-token'], turn });
    const message = turn.conversation.messages.at(-1).content;
    attempts.set(turn.requestId, (attempts.get(turn.requestId) || 0) + 1);
    response.once('close', () => { if (!response.writableEnded) aborted.push(turn.requestId); });
    if (message === 'hang') return; // never answers
    if (message === 'gate') await new Promise((resolve) => gates.push(resolve));
    if (message === 'unconfigured') return reply(503, { error: 'Upstream Hermes is not safely configured.', code: 'UNCONFIGURED' });
    if (message === 'unauthorized') return reply(401, { error: 'Unauthorized inference caller.', code: 'UNAUTHORIZED' });
    if (message === 'upstream' || (message === 'flaky' && attempts.get(turn.requestId) === 1)) return reply(504, { error: `secret upstream detail ${SECRET}`, code: 'HERMES_TIMEOUT' });
    if (message === 'malformed') return reply(200, { contract: 'stex.hermes.turn.v1', requestId: 'someone-else', status: 'completed', events: [] });
    if (message === 'cancelled') return reply(200, { contract: 'stex.hermes.turn.v1', requestId: turn.requestId, status: 'cancelled', events: [{ sequence: 1, type: 'status', payload: { code: 'CANCELLED' } }] });
    reply(200, { contract: 'stex.hermes.turn.v1', requestId: turn.requestId, status: 'completed', events: [{ sequence: 1, type: 'message', payload: { text: `Echo: ${message}` } }], usage: { transport: 'fake' } });
  });
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  context.after(() => { server.closeAllConnections(); server.close(); });
  return { url: `http://127.0.0.1:${port}`, calls, health, gates, aborted };
}

// Records every response body so the suite can prove the secret never leaves the server.
function client(port, bodies) {
  const base = `http://127.0.0.1:${port}`;
  return async (method, route, body, headers = json) => {
    const response = await fetch(`${base}${route}`, { method, headers, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
    const text = await response.text(); bodies.push(text);
    let value = null; try { value = JSON.parse(text); } catch { /* not JSON */ }
    return { status: response.status, body: value, text, headers: response.headers };
  };
}

async function until(read, done, label) {
  const deadline = Date.now() + 5_000;
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
const settled = (api, id) => until(() => api('GET', `/igor/api/conversations/${id}`), (result) => result.body?.conversation?.messages.every((message) => message.status !== 'pending'), 'the reply');
const key = (label) => `key-${label}-${Math.random().toString(36).slice(2, 10)}`;

function raw(port, method, route, headers) {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: '127.0.0.1', port, path: route, method, headers }, (response) => { response.resume(); resolve(response.statusCode); });
    request.on('error', reject); request.end(method === 'GET' ? undefined : JSON.stringify({ idempotencyKey: 'rebound-key', message: 'Hello' }));
  });
}

test('titles conversations from the first line at a word boundary', () => {
  assert.equal(autoTitle('  Plan   the\tlaunch  \nsecond line'), 'Plan the launch');
  assert.equal(autoTitle(''), 'New conversation');
  const long = autoTitle('word '.repeat(30));
  assert.ok(Array.from(long).length <= 60 && long.endsWith('…') && !long.includes('wor…'), long);
  assert.equal(Array.from(autoTitle('x'.repeat(80))).length, 60);
});

test('sends only complete history up to the trigger, trimmed oldest-first to 20,000 bytes', () => {
  const messages = Array.from({ length: 30 }, (_, index) => ({ id: `m${index}`, role: index % 2 ? 'assistant' : 'user', content: `${index} ${'語'.repeat(1_500)}`, status: 'complete' }));
  messages[27].status = 'failed';
  messages.push({ id: 'after', role: 'user', content: 'after', status: 'complete' });
  const history = turnHistory({ messages }, 'm28');
  assert.ok(Buffer.byteLength(JSON.stringify(history)) <= 20_000);
  assert.ok(history.length > 1 && history.length <= 20);
  assert.equal(history.at(-1).content, messages[28].content);
  assert.ok(!history.some((message) => message.content.startsWith('27 ') || message.content === 'after'));
  const huge = turnHistory({ messages: [{ id: 'a', role: 'user', content: 'x'.repeat(30_000), status: 'complete' }] }, 'a');
  assert.equal(huge.length, 1);
});

test('creates a conversation, replies in the background, and keeps conversations isolated', async (context) => {
  const inference = await startInference(context, 4630);
  const dist = await temporary(context, 'igor-dist-');
  await mkdir(path.join(dist, 'assets'));
  await writeFile(path.join(dist, 'index.html'), '<!doctype html><title>Igor fixture</title>');
  await writeFile(path.join(dist, 'assets', 'app.js'), 'export {};');
  const igor = await startIgor(context, 4631, { dataDir: await temporary(context, 'igor-data-'), distDir: dist, inferenceUrl: inference.url });
  const bodies = []; const api = client(4631, bodies);

  const first = key('first');
  const created = await api('POST', '/igor/api/conversations', { idempotencyKey: first, message: '  Hello Igor  ', ignored: true });
  assert.equal(created.status, 201);
  const { conversation } = created.body;
  assert.match(conversation.id, /^[a-z0-9]{12}$/);
  assert.equal(created.body.route, `/igor/c/${conversation.id}`);
  assert.equal(conversation.title, 'Hello Igor'); assert.equal(conversation.titleSource, 'auto'); assert.equal(conversation.archived, false);
  const [user, assistant] = conversation.messages;
  assert.deepEqual([user.role, user.status, user.content], ['user', 'complete', 'Hello Igor']);
  assert.deepEqual([assistant.role, assistant.status, assistant.replyTo], ['assistant', 'pending', user.id]);
  assert.match(assistant.id, /^m_[a-z0-9]{20}$/);

  const repeated = await api('POST', '/igor/api/conversations', { idempotencyKey: first, message: 'Hello Igor' });
  assert.equal(repeated.status, 200); assert.equal(repeated.body.conversation.id, conversation.id);
  const done = (await settled(api, conversation.id)).body.conversation;
  assert.deepEqual(done.messages.map(({ status, content, transport }) => ({ status, content, transport })), [{ status: 'complete', content: 'Hello Igor', transport: undefined }, { status: 'complete', content: 'Echo: Hello Igor', transport: 'fake' }]);
  assert.equal(inference.calls.length, 1);
  const [{ token, turn }] = inference.calls;
  assert.equal(token, SECRET);
  assert.deepEqual({ ...turn, conversation: undefined }, { contract: 'stex.hermes.turn.v1', requestId: assistant.id, product: 'igor', conversation: undefined, operation: { kind: 'conversation' }, context: {}, budget: { maxContextChars: 24_000, maxOutputChars: 8_000, timeoutMs: 60_000 } });
  assert.deepEqual(turn.conversation, { id: conversation.id, messages: [{ role: 'user', content: 'Hello Igor' }] });

  const second = key('second');
  const followUp = await api('POST', `/igor/api/conversations/${conversation.id}/messages`, { idempotencyKey: second, content: 'And then?' });
  assert.equal(followUp.status, 202); assert.equal(followUp.body.conversation.messages.at(-1).status, 'pending');
  await settled(api, conversation.id);
  assert.equal((await api('POST', `/igor/api/conversations/${conversation.id}/messages`, { idempotencyKey: second, content: 'And then?' })).status, 200);
  assert.equal((await api('POST', `/igor/api/conversations/${conversation.id}/messages`, { idempotencyKey: first, content: 'Reused key' })).status, 409);
  const other = (await api('POST', '/igor/api/conversations', { idempotencyKey: key('other'), message: 'Other topic' })).body.conversation;
  await settled(api, other.id);
  assert.equal(inference.calls.length, 3);
  assert.deepEqual(inference.calls[1].turn.conversation, { id: conversation.id, messages: [{ role: 'user', content: 'Hello Igor' }, { role: 'assistant', content: 'Echo: Hello Igor' }, { role: 'user', content: 'And then?' }] });
  assert.deepEqual(inference.calls[2].turn.conversation, { id: other.id, messages: [{ role: 'user', content: 'Other topic' }] });

  const list = (await api('GET', '/igor/api/conversations')).body.conversations;
  assert.deepEqual(list.map(({ id, state, messageCount }) => ({ id, state, messageCount })), [{ id: other.id, state: 'idle', messageCount: 2 }, { id: conversation.id, state: 'idle', messageCount: 4 }]);

  // Health maps the inference service's transport and is cached.
  assert.deepEqual((await api('GET', '/igor/api/health')).body, { ok: true, transport: 'fake' });
  await api('GET', '/igor/api/health');
  assert.equal(inference.health.count, 1);

  // The interface: deep links get index.html; assets keep their type; nothing escapes dist.
  for (const route of ['/igor/', '/igor/c/abc', '/igor/new']) {
    const page = await api('GET', route);
    assert.equal(page.status, 200, route); assert.match(page.headers.get('content-type'), /^text\/html/, route); assert.match(page.text, /Igor fixture/, route); assert.match(page.headers.get('content-security-policy'), /img-src 'self' data:/, route);
    assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
  }
  const script = await api('GET', '/igor/assets/app.js');
  assert.equal(script.headers.get('content-type'), 'text/javascript; charset=utf-8'); assert.equal(script.headers.get('x-content-type-options'), 'nosniff');
  for (const route of ['/igor/assets/missing.js', '/igor/%2e%2e/server.mjs', '/design-system/package.json', '/igor/api/unknown']) assert.equal((await api('GET', route)).status, 404, route);
  assert.match((await api('GET', '/design-system/src/stex.css')).headers.get('content-type'), /^text\/css/);
  for (const route of ['/', '/igor']) {
    const redirect = await fetch(`http://127.0.0.1:4631${route}`, { redirect: 'manual' });
    assert.equal(redirect.status, 308); assert.equal(redirect.headers.get('location'), '/igor/');
  }
  assert.ok(!bodies.some((body) => body.includes(SECRET)));
  assert.ok(!igor.output.text.includes(SECRET));
});

test('classifies failures, keeps the question, retries with the same requestId, and discards deleted turns', async (context) => {
  const inference = await startInference(context, 4632);
  await startIgor(context, 4633, { dataDir: await temporary(context, 'igor-data-'), distDir: path.join(os.tmpdir(), 'igor-no-dist'), inferenceUrl: inference.url });
  const bodies = []; const api = client(4633, bodies);
  const ask = async (message) => (await settled(api, (await api('POST', '/igor/api/conversations', { idempotencyKey: key('fail'), message })).body.conversation.id)).body.conversation;

  for (const [message, code] of [['unauthorized', 'UNAUTHORIZED'], ['upstream', 'TIMEOUT'], ['unconfigured', 'UNCONFIGURED'], ['malformed', 'MALFORMED_RESPONSE'], ['cancelled', 'CANCELLED']]) {
    const conversation = await ask(message);
    const [user, reply] = conversation.messages;
    assert.deepEqual([user.status, user.content], ['complete', message], message);
    assert.equal(reply.status, 'failed', message); assert.equal(reply.error.code, code, message); assert.ok(reply.error.message, message);
    if (code === 'UNCONFIGURED') assert.match(reply.error.message, /inference service has no safely configured Hermes/);
  }
  const listed = (await api('GET', '/igor/api/conversations')).body.conversations;
  assert.ok(listed.every((summary) => summary.state === 'failed'));

  const flaky = await ask('flaky');
  const [question, failed] = flaky.messages;
  const retryUrl = (id) => `/igor/api/conversations/${flaky.id}/messages/${id}/retry`;
  assert.equal((await api('POST', retryUrl(question.id), {})).status, 409);
  const retried = await api('POST', retryUrl(failed.id), {});
  assert.equal(retried.status, 202); assert.equal(retried.body.conversation.messages.at(-1).status, 'pending');
  const recovered = (await settled(api, flaky.id)).body.conversation;
  assert.deepEqual(recovered.messages.map((message) => message.id), [question.id, failed.id]);
  assert.equal(recovered.messages[1].content, 'Echo: flaky'); assert.equal(recovered.messages[1].error, undefined);
  assert.deepEqual(inference.calls.filter((call) => call.turn.conversation.id === flaky.id).map((call) => call.turn.requestId), [failed.id, failed.id]);
  assert.equal((await api('POST', retryUrl(failed.id), {})).status, 409); // complete, not failed

  // A failed reply that is no longer the latest message cannot be retried.
  const stale = await ask('unauthorized');
  await api('POST', `/igor/api/conversations/${stale.id}/messages`, { idempotencyKey: key('next'), content: 'next' });
  await settled(api, stale.id);
  const staleRetry = await api('POST', `/igor/api/conversations/${stale.id}/messages/${stale.messages[1].id}/retry`, {});
  assert.equal(staleRetry.status, 409); assert.equal(staleRetry.body.code, 'CONFLICT');

  // Deleting a conversation while its turn runs aborts the turn upstream and discards the reply.
  const gated = (await api('POST', '/igor/api/conversations', { idempotencyKey: key('gate'), message: 'gate' })).body.conversation;
  await until(async () => inference.gates.length, (count) => count === 1, 'the gated turn');
  assert.equal((await api('DELETE', `/igor/api/conversations/${gated.id}`, {})).status, 204);
  await until(async () => inference.aborted, (ids) => ids.includes(gated.messages[1].id), 'the aborted turn');
  inference.gates[0]();
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal((await api('GET', `/igor/api/conversations/${gated.id}`)).status, 404);
  assert.ok(!(await api('GET', '/igor/api/conversations')).body.conversations.some((summary) => summary.id === gated.id));
  assert.ok(!bodies.some((body) => body.includes(SECRET) || body.includes('secret upstream detail')));
});

test('runs turns one at a time across conversations and refuses a non-loopback inference URL', async (context) => {
  const inference = await startInference(context, 4638);
  await startIgor(context, 4639, { dataDir: await temporary(context, 'igor-data-'), distDir: path.join(os.tmpdir(), 'igor-no-dist'), inferenceUrl: inference.url });
  const api = client(4639, []);
  const first = (await api('POST', '/igor/api/conversations', { idempotencyKey: key('first'), message: 'gate' })).body.conversation;
  const second = (await api('POST', '/igor/api/conversations', { idempotencyKey: key('second'), message: 'second' })).body.conversation;
  await until(async () => inference.calls.length, (count) => count === 1, 'the first turn');
  await new Promise((resolve) => setTimeout(resolve, 150));
  // The second conversation waits, still pending, instead of failing as busy.
  assert.equal(inference.calls.length, 1);
  assert.equal((await api('GET', `/igor/api/conversations/${second.id}`)).body.conversation.messages[1].status, 'pending');
  inference.gates[0]();
  assert.equal((await settled(api, first.id)).body.conversation.messages[1].content, 'Echo: gate');
  assert.equal((await settled(api, second.id)).body.conversation.messages[1].content, 'Echo: second');
  assert.deepEqual(inference.calls.map((call) => call.turn.conversation.id), [first.id, second.id]);

  // The shared secret never travels off this machine: Igor will not start.
  const refused = spawn(process.execPath, ['server.mjs'], { cwd: appDirectory, env: { ...process.env, STEX_IGOR_PORT: '4640', STEX_IGOR_DATA_DIR: await temporary(context, 'igor-data-'), STEX_INFERENCE_URL: 'http://inference.example.test:8100', STEX_INFERENCE_SHARED_SECRET: SECRET } });
  let output = ''; refused.stderr.on('data', (data) => { output += data; }); refused.stdout.on('data', (data) => { output += data; });
  assert.equal(await new Promise((resolve) => refused.once('exit', resolve)), 1);
  assert.match(output, /STEX_INFERENCE_URL must be a loopback HTTP origin/); assert.ok(!output.includes(SECRET));
});

test('turns a reply pending at restart into INTERRUPTED without replaying it', async (context) => {
  const inference = await startInference(context, 4634);
  const dataDir = await temporary(context, 'igor-data-');
  const options = { dataDir, distDir: path.join(os.tmpdir(), 'igor-no-dist'), inferenceUrl: inference.url };
  const first = await startIgor(context, 4635, options);
  const api = client(4635, []);
  const created = (await api('POST', '/igor/api/conversations', { idempotencyKey: key('hang'), message: 'hang' })).body.conversation;
  await until(async () => inference.calls.length, (count) => count === 1, 'the hanging turn');
  const busy = await api('POST', `/igor/api/conversations/${created.id}/messages`, { idempotencyKey: key('busy'), content: 'Are you there?' });
  assert.equal(busy.status, 409); assert.equal(busy.body.code, 'CONFLICT');
  first.child.kill(); await first.exited;

  await startIgor(context, 4635, options);
  const after = (await api('GET', `/igor/api/conversations/${created.id}`)).body.conversation;
  assert.equal(after.messages.length, 2);
  assert.deepEqual([after.messages[1].status, after.messages[1].error], ['failed', { code: 'INTERRUPTED', message: 'Igor was restarted before this reply finished. Retry to ask again.' }]);
  assert.equal((await api('GET', '/igor/api/conversations')).body.conversations[0].state, 'failed');
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(inference.calls.length, 1);
  const stored = JSON.parse(await readFile(path.join(dataDir, 'conversations.json'), 'utf8'));
  assert.equal(stored.schemaVersion, 'stex.igor.store.v1');
  assert.equal(stored.conversations[0].messages[1].error.code, 'INTERRUPTED');
});

test('renames, archives, deletes, validates, and refuses foreign callers', async (context) => {
  await startIgor(context, 4636, { dataDir: await temporary(context, 'igor-data-'), distDir: path.join(os.tmpdir(), 'igor-no-dist') });
  const bodies = []; const api = client(4636, bodies);
  const empty = await api('POST', '/igor/api/conversations', { idempotencyKey: key('empty') });
  assert.equal(empty.status, 201);
  const { id } = empty.body.conversation;
  assert.deepEqual([empty.body.conversation.title, empty.body.conversation.messages], ['New conversation', []]);
  const titled = await api('POST', `/igor/api/conversations/${id}/messages`, { idempotencyKey: key('first'), content: 'First line\nsecond line' });
  assert.equal(titled.body.conversation.title, 'First line');
  // Without STEX_INFERENCE_URL the reply fails honestly and health says so.
  assert.equal((await settled(api, id)).body.conversation.messages[1].error.code, 'UNCONFIGURED');
  assert.deepEqual((await api('GET', '/igor/api/health')).body, { ok: false, transport: 'unavailable' });
  const unbuilt = await api('GET', '/igor/c/abc');
  assert.equal(unbuilt.status, 503); assert.match(unbuilt.text, /corepack pnpm build:igor/);

  const renamed = await api('PATCH', `/igor/api/conversations/${id}`, { title: '  My   title ' });
  assert.deepEqual([renamed.body.conversation.title, renamed.body.conversation.titleSource], ['My title', 'user']);
  assert.equal((await api('PATCH', `/igor/api/conversations/${id}`, { archived: true })).body.conversation.archived, true);
  const second = (await api('POST', '/igor/api/conversations', { idempotencyKey: key('second') })).body.conversation;
  for (const [route, body] of [[`/igor/api/conversations/${id}`, { title: '' }], [`/igor/api/conversations/${id}`, { title: 'x'.repeat(121) }], [`/igor/api/conversations/${id}`, { archived: 'yes' }], [`/igor/api/conversations/${id}`, {}],
    ['/igor/api/conversations', { idempotencyKey: 'short', message: 'Hi' }], ['/igor/api/conversations', { idempotencyKey: key('long'), message: 'x'.repeat(6_001) }], ['/igor/api/conversations', { idempotencyKey: key('blank'), message: '   ' }],
    [`/igor/api/conversations/${second.id}/messages`, { idempotencyKey: key('none') }], ['/igor/api/conversations', '{"idempotencyKey":'], ['/igor/api/conversations', '[]']]) {
    const response = await api(route.endsWith('conversations') || route.endsWith('messages') ? 'POST' : 'PATCH', route, body);
    assert.equal(response.status, 400, JSON.stringify(body).slice(0, 60)); assert.equal(response.body.code, 'INVALID_REQUEST');
  }
  const oversized = await api('POST', '/igor/api/conversations', JSON.stringify({ idempotencyKey: key('big'), message: 'x', padding: '語'.repeat(22_000) }));
  assert.equal(oversized.status, 413);
  assert.equal((await api('GET', '/igor/api/conversations/aaaaaaaaaaaa')).status, 404);
  assert.equal((await api('DELETE', `/igor/api/conversations/${second.id}`, {})).status, 204);
  assert.deepEqual((await api('GET', '/igor/api/conversations')).body.conversations.map((summary) => [summary.id, summary.title, summary.archived, summary.state]), [[id, 'My title', true, 'failed']]);

  for (const [headers, status] of [[{ 'content-type': 'text/plain' }, 415], [{ ...json, origin: 'https://example.test' }, 403], [{ ...json, 'sec-fetch-site': 'cross-site' }, 403],
    [{ ...json, origin: 'http://127.0.0.1:4300', 'x-forwarded-host': 'attacker.test' }, 403]]) {
    const response = await api('POST', '/igor/api/conversations', { idempotencyKey: key('forged'), message: 'Hello' }, headers);
    assert.equal(response.status, status, JSON.stringify(headers));
  }
  // The same origin the browser saw through Pantheon's proxy is accepted.
  const proxied = await api('POST', '/igor/api/conversations', { idempotencyKey: key('proxied') }, { ...json, origin: 'http://127.0.0.1:4300', 'x-forwarded-host': '127.0.0.1:4300', 'sec-fetch-site': 'same-origin' });
  assert.equal(proxied.status, 201);
  // fetch() cannot forge Host, so DNS rebinding is simulated with raw requests (reads too).
  assert.equal(await raw(4636, 'POST', '/igor/api/conversations', { host: 'attacker.test:4636', ...json }), 403);
  assert.equal(await raw(4636, 'GET', '/igor/api/conversations', { host: 'attacker.test:4636' }), 403);
  // Through a proxy the browser's Host arrives as x-forwarded-host; a rebound one is refused, reads included.
  assert.equal(await raw(4636, 'GET', '/igor/api/conversations', { 'x-forwarded-host': 'attacker.test:4300' }), 403);
  assert.equal(await raw(4636, 'GET', '/igor/api/conversations', { 'x-forwarded-host': '' }), 403);
  assert.ok(!bodies.some((body) => body.includes(SECRET)));
});

test('reports an unreachable inference service as unavailable', async (context) => {
  await startIgor(context, 4637, { dataDir: await temporary(context, 'igor-data-'), distDir: path.join(os.tmpdir(), 'igor-no-dist'), inferenceUrl: 'http://127.0.0.1:4659' });
  const api = client(4637, []);
  const created = (await api('POST', '/igor/api/conversations', { idempotencyKey: key('down'), message: 'Hello' })).body.conversation;
  assert.equal((await settled(api, created.id)).body.conversation.messages[1].error.code, 'UNAVAILABLE');
  assert.deepEqual((await api('GET', '/igor/api/health')).body, { ok: false, transport: 'unavailable' });
});

// Hosted mode: Cloudflare Access tokens signed with a test key, served by a loopback stand-in for the team's certs URL.
const TEAM = 'stex-test.cloudflareaccess.com';
const AUD = 'a'.repeat(64);
const PUBLIC = 'https://igor.example.test';
function accessToken(privateKey, claims, { kid = 'test-key', alg = 'RS256' } = {}) {
  const part = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const body = `${part({ alg, kid, typ: 'JWT' })}.${part(claims)}`;
  return `${body}.${sign('RSA-SHA256', Buffer.from(body), privateKey).toString('base64url')}`;
}
function hostedRequest(port, method, route, headers, body) {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: '127.0.0.1', port, path: route, method, headers }, (response) => {
      let text = ''; response.on('data', (data) => { text += data; }); response.on('end', () => resolve({ status: response.statusCode, text }));
    });
    request.on('error', reject); request.end(body);
  });
}

test('hosted mode serves nothing without a valid Cloudflare Access token and accepts only its public origin', async (context) => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  const certs = http.createServer((request, response) => { response.writeHead(200, json); response.end(JSON.stringify({ keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'test-key', alg: 'RS256' }] })); });
  await new Promise((resolve) => certs.listen(4641, '127.0.0.1', resolve));
  context.after(() => certs.close());
  const env = { STEX_IGOR_PUBLIC_ORIGIN: PUBLIC, STEX_IGOR_ACCESS_TEAM_DOMAIN: TEAM, STEX_IGOR_ACCESS_AUD: AUD, STEX_IGOR_ACCESS_CERTS_URL: 'http://127.0.0.1:4641/certs', STEX_IGOR_ACCESS_EMAILS: 'owner@example.test' };
  const dist = await temporary(context, 'igor-dist-');
  await writeFile(path.join(dist, 'index.html'), '<!doctype html><title>Igor fixture</title>');
  await startIgor(context, 4642, { dataDir: await temporary(context, 'igor-data-'), distDir: dist, env });

  const now = Math.floor(Date.now() / 1000);
  const good = { iss: `https://${TEAM}`, aud: [AUD], email: 'owner@example.test', exp: now + 600, nbf: now - 5 };
  const valid = accessToken(privateKey, good);
  const as = (token, extra = {}) => ({ host: 'igor.example.test', ...(token ? { 'cf-access-jwt-assertion': token } : {}), ...extra });

  // No token, or any defect in it: the page shell, assets, and API are all refused.
  for (const route of ['/igor/', '/design-system/brand/pantheon-favicon.svg', '/igor/api/conversations']) assert.equal((await hostedRequest(4642, 'GET', route, as(null))).status, 403, route);
  const forged = [
    ['other signing key', accessToken(other, good)],
    ['wrong audience', accessToken(privateKey, { ...good, aud: ['b'.repeat(64)] })],
    ['wrong issuer', accessToken(privateKey, { ...good, iss: 'https://evil.cloudflareaccess.com' })],
    ['expired', accessToken(privateKey, { ...good, exp: now - 600 })],
    ['not yet valid', accessToken(privateKey, { ...good, nbf: now + 600 })],
    ['other email', accessToken(privateKey, { ...good, email: 'someone@example.test' })],
    ['alg none', `${Buffer.from(JSON.stringify({ alg: 'none', kid: 'test-key' })).toString('base64url')}.${Buffer.from(JSON.stringify(good)).toString('base64url')}.`],
    ['garbage', 'not-a-token'],
  ];
  for (const [label, token] of forged) assert.equal((await hostedRequest(4642, 'GET', '/igor/api/conversations', as(token))).status, 403, label);

  // A valid token works for the public host; a foreign Host is still refused.
  assert.equal((await hostedRequest(4642, 'GET', '/igor/', as(valid))).status, 200);
  assert.equal((await hostedRequest(4642, 'GET', '/igor/api/conversations', as(valid))).status, 200);
  assert.equal((await hostedRequest(4642, 'GET', '/igor/api/conversations', as(valid, { host: 'attacker.test' }))).status, 403);

  // Mutations accept only the https public origin.
  const body = (label) => JSON.stringify({ idempotencyKey: key(label) });
  const write = (origin, label) => hostedRequest(4642, 'POST', '/igor/api/conversations', as(valid, { 'content-type': 'application/json', origin, 'sec-fetch-site': 'same-origin' }), body(label));
  assert.equal((await write(PUBLIC, 'public')).status, 201);
  assert.equal((await write('http://igor.example.test', 'plain-http')).status, 403);
  assert.equal((await write('https://evil.example.test', 'evil')).status, 403);
});

test('hosted mode refuses to start half-configured, and fails closed when the signing keys cannot be read', async (context) => {
  assert.equal(hostedConfig({}), null);
  assert.throws(() => hostedConfig({ STEX_IGOR_PUBLIC_ORIGIN: PUBLIC }), /STEX_IGOR_ACCESS_TEAM_DOMAIN/);
  assert.throws(() => hostedConfig({ STEX_IGOR_PUBLIC_ORIGIN: PUBLIC, STEX_IGOR_ACCESS_TEAM_DOMAIN: TEAM }), /STEX_IGOR_ACCESS_AUD/);
  assert.throws(() => hostedConfig({ STEX_IGOR_PUBLIC_ORIGIN: 'http://igor.example.test', STEX_IGOR_ACCESS_TEAM_DOMAIN: TEAM, STEX_IGOR_ACCESS_AUD: AUD }), /https origin/);
  assert.throws(() => hostedConfig({ STEX_IGOR_PUBLIC_ORIGIN: PUBLIC, STEX_IGOR_ACCESS_TEAM_DOMAIN: TEAM, STEX_IGOR_ACCESS_AUD: AUD, STEX_IGOR_ACCESS_CERTS_URL: 'http://certs.example.test/' }), /must be https/);

  const config = hostedConfig({ STEX_IGOR_PUBLIC_ORIGIN: PUBLIC, STEX_IGOR_ACCESS_TEAM_DOMAIN: TEAM, STEX_IGOR_ACCESS_AUD: AUD });
  assert.equal(config.certsUrl, `https://${TEAM}/cdn-cgi/access/certs`);
  const verify = createAccessVerifier(config, { fetchImpl: async () => { throw new Error('offline'); } });
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const now = Math.floor(Date.now() / 1000);
  await assert.rejects(verify({ 'cf-access-jwt-assertion': accessToken(privateKey, { iss: `https://${TEAM}`, aud: AUD, exp: now + 60 }) }), (error) => error.status === 503);

  // The server itself will not start in hosted mode without its Access settings.
  const refused = spawn(process.execPath, ['server.mjs'], { cwd: appDirectory, env: { ...process.env, STEX_IGOR_PORT: '4643', STEX_IGOR_DATA_DIR: await temporary(context, 'igor-data-'), STEX_IGOR_PUBLIC_ORIGIN: PUBLIC } });
  let output = ''; refused.stderr.on('data', (data) => { output += data; });
  assert.equal(await new Promise((resolve) => refused.once('exit', resolve)), 1);
  assert.match(output, /STEX_IGOR_ACCESS_TEAM_DOMAIN/);
});
