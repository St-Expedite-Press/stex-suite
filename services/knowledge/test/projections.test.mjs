import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import { openKnowledge, rebuildKnowledge } from '../src/projections.mjs';

const project = { application: 'frige', id: 'test-book', reference: 'stex://frige/project/test-book', title: 'Synthetic book' };
const sha = (source) => createHash('sha256').update(source).digest('hex');
const directories = [];
after(() => Promise.all(directories.map((directory) => rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))));
function event(sequence = 1, source = 'First revision') {
  return { id: `revision-${sequence}`, sequence, occurredAt: '2026-11-07T18:00:00.000Z', project, sources: [{ id: 'node-one', reference: `${project.reference}#source=node-one`, title: 'One', revision: sha(source), bytes: Buffer.byteLength(source), mediaType: 'text/markdown', source }] };
}
async function temporary(context) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'stex-knowledge-'));
  directories.push(directory);
  return directory;
}
const code = (expected) => (error) => error.code === expected;
const accept = (store, sequence = 1) => store.accept({ idempotencyKey: `accept-${sequence}`, expectedVersion: store.view().version, event: event(sequence) });

test('knowledge is disabled without an explicit selected directory', async () => {
  const store = await openKnowledge();
  assert.equal(store.enabled, false); assert.equal(store.view().knowledge.sources.length, 0);
  await assert.rejects(() => store.accept({}), code('KNOWLEDGE_DISABLED'));
});

test('one accepted engine event updates both views exactly once, preserving provenance without text', async (context) => {
  const directory = await temporary(context); const store = await openKnowledge({ directory }); context.after(() => store.close());
  const version = store.view().version;
  const request = { idempotencyKey: 'accept-original', expectedVersion: version, event: event() };
  const first = await store.accept(request);
  assert.equal(first.knowledge.sources.length, 1); assert.equal(first.graph.projects[0].sourceCount, 1);
  assert.equal(first.knowledge.sources[0].revision, event().sources[0].revision);
  assert.equal(first.knowledge.sources[0].eventId, 'revision-1');
  assert.equal(first.knowledge.sources[0].source, undefined);
  const replay = await store.accept(request);
  assert.equal(replay.replayed, true); assert.equal(replay.version, first.version);
  assert.equal(store.export().journal.events.length, 1);
  assert.ok(!(await readFile(path.join(directory, 'knowledge.v1.json'), 'utf8')).includes('First revision'));
  await assert.rejects(() => store.accept({ ...request, event: event(2) }), code('KEY_CONFLICT'));
  await assert.rejects(() => store.accept({ ...request, idempotencyKey: 'different-key', expectedVersion: first.version }), code('EVENT_CONFLICT'));
});

test('out-of-order events, stale versions, conflicting parallel writes and invalid identities fail safely', async (context) => {
  const store = await openKnowledge({ directory: await temporary(context) }); context.after(() => store.close());
  await accept(store, 3); const before = store.view();
  await assert.rejects(() => accept(store, 2), code('STALE_EVENT'));
  await assert.rejects(() => store.accept({ idempotencyKey: 'stale-version', expectedVersion: 'wrong:0', event: event(4) }), code('STALE_KNOWLEDGE'));
  await assert.rejects(() => store.accept({ idempotencyKey: 'invalid-source', expectedVersion: before.version, event: { ...event(4), sources: [{ ...event(4).sources[0], reference: 'file:///private.md' }] } }), code('INVALID_SOURCE'));
  assert.deepEqual(store.view(), before);
  const results = await Promise.allSettled([4, 5].map((sequence) => store.accept({ idempotencyKey: `parallel-${sequence}`, expectedVersion: before.version, event: event(sequence) })));
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.find((result) => result.status === 'rejected').reason.code, 'STALE_KNOWLEDGE');
});

