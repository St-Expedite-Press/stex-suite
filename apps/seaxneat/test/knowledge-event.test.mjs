import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { knowledgeEvent } from '../src/knowledge-event.mjs';
import { projectContext } from '../src/project-context.mjs';
import { SeaxneatStore, defaultRunner } from '../src/project-store.mjs';

async function fixture(context) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'stex-seax-knowledge-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const runner = async (command, args, cwd, options) => command === 'pnpm' || args.includes('pnpm') ? { ok: true, stdout: '', stderr: '' } : defaultRunner(command, args, cwd, options);
  const store = await new SeaxneatStore({ root, runner }).initialize();
  const project = await store.create({ title: 'Synthetic accepted website' });
  const entry = (await projectContext(store, project.id)).sources.find((entry) => entry.id === 'page');
  const selection = { sources: [{ id: entry.id, revision: entry.revision }] };
  return { root, runner, store, project, selection, checkpoint: path.join(store.projectDirectory(project.id), 'knowledge-observation.json') };
}

test('Seaxneat knowledge observation is metadata-only, serialized, idempotent and restart-stable', async (context) => {
  const { root, runner, store, project, selection, checkpoint } = await fixture(context);
  const stateBefore = await readFile(store.stateFile(), 'utf8');
  const [first, replay] = await Promise.all([knowledgeEvent(store, project.id, selection), knowledgeEvent(store, project.id, selection)]);
  assert.deepEqual(replay, first);
  assert.equal(first.sequence, 1);
  assert.equal(first.schemaVersion, 'stex.knowledge.event.v1');
  assert.match(first.id, /^[a-f0-9]{64}$/);
  assert.ok(Number.isFinite(Date.parse(first.occurredAt)));
  assert.equal(first.project.reference, `stex://seaxneat/project/${project.id}`);
  assert.equal(first.sources[0].originRevision, project.lastValidatedRevision);
  assert.equal(Object.hasOwn(first.sources[0], 'source'), false);
  assert.equal((await readFile(checkpoint, 'utf8')).includes('export default function Home'), false);
  assert.equal(await readFile(store.stateFile(), 'utf8'), stateBefore);
  const reopened = await new SeaxneatStore({ root, runner }).initialize();
  assert.deepEqual(await knowledgeEvent(reopened, project.id, selection), first);
});

test('Seaxneat advances knowledge sequence for validated revisions or selection changes, never a draft', async (context) => {
  const { store, project, selection, checkpoint } = await fixture(context);
  const first = await knowledgeEvent(store, project.id, selection);
  const original = await readFile(store.pagePath(project.id), 'utf8');
  await writeFile(store.pagePath(project.id), '// Unvalidated draft\n');
  assert.deepEqual(await knowledgeEvent(store, project.id, selection), first);
  await writeFile(store.pagePath(project.id), original);
  const proposal = await store.proposal(project.id, { message: 'A new accepted revision' });
  await store.apply(project.id, proposal.id);
  await assert.rejects(() => knowledgeEvent(store, project.id, selection), { status: 409, code: 'STALE_SOURCE' });
  assert.equal(JSON.parse(await readFile(checkpoint, 'utf8')).event.id, first.id);
  const entry = (await projectContext(store, project.id)).sources.find((entry) => entry.id === 'page');
  const next = await knowledgeEvent(store, project.id, { sources: [{ id: entry.id, revision: entry.revision }] });
  assert.equal(next.sequence, 2);
  assert.notEqual(next.id, first.id);
  const none = await knowledgeEvent(store, project.id, { sources: [] });
  assert.equal(none.sequence, 3);
  assert.deepEqual(await knowledgeEvent(store, project.id, { sources: [] }), none);
});

test('Seaxneat validates selections, fails closed on corrupt checkpoint and recovers its queue after failure', async (context) => {
  const { store, project, selection, checkpoint } = await fixture(context);
  for (const input of [{}, { sources: Array(5).fill(selection.sources[0]) }, { sources: [...selection.sources, ...selection.sources] }, { sources: [{ id: '../page', revision: 'a'.repeat(64) }] }]) {
    await assert.rejects(() => knowledgeEvent(store, project.id, input), { status: 400, code: 'INVALID_REQUEST' });
  }
  await assert.rejects(() => knowledgeEvent(store, '../outside', selection), { status: 400, code: 'INVALID_REQUEST' });
  await writeFile(checkpoint, '{ corrupt checkpoint');
  await assert.rejects(() => knowledgeEvent(store, project.id, selection), { status: 503, code: 'UNAVAILABLE' });
  assert.equal(await readFile(checkpoint, 'utf8'), '{ corrupt checkpoint');
  await rm(checkpoint);
  assert.equal((await knowledgeEvent(store, project.id, selection)).sequence, 1);
});
