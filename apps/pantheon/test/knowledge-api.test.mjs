/** Pantheon regression tests source that checks knowledge api behavior with disposable fixtures. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { knowledgeApi } from '../src/knowledge-api.mjs';

/** Calls the handler using a disposable request and captures its response. */
async function invoke(handler, { chunks = [], method = 'GET', route = '', headers = {} } = {}) {
  const request = { method, headers: { host: '127.0.0.1:4300', 'content-type': 'application/json', ...headers }, /** Yields request bytes for the simulated HTTP input. */ async *[Symbol.asyncIterator]() { yield* chunks; } };
  let status; let value;
  await handler(request, { /** Captures the response status and headers for the assertion. */ writeHead(code) { status = code; }, /** Captures the response body for the assertion. */ end(raw) { value = JSON.parse(raw); } }, new URL('http://127.0.0.1:4300/api/knowledge/v1' + route));
  return { status, value };
}
/** Builds the empty response or state for the fixture. */
const empty = () => ({ enabled: true, version: 'fixture:0', graph: { projects: [], relations: [] }, knowledge: { sources: [] } });
test('knowledge JSON preserves multibyte characters split across network chunks and refuses foreign origins', async () => {
  let received;
  const handler = knowledgeApi({ knowledge: { view: empty, /** Supplies a synthetic revision operation for the tested journal. */ revise: async (body) => { received = body; } }, targets: {} });
  const bytes = Buffer.from(JSON.stringify({ object: '語' })); const index = bytes.indexOf(Buffer.from('語')) + 1;
  assert.equal((await invoke(handler, { method: 'POST', route: '/revise', chunks: [bytes.subarray(0, index), bytes.subarray(index)] })).status, 200);
  assert.equal(received.object, '語');
  assert.equal((await invoke(handler, { headers: { origin: 'null' } })).status, 403);
  assert.equal((await invoke(handler, { method: 'POST', route: '/revise', chunks: [Buffer.from([0xff])] })).status, 400);
});

test('knowledge source access has a whole-request deadline and fails closed for every stalled source', async () => {
  const view = empty();
  for (let i = 0; i < 8; i++) view.knowledge.sources.push({ id: 'source', project: `stex://frige/project/book-${i}`, reference: `stex://frige/project/book-${i}#source=source`, revision: 'a'.repeat(64) });
  let calls = 0;
  const handler = knowledgeApi({ knowledge: { /** Returns the knowledge view used in this scenario. */ view: () => view }, targets: { frige: new URL('http://127.0.0.1:4310') }, /** Supplies deterministic owner responses for the local API test. */ fetchImpl: async (_url, { signal }) => {
    calls++; await new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  } });
  const keepAlive = setInterval(() => {}, 1000);
  try { const start = Date.now(); const result = await invoke(handler); assert.ok(Date.now() - start < 7500); assert.ok(calls <= 8); assert.ok(result.value.knowledge.sources.every((source) => source.access === 'unavailable')); }
  finally { clearInterval(keepAlive); }
});
