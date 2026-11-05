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

test('the remote adapter sends only the versioned envelope and classifies remote failures', async () => {
  const calls = [];
  const remote = createHermesClient({ config: { ...config, hermesTransport: 'remote', hermesUrl: 'https://hermes.test/root', hermesToken: 'remote-secret' }, fetchImpl: async (url, options) => {
    calls.push({ url: String(url), options });
    return new Response(JSON.stringify({ contract: HERMES_TURN_CONTRACT, requestId: 'turn-01', status: 'completed', events: [{ sequence: 1, type: 'message', payload: { text: 'Remote answer.' } }], usage: { inputChars: 1, outputChars: 2, transport: 'remote' } }), { status: 200 });
  } });
  const reply = await remote.turn({ token: 'test-secret', body: request({ operation: { kind: 'conversation' } }) });
  assert.equal(reply.events[0].payload.text, 'Remote answer.'); assert.equal(calls[0].url, 'https://hermes.test/root/v1/turn'); assert.equal(calls[0].options.headers.authorization, 'Bearer remote-secret');
  const rejected = createHermesClient({ config: { ...config, hermesTransport: 'remote', hermesUrl: 'https://hermes.test', hermesToken: 'remote-secret' }, fetchImpl: async () => new Response('', { status: 401 }) });
  await assert.rejects(() => rejected.turn({ token: 'test-secret', body: request() }), { code: 'HERMES_AUTH' });
  const unavailable = createHermesClient({ config: { ...config, hermesTransport: 'remote' } });
  assert.equal(unavailable.health().configured, false);
  await assert.rejects(() => unavailable.turn({ token: 'test-secret', body: request() }), { code: 'UNCONFIGURED' });
});

test('the remote adapter classifies cancellation and malformed responses without exposing credentials', async () => {
  const controller = new AbortController(); controller.abort();
  const cancelled = createHermesClient({ config: { ...config, hermesTransport: 'remote', hermesUrl: 'https://hermes.test', hermesToken: 'do-not-leak' }, fetchImpl: async () => { throw new Error('should not matter'); } });
  await assert.rejects(() => cancelled.turn({ token: 'test-secret', body: request(), signal: controller.signal }), { code: 'CANCELLED' });
  const malformed = createHermesClient({ config: { ...config, hermesTransport: 'remote', hermesUrl: 'https://hermes.test', hermesToken: 'do-not-leak' }, fetchImpl: async () => new Response('{}', { status: 200 }) });
  const error = await malformed.turn({ token: 'test-secret', body: request() }).catch((failure) => failure);
  assert.equal(error.code, 'HERMES_MALFORMED'); assert.doesNotMatch(error.message, /do-not-leak/);
});
