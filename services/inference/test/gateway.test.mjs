import assert from 'node:assert/strict';
import test from 'node:test';
import { createGateway } from '../src/gateway.mjs';

const config = { sharedSecret: 'test-token', apiKey: 'provider-key', model: 'test-model', baseUrl: 'https://provider.test/v1', siteUrl: 'http://localhost', appName: 'test', maxInputTokens: 1000, maxOutputTokens: 200, timeoutMs: 1000 };

test('rejects callers without the private shared token', async () => {
  const gateway = createGateway({ config, fetchImpl: async () => { throw new Error('must not call provider'); } });
  await assert.rejects(() => gateway.handle({ token: 'wrong', kind: 'interview', body: { message: 'hello' } }), { status: 401 });
});

test('sends bounded interview context to the provider and validates its ticket', async () => {
  let request;
  const gateway = createGateway({ config, fetchImpl: async (_, options) => { request = JSON.parse(options.body); return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ commentary: 'Tell me the working title.', ticket: null }) } }] }), { status: 200 }); } });
  const result = await gateway.handle({ token: 'test-token', kind: 'interview', body: { message: 'I want to make a book.', context: 'Project: a poetry manuscript.', turns: [{ role: 'user', message: 'I have drafts.' }] } });
  assert.equal(result.commentary, 'Tell me the working title.');
  assert.equal(request.model, 'test-model');
  assert.equal(request.max_tokens, 200);
  assert.match(request.messages[0].content, /settings ticket/);
});

test('fails closed on malformed provider output', async () => {
  const gateway = createGateway({ config, fetchImpl: async () => new Response(JSON.stringify({ choices: [{ message: { content: 'not-json' } }] }), { status: 200 }) });
  await assert.rejects(() => gateway.handle({ token: 'test-token', kind: 'page-turn', body: { message: 'revise this' } }), /invalid structured response/);
});
