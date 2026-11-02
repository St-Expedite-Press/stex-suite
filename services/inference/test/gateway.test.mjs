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
  assert.equal(request.context.directorKit.version, 'stex.texgraph.director-kit.v1');
  assert.ok(request.context.directorKit.skills.some((skill) => skill.id === 'texgraph.composition'));
  assert.ok(request.context.directorKit.mcpServers.some((server) => server.id === 'markitdown' && server.access === 'review-gated-context-adapter'));
});

test('fails closed when Hermes returns a malformed proposal', async () => {
  const gateway = createGateway({ config, fetchImpl: async () => new Response(JSON.stringify({ status: 'completed', result: { reply: JSON.stringify({ commentary: 'Oops', proposal: { source: 3 } }) } }), { status: 200 }) });
  await assert.rejects(() => gateway.handle({ token: 'test-token', kind: 'page-turn', body: { message: 'revise this' } }), /malformed/);
});

test('scope turns offer the scope sources and pass well-formed changes back', async () => {
  const requests = [];
  const gateway = createGateway({ config, sleep: async () => {}, fetchImpl: async (url, options = {}) => {
    requests.push({ url: String(url), options });
    return new Response(JSON.stringify({ status: 'completed', result: { reply: JSON.stringify({ commentary: 'Tightened both.', changes: [{ nodeId: 'node-a', source: '# A\n\nNew.', summary: 'Cut a line.' }] }) } }), { status: 200 });
  } });
  const result = await gateway.handle({ token: 'test-token', kind: 'scope-turn', body: { message: 'Tighten this section.', scope: { id: 'scope-node-a', kind: 'section', title: 'One' }, scopeSources: [{ nodeId: 'node-a', source: '# A\n\nOld.' }] } });
  assert.deepEqual(result.changes, [{ nodeId: 'node-a', source: '# A\n\nNew.', summary: 'Cut a line.' }]); assert.equal(result.noChange, false);
  const request = JSON.parse(requests[0].options.body);
  assert.equal(request.context.selectedTarget.scope.kind, 'section'); assert.equal(request.context.selectedTarget.scopeSources[0].source, '# A\n\nOld.');
  assert.equal(request.context.directorKit.version, 'stex.texgraph.director-kit.v2'); assert.match(request.context.procedure, /scopeSources/);
  assert.ok(request.context.directorKit.skills.find((skill) => skill.id === 'texgraph.markdown-revision').rules.some((rule) => /scopeSources/.test(rule)));
});

test('fails closed when Hermes returns malformed scope changes', async () => {
  for (const changes of [{ nodeId: 'node-a' }, [{ nodeId: 'node-a', source: 3 }], [{ source: 'x' }]]) {
    const gateway = createGateway({ config, fetchImpl: async () => new Response(JSON.stringify({ status: 'completed', result: { reply: JSON.stringify({ commentary: 'Oops', changes }) } }), { status: 200 }) });
    await assert.rejects(() => gateway.handle({ token: 'test-token', kind: 'scope-turn', body: { message: 'revise' } }), /malformed/);
  }
});

test('page turns keep the v1 reply shape and ignore a changes field', async () => {
  const gateway = createGateway({ config, fetchImpl: async () => new Response(JSON.stringify({ status: 'completed', result: { reply: JSON.stringify({ commentary: 'Revised.', proposal: { source: '# A' }, changes: 'junk' }) } }), { status: 200 }) });
  const result = await gateway.handle({ token: 'test-token', kind: 'page-turn', body: { message: 'revise' } });
  assert.deepEqual(result, { commentary: 'Revised.', noChange: false, proposal: { source: '# A' }, graphSuggestions: [], ticketUpdates: null });
});