test('inferences require current evidence and confidence, remain distinct after acceptance, and support correction/rejection', async (context) => {
  const store = await openKnowledge({ directory: await temporary(context) }); context.after(() => store.close()); await accept(store);
  const relationship = { id: 'inference-one', kind: 'inference', subject: project.reference, predicate: 'explores', object: 'a proposed concept', confidence: 0.7, evidence: [{ reference: event().sources[0].reference, revision: event().sources[0].revision }] };
  const add = (relation, idempotencyKey) => store.relation({ idempotencyKey, expectedVersion: store.view().version, relation });
  await assert.rejects(() => add({ ...relationship, evidence: [] }, 'invalid-evidence'), code('INVALID_RELATION'));
  await assert.rejects(() => add({ ...relationship, confidence: 1.2 }, 'invalid-confidence'), code('INVALID_RELATION'));
  await assert.rejects(() => add({ ...relationship, evidence: [{ ...relationship.evidence[0], revision: sha('missing') }] }, 'missing-evidence'), code('STALE_EVIDENCE'));
  await add(relationship, 'propose-inference');
  assert.equal(store.view().graph.relations[0].status, 'proposed');
  await store.revise({ idempotencyKey: 'accept-inference', expectedVersion: store.view().version, id: relationship.id, status: 'accepted', object: 'a corrected concept' });
  assert.equal(store.view().graph.relations[0].kind, 'inference'); assert.equal(store.view().graph.relations[0].corrected, true);
  await store.revise({ idempotencyKey: 'reject-inference', expectedVersion: store.view().version, id: relationship.id, status: 'rejected', object: 'a corrected concept' });
  assert.equal(store.view().graph.relations[0].status, 'rejected');
  await add({ id: 'assertion-one', kind: 'assertion', subject: 'stex://knowledge/preference/writing', predicate: 'preferred period', object: 'mornings', evidence: [] }, 'explicit-assertion');
  assert.equal(store.view().graph.relations[1].kind, 'assertion'); assert.equal(store.view().graph.relations[1].status, 'accepted');
});

test('new revisions invalidate old evidence; consent withdrawal removes source availability and cannot be replayed back', async (context) => {
  const store = await openKnowledge({ directory: await temporary(context) }); context.after(() => store.close());
  const original = { idempotencyKey: 'original-accept', expectedVersion: store.view().version, event: event() };
  await store.accept(original);
  await store.relation({ idempotencyKey: 'relation-evidence', expectedVersion: store.view().version, relation: { id: 'assertion-evidence', kind: 'assertion', subject: project.reference, predicate: 'topic', object: 'synthetic', evidence: [{ reference: event().sources[0].reference, revision: event().sources[0].revision }] } });
  await store.accept({ idempotencyKey: 'updated-accept', expectedVersion: store.view().version, event: event(2, 'Different revision') });
  assert.equal(store.view().graph.relations[0].evidenceState, 'unavailable');
  await store.revoke({ idempotencyKey: 'revoke-project', expectedVersion: store.view().version, project: project.reference });
  assert.equal(store.view().knowledge.sources.length, 0); assert.equal(store.view().graph.projects[0].consent, false);
  const replay = await store.accept(original);
  assert.equal(replay.replayed, true); assert.equal(replay.knowledge.sources.length, 0);
  await assert.rejects(() => accept(store, 2), code('EVENT_CONFLICT'));
});

test('accept and reject preserve the relationship object when no correction is supplied', async (context) => {
  const directory = await temporary(context); let store = await openKnowledge({ directory });
  await accept(store);
  await store.relation({ idempotencyKey: 'optional-object-relation', expectedVersion: store.view().version, relation: { id: 'optional-object-inference', kind: 'inference', subject: project.reference, predicate: 'explores', object: 'Original inferred concept', confidence: 0.5, evidence: [{ reference: event().sources[0].reference, revision: event().sources[0].revision }] } });
  const revise = (status, idempotencyKey) => store.revise({ idempotencyKey, expectedVersion: store.view().version, id: 'optional-object-inference', status });
  await revise('accepted', 'optional-object-accept');
  assert.equal(store.view().graph.relations[0].object, 'Original inferred concept');
  assert.equal(store.view().graph.relations[0].status, 'accepted');
  assert.equal(store.view().graph.relations[0].corrected, false);
  await revise('rejected', 'optional-object-reject');
  const before = store.view(); assert.equal(before.graph.relations[0].object, 'Original inferred concept'); assert.equal(before.graph.relations[0].status, 'rejected');
  await store.close(); store = await openKnowledge({ directory }); context.after(() => store.close());
  assert.deepEqual(store.view(), before);
});

