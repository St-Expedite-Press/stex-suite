import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { knowledgeEvent } from '../src/knowledge-event.mjs';
import { projectContext } from '../src/project-context.mjs';
import { ProjectStore } from '../src/project-store-vault.mjs';

async function fixture(context) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'stex-frige-knowledge-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'manuscript'));
  await writeFile(path.join(root, 'manuscript', 'Programme.md'), '# Programme\n\n- [Source](Source.md)\n');
  const source = '# Source\n\n  Explicit accepted text — not persisted in an event.\n';
  await writeFile(path.join(root, 'manuscript', 'Source.md'), source);
  const store = new ProjectStore(root); await store.initialize();
  const entry = (await projectContext(store, 'synthetic')).sources.find((entry) => entry.title === 'Source');
  const selection = { sources: [{ id: entry.id, revision: entry.revision }] };
  const checkpoint = path.join(store.stateDirectory, 'knowledge-observation.json');
  return { root, store, entry, selection, source, checkpoint };
}

test('Frige knowledge observation is metadata-only, serialized, idempotent and restart-stable', async (context) => {
  const { root, store, selection, source, checkpoint } = await fixture(context);
  const [first, replay] = await Promise.all([knowledgeEvent(store, 'synthetic', selection), knowledgeEvent(store, 'synthetic', selection)]);
  assert.deepEqual(replay, first);
  assert.equal(first.schemaVersion, 'stex.knowledge.event.v1');
  assert.equal(first.sequence, 1);
  assert.match(first.id, /^[a-f0-9]{64}$/);
  assert.ok(Number.isFinite(Date.parse(first.occurredAt)));
  assert.equal(first.project.reference, 'stex://frige/project/synthetic');
  assert.equal(first.sources[0].revision, selection.sources[0].revision);
  assert.equal(Object.hasOwn(first.sources[0], 'source'), false);
  assert.equal((await readFile(checkpoint, 'utf8')).includes(source), false);
  const reopened = new ProjectStore(root); await reopened.initialize();
  assert.deepEqual(await knowledgeEvent(reopened, 'synthetic', selection), first);
  assert.equal(await readFile(path.join(root, 'manuscript', 'Source.md'), 'utf8'), source);
});

test('Frige advances knowledge sequence only for a new accepted source or membership and rejects stale consent', async (context) => {
  const { store, entry, selection, checkpoint } = await fixture(context);
  const first = await knowledgeEvent(store, 'synthetic', selection);
  await store.updateNode(entry.id, '# Source\n\nAn explicitly saved new revision.\n', entry.revision);
  await assert.rejects(() => knowledgeEvent(store, 'synthetic', selection), { status: 409, code: 'STALE_SOURCE' });
  assert.equal(JSON.parse(await readFile(checkpoint, 'utf8')).event.id, first.id);
  const revised = (await projectContext(store, 'synthetic')).sources.find((source) => source.id === entry.id);
  const next = await knowledgeEvent(store, 'synthetic', { sources: [{ id: revised.id, revision: revised.revision }] });
  assert.equal(next.sequence, 2);
  assert.notEqual(next.id, first.id);
  const empty = await knowledgeEvent(store, 'synthetic', { sources: [] });
  assert.equal(empty.sequence, 3);
  assert.deepEqual(empty.sources, []);
  assert.deepEqual(await knowledgeEvent(store, 'synthetic', { sources: [] }), empty);
});

test('Frige validates knowledge selections and fails closed on a corrupt checkpoint', async (context) => {
  const { store, selection, checkpoint } = await fixture(context);
  for (const input of [{}, { sources: Array(5).fill(selection.sources[0]) }, { sources: [...selection.sources, ...selection.sources] }, { sources: [{ id: '../Source.md', revision: 'a'.repeat(64) }] }, { sources: [{ id: 'source', revision: ['a'.repeat(64)] }] }]) {
    await assert.rejects(() => knowledgeEvent(store, 'synthetic', input), { status: 400, code: 'INVALID_REQUEST' });
  }
  await assert.rejects(() => knowledgeEvent(store, '../outside', selection), { status: 400, code: 'INVALID_REQUEST' });
  await writeFile(checkpoint, '{ corrupt checkpoint');
  await assert.rejects(() => knowledgeEvent(store, 'synthetic', selection), { status: 503, code: 'UNAVAILABLE' });
  assert.equal(await readFile(checkpoint, 'utf8'), '{ corrupt checkpoint');
});
