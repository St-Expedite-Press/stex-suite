import assert from 'node:assert/strict';
import test from 'node:test';
import { createGateway } from '../src/gateway.mjs';

const config = { sharedSecret: 'test-token', hermesUrl: 'https://hermes.test/', hermesKey: 'internal-key', maxInputTokens: 1000, timeoutMs: 1000 };

test('rejects callers without the private shared token', async () => {
  const gateway = createGateway({ config, fetchImpl: async () => { throw new Error('must not call Hermes'); } });
  await assert.rejects(() => gateway.handle({ token: 'wrong', kind: 'interview', body: { message: 'hello' } }), { status: 401 });
});

test('sends a bounded TexGraph envelope to Hermes and returns its structured reply', async () => {
  const requests = [];
  const gateway = createGateway({ config, sleep: async () => {}, fetchImpl: async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (String(url).includes('/conversations/')) return new Response(JSON.stringify({ status: 'running' }), { status: 202 });
    return new Response(JSON.stringify({ status: 'completed', result: { reply: JSON.stringify({ commentary: 'Keep this image.', noChange: true, graphSuggestions: [{ kind: 'sequence', message: 'Review its neighbor.' }] }) } }), { status: 200 });
  } });
  const result = await gateway.handle({ token: 'test-token', kind: 'page-turn', body: { message: 'Review this poem.', page: { id: 'node-example', source: 'A poem.' }, graph: { readingOrder: ['node-example'] }, turns: [{ role: 'user', message: 'Earlier.' }] } });
  assert.equal(result.commentary, 'Keep this image.'); assert.equal(result.noChange, true); assert.equal(result.graphSuggestions.length, 1);
  const request = JSON.parse(requests[0].options.body);
  assert.equal(request.actor, 'texgraph'); assert.equal(request.scope, 'texgraph'); assert.match(request.context.procedure, /TexGraph/);
  assert.equal(request.context.selectedTarget.source, 'A poem.'); assert.equal(requests[0].options.headers['x-screenlab-internal-key'], 'internal-key');
});

test('fails closed when Hermes returns a malformed proposal', async () => {
  const gateway = createGateway({ config, fetchImpl: async () => new Response(JSON.stringify({ status: 'completed', result: { reply: JSON.stringify({ commentary: 'Oops', proposal: { source: 3 } }) } }), { status: 200 }) });
  await assert.rejects(() => gateway.handle({ token: 'test-token', kind: 'page-turn', body: { message: 'revise this' } }), /malformed/);
});