test('fresh explicit consent can restore the exact withdrawn checkpoint but replay and changed metadata cannot', async (context) => {
  const directory = await temporary(context); let store = await openKnowledge({ directory });
  const original = { idempotencyKey: 'consent-original', expectedVersion: store.view().version, event: event() };
  await store.accept(original);
  await store.revoke({ idempotencyKey: 'consent-withdraw', expectedVersion: store.view().version, project: project.reference });
  const withdrawn = store.view();
  assert.equal((await store.accept(original)).knowledge.sources.length, 0);
  await assert.rejects(() => store.accept({ ...original, idempotencyKey: 'consent-stale-version' }), code('STALE_KNOWLEDGE'));
  await assert.rejects(() => store.accept({ idempotencyKey: 'consent-changed-event', expectedVersion: withdrawn.version, event: event(1, 'Changed source under old identity') }), code('EVENT_CONFLICT'));
  const request = { idempotencyKey: 'consent-renewed', expectedVersion: withdrawn.version, event: event() };
  const renewed = await store.accept(request);
  assert.equal(renewed.replayed, false); assert.equal(renewed.knowledge.sources.length, 1); assert.equal(renewed.graph.projects[0].consent, true);
  assert.equal((await store.accept(request)).replayed, true);
  await store.close(); store = await openKnowledge({ directory }); context.after(() => store.close());
  assert.equal(store.view().knowledge.sources.length, 1);
  await store.revoke({ idempotencyKey: 'consent-withdraw-again', expectedVersion: store.view().version, project: project.reference });
  assert.equal((await store.accept(request)).knowledge.sources.length, 0);
});

test('restart reconstructs both views; export is detached; erasure rotates generation and rejects old requests', async (context) => {
  const directory = await temporary(context); let store = await openKnowledge({ directory }); await accept(store);
  const before = store.view(); const exported = store.export(); exported.journal.events.length = 0;
  assert.deepEqual(store.view(), before); await store.close();
  store = await openKnowledge({ directory }); context.after(() => store.close()); assert.deepEqual(store.view(), before);
  const rebuilt = rebuildKnowledge(store.export().journal); assert.deepEqual(rebuilt.knowledge, before.knowledge); assert.deepEqual(rebuilt.graph, before.graph);
  const erased = await store.erase({ expectedVersion: before.version, confirmation: 'delete-knowledge' });
  assert.equal(erased.knowledge.sources.length, 0); assert.equal(erased.graph.projects.length, 0); assert.notEqual(erased.version, before.version);
  await assert.rejects(() => store.accept({ idempotencyKey: 'old-accept', expectedVersion: before.version, event: event() }), code('STALE_KNOWLEDGE'));
  const raw = await readFile(path.join(directory, 'knowledge.v1.json'), 'utf8'); assert.ok(!raw.includes('test-book'));
});

test('another writer is refused and malformed journal is preserved without replacement', async (context) => {
  const directory = await temporary(context); const store = await openKnowledge({ directory });
  await assert.rejects(() => openKnowledge({ directory }), code('KNOWLEDGE_LOCKED')); await store.close();
  const raw = '{ not readable }'; await writeFile(path.join(directory, 'knowledge.v1.json'), raw);
  await assert.rejects(() => openKnowledge({ directory }));
  assert.equal(await readFile(path.join(directory, 'knowledge.v1.json'), 'utf8'), raw);
});

test('failed durable write leaves in-memory projections unchanged and can be retried', async (context) => {
  const directory = await temporary(context); const store = await openKnowledge({ directory }); context.after(() => store.close());
  const before = store.view();
  // Turn the target filename into a directory, making atomic rename fail without touching a journal.
  const { mkdir } = await import('node:fs/promises'); const target = path.join(directory, 'knowledge.v1.json'); await mkdir(target);
  await assert.rejects(() => accept(store)); assert.deepEqual(store.view(), before);
  await rm(target, { recursive: true }); await accept(store); assert.equal(store.view().knowledge.sources.length, 1);
});

test('a crashed writer leaves a recoverable lock and an atomic accepted journal', async (context) => {
  const directory = await temporary(context);
  const moduleUrl = new URL('../src/projections.mjs', import.meta.url).href;
  const code = `import {openKnowledge} from ${JSON.stringify(moduleUrl)}; const store = await openKnowledge({directory:${JSON.stringify(directory)}}); await store.accept({idempotencyKey:'crash-accepted', expectedVersion:store.view().version, event:${JSON.stringify(event())}}); process.exit(0);`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', code], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; child.stderr.on('data', (part) => { output += part; });
  const status = await new Promise((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
  assert.equal(status, 0, output);
  const store = await openKnowledge({ directory }); context.after(() => store.close());
  assert.equal(store.view().knowledge.sources.length, 1);
  assert.equal(store.view().graph.projects[0].sequence, 1);
});
