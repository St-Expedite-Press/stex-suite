import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { SeaxneatStore, defaultRunner } from '../src/project-store.mjs';

async function fixture(context) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'stex-seaxneat-'));
  context.after(async () => rm(root, { recursive: true, force: true }));
  const runner = async (command, args, cwd) => (command === 'pnpm' || args?.includes('pnpm')) ? { ok: true, stdout: `${args.join(' ')} accepted by fixture`, stderr: '' } : defaultRunner(command, args, cwd);
  return new SeaxneatStore({ root, runner, clock: () => '2026-11-04T00:00:00.000Z' }).initialize();
}

test('creates an isolated Git-backed Next.js starter and stable reference', async (context) => {
  const store = await fixture(context); const project = await store.create({ title: 'Small Signal' });
  assert.match(project.id, /^small-signal-/); assert.equal(project.ref, `stex://seaxneat/project/${project.id}`); assert.equal(project.revisionCount, 1); assert.equal(project.revisions[0].kind, 'seed'); assert.ok(project.lastValidatedRevision, 'the seed becomes validated only after provisioning build');
  assert.match(await readFile(store.pagePath(project.id), 'utf8'), /Small Signal/);
  assert.equal((await store.git(['rev-list', '--count', 'HEAD'], store.workspace(project.id))).stdout.trim(), '1');
});

test('records and applies only a current deterministic bounded proposal', async (context) => {
  const store = await fixture(context); const project = await store.create({ title: 'One' }); const proposal = await store.proposal(project.id, { message: 'A sharper working headline' });
  assert.equal(proposal.path, 'app/page.tsx'); assert.equal(proposal.simulator, 'deterministic');
  const applied = await store.apply(project.id, proposal.id); assert.equal(applied.revisionCount, 2); assert.equal(applied.hasPendingProposal, false);
  assert.match(await readFile(store.pagePath(project.id), 'utf8'), /A sharper working headline/);
});

test('refuses stale proposal source and never commits it', async (context) => {
  const store = await fixture(context); const project = await store.create({ title: 'One' }); const proposal = await store.proposal(project.id, { message: 'Proposed' });
  await writeFile(store.pagePath(project.id), '// concurrent local change\n', 'utf8');
  await assert.rejects(() => store.apply(project.id, proposal.id), /draft changed/);
  assert.equal(store.get(project.id).revisions.length, 1);
});

test('restores a selected validated revision as a new Git commit', async (context) => {
  const store = await fixture(context); const project = await store.create({ title: 'Origin' }); const seed = store.get(project.id).revisions[0]; const proposal = await store.proposal(project.id, { message: 'Changed heading' }); await store.apply(project.id, proposal.id);
  const restored = await store.restore(project.id, seed.id); assert.equal(restored.revisionCount, 3); assert.match(await readFile(store.pagePath(project.id), 'utf8'), /Origin/); assert.doesNotMatch(await readFile(store.pagePath(project.id), 'utf8'), /Changed heading/);
});

test('recovery marks an interrupted operation for explicit attention', async (context) => {
  const store = await fixture(context); const project = await store.create({ title: 'Recover' }); store.get(project.id).operation = { state: 'running', kind: 'apply' }; await store.save();
  const reopened = await new SeaxneatStore({ root: store.root, runner: store.runner }).initialize();
  assert.equal(reopened.get(project.id).operation.state, 'needs_attention');
});

test('rejects traversal ids and does not resolve workspace outside the project root', async (context) => {
  const store = await fixture(context); assert.throws(() => store.get('../outside'), /Invalid project id/); await assert.rejects(() => store.proposal('../outside', { message: 'no' }), /Invalid project id/);
});
