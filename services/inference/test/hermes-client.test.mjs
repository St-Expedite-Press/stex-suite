import assert from 'node:assert/strict';
import test from 'node:test';
import { HERMES_TURN_CONTRACT, createHermesClient, validateHermesTurn } from '../src/hermes-client.mjs';

const request = (overrides = {}) => ({ contract: HERMES_TURN_CONTRACT, requestId: 'turn-01', product: 'seaxneat', conversation: { id: 'project-01', messages: [{ role: 'user', content: 'Change the hero title.' }] }, operation: { kind: 'edit', payload: { target: 'app/page.tsx' } }, budget: { maxContextChars: 2000, maxOutputChars: 2000, timeoutMs: 1000 }, ...overrides });
const config = { sharedSecret: 'test-secret', hermesMaxContextChars: 5000, hermesMaxOutputChars: 5000, hermesMaxTimeoutMs: 2000 };

test('generic Hermes validation rejects unversioned, oversized and malformed turns', () => {
  assert.equal(validateHermesTurn(request(), config).product, 'seaxneat');
  assert.throws(() => validateHermesTurn({ ...request(), contract: 'v0' }, config), { code: 'UNKNOWN_CONTRACT' });
  assert.throws(() => validateHermesTurn(request({ budget: { maxContextChars: 5001 } }), config), { code: 'INVALID_REQUEST' });
  assert.throws(() => validateHermesTurn(request({ conversation: { messages: [] } }), config), { code: 'INVALID_REQUEST' });
  assert.throws(() => validateHermesTurn(request({ context: { source: 'x'.repeat(3000) }, budget: { maxContextChars: 100, maxOutputChars: 1000, timeoutMs: 1000 } }), config), { code: 'CONTEXT_TOO_LARGE' });
});

test('the fake Hermes transport is deterministic, authenticated, sequenced and cancellable', async () => {
  const client = createHermesClient({ config });
  assert.deepEqual(client.health(), { ok: true, contract: HERMES_TURN_CONTRACT, transport: 'fake', configured: true });
  await assert.rejects(() => client.turn({ token: 'wrong', body: request() }), { code: 'UNAUTHORIZED' });
  const reply = await client.turn({ token: 'test-secret', body: request() });
  assert.equal(reply.usage.transport, 'fake'); assert.deepEqual(reply.events.map((event) => event.sequence), [1, 2]);
  const cancelled = await client.turn({ token: 'test-secret', body: request({ operation: { kind: 'cancel' } }) });
  assert.equal(cancelled.status, 'cancelled');
});

const upstreamConfig = { ...config, hermesTransport: 'remote', hermesUrl: 'http://127.0.0.1:8642/root', hermesApiKey: 'remote-secret', hermesIsolation: 'verified', hermesToolPolicy: 'conversational-only' };

test('the upstream adapter translates the stable envelope to authenticated Chat Completions without granting tools', async () => {
  const calls = [];
  const remote = createHermesClient({ config: upstreamConfig, fetchImpl: async (url, options) => {
    calls.push({ url: String(url), options });
    return new Response(JSON.stringify({ choices: [{ message: { content: 'Remote answer.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 4 } }), { status: 200 });
  } });
  const reply = await remote.turn({ token: 'test-secret', body: request({ operation: { kind: 'conversation' } }) });
  const upstream = JSON.parse(calls[0].options.body);
  assert.equal(reply.events[0].payload.text, 'Remote answer.'); assert.equal(reply.usage.inputTokens, 12); assert.equal(calls[0].url, 'http://127.0.0.1:8642/root/v1/chat/completions'); assert.equal(calls[0].options.headers.authorization, 'Bearer remote-secret');
  assert.match(calls[0].options.headers['x-hermes-session-id'], /^stex-seaxneat-[a-f0-9]{40}$/);
  assert.equal(calls[0].options.headers['idempotency-key'], 'turn-01'); assert.deepEqual(upstream.tools, []); assert.equal(upstream.tool_choice, 'none');
  assert.equal(upstream.messages.at(-1).content, 'Change the hero title.'); assert.match(upstream.messages[0].content, /untrusted application context/);
  const rejected = createHermesClient({ config: upstreamConfig, fetchImpl: async () => new Response('', { status: 401 }) });
  await assert.rejects(() => rejected.turn({ token: 'test-secret', body: request() }), { code: 'HERMES_AUTH' });
  const unavailable = createHermesClient({ config: { ...config, hermesTransport: 'remote' } });
  assert.equal(unavailable.health().configured, false);
  await assert.rejects(() => unavailable.turn({ token: 'test-secret', body: request() }), { code: 'UNCONFIGURED' });
});

test('the upstream adapter supports Responses, cancellation and malformed-response failures without exposing credentials', async () => {
  const responses = createHermesClient({ config: { ...upstreamConfig, hermesApiMode: 'responses' }, fetchImpl: async (url, options) => {
    assert.equal(String(url), 'http://127.0.0.1:8642/root/v1/responses'); assert.equal(JSON.parse(options.body).input.at(-1).content, 'Change the hero title.');
    return new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Persistent answer.' }] }], usage: { input_tokens: 5, output_tokens: 3 } }), { status: 200 });
  } });
  assert.equal((await responses.turn({ token: 'test-secret', body: request() })).events[0].payload.text, 'Persistent answer.');
  const controller = new AbortController(); controller.abort();
  const cancelled = createHermesClient({ config: { ...upstreamConfig, hermesApiKey: 'do-not-leak' }, fetchImpl: async () => { throw new Error('should not matter'); } });
  await assert.rejects(() => cancelled.turn({ token: 'test-secret', body: request(), signal: controller.signal }), { code: 'CANCELLED' });
  const malformed = createHermesClient({ config: { ...upstreamConfig, hermesApiKey: 'do-not-leak' }, fetchImpl: async () => new Response('{}', { status: 200 }) });
  const error = await malformed.turn({ token: 'test-secret', body: request() }).catch((failure) => failure);
  assert.equal(error.code, 'HERMES_MALFORMED'); assert.doesNotMatch(error.message, /do-not-leak/);
});

test('the upstream adapter rejects non-loopback targets, never bills cancellation, scopes sessions, and bounds concurrency', async () => {
  const unsafe = createHermesClient({ config: { ...upstreamConfig, hermesUrl: 'https://not-loopback.test' } });
  assert.equal(unsafe.health().configured, false);
  await assert.rejects(() => unsafe.turn({ token: 'test-secret', body: request() }), { code: 'UNCONFIGURED' });

  let calls = 0; let release;
  const waiting = createHermesClient({ config: upstreamConfig, fetchImpl: async () => {
    calls += 1; await new Promise((resolve) => { release = resolve; });
    return new Response(JSON.stringify({ choices: [{ message: { content: 'done' }, finish_reason: 'stop' }] }), { status: 200 });
  } });
  const first = waiting.turn({ token: 'test-secret', body: request() });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await assert.rejects(() => waiting.turn({ token: 'test-secret', body: request({ requestId: 'turn-02' }) }), { code: 'HERMES_BUSY' });
  release(); await first; assert.equal(calls, 1);

  const noBill = createHermesClient({ config: upstreamConfig, fetchImpl: async () => { throw new Error('must not call upstream for cancellation'); } });
  const cancelled = await noBill.turn({ token: 'test-secret', body: request({ operation: { kind: 'cancel' } }) });
  assert.equal(cancelled.status, 'cancelled');

  const ids = [];
  const sessions = createHermesClient({ config: upstreamConfig, fetchImpl: async (_url, options) => {
    ids.push(options.headers['x-hermes-session-id']); return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] }), { status: 200 });
  } });
  await sessions.turn({ token: 'test-secret', body: request({ conversation: { id: 'scope-a', messages: [{ role: 'user', content: 'A' }] } }) });
  await sessions.turn({ token: 'test-secret', body: request({ requestId: 'turn-03', conversation: { id: 'scope-b', messages: [{ role: 'user', content: 'B' }] } }) });
  assert.notEqual(ids[0], ids[1]);
});
