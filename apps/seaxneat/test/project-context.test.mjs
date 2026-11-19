import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { projectContext } from '../src/project-context.mjs';
import { SeaxneatStore, defaultRunner } from '../src/project-store.mjs';

const hash = (source) => createHash('sha256').update(source).digest('hex');
async function fixture(context, buildsPass = true) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'stex-seaxneat-context-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const runner = async (command, args, cwd, options) => command === 'pnpm' || args.includes('pnpm')
    ? { ok: buildsPass, stdout: '', stderr: buildsPass ? '' : 'Synthetic build failure' }
    : defaultRunner(command, args, cwd, options);
  const store = await new SeaxneatStore({ root, runner }).initialize();
  const project = await store.create({ title: 'Synthetic website' });
  return { store, project };
}

test('Seaxneat offers only allowlisted validated Git sources and preserves a working draft', async (context) => {
  const { store, project } = await fixture(context);
  const file = store.pagePath(project.id);
  const validated = await readFile(file, 'utf8');
  const draft = '// Unvalidated local draft — do not offer this.\n';
  await writeFile(file, draft);
  const catalog = await projectContext(store, project.id);
  assert.equal(catalog.schemaVersion, 'stex.project.context.v1');
  assert.equal(catalog.project.revision, project.lastValidatedRevision);
  assert.deepEqual(catalog.sources.map((item) => item.id), ['page', 'layout', 'styles']);
  assert.equal(catalog.sources.some((item) => Object.hasOwn(item, 'source')), false);
  const entry = catalog.sources.find((item) => item.id === 'page');
  assert.equal(entry.originRevision, project.lastValidatedRevision);
  assert.equal(entry.revision, hash(validated));
  const result = await projectContext(store, project.id, { sourceId: 'page', revision: entry.revision });
  assert.equal(result.source.source, validated);
  assert.equal(result.source.bytes, Buffer.byteLength(validated));
  assert.equal(await readFile(file, 'utf8'), draft);
  assert.equal(store.get(project.id).lastValidatedRevision, project.lastValidatedRevision);
  await assert.rejects(() => projectContext(store, project.id, { sourceId: '../package.json', revision: entry.revision }), { status: 404, code: 'NOT_FOUND' });
});

test('Seaxneat stale source revisions fail after a newly validated edit', async (context) => {
  const { store, project } = await fixture(context);
  const before = (await projectContext(store, project.id)).sources.find((item) => item.id === 'page');
  const proposal = await store.proposal(project.id, { message: 'A newly validated heading' });
  await store.apply(project.id, proposal.id);
  await assert.rejects(() => projectContext(store, project.id, { sourceId: 'page', revision: before.revision }), { status: 409, code: 'STALE_SOURCE' });
  const after = await projectContext(store, project.id);
  assert.notEqual(after.project.revision, project.lastValidatedRevision);
  assert.notEqual(after.sources.find((item) => item.id === 'page').revision, before.revision);
});

test('Seaxneat refuses a failed setup with no validated revision', async (context) => {
  const { store, project } = await fixture(context, false);
  assert.equal(project.lastValidatedRevision, null);
  await assert.rejects(() => projectContext(store, project.id), { status: 409, code: 'NO_VALIDATED_REVISION' });
  await assert.rejects(() => projectContext(store, 'missing-project'), { status: 404, code: 'NOT_FOUND' });
});

test('Seaxneat exposes oversized validated sources as unavailable without reading their text', async (context) => {
  const { store, project } = await fixture(context);
  await writeFile(store.pagePath(project.id), '// ' + 'é'.repeat(6000));
  const record = store.get(project.id);
  await store.commitRevision(record, 'Synthetic large validated fixture', 'edit');
  const reads = [];
  const git = store.git.bind(store);
  store.git = async (args, cwd) => { reads.push(args); return git(args, cwd); };
  const entry = (await projectContext(store, project.id)).sources.find((item) => item.id === 'page');
  assert.equal(entry.available, false);
  assert.equal(entry.revision, null);
  assert.ok(entry.bytes > 12000);
  assert.equal(reads.some((args) => args[0] === 'show' && args[1].endsWith(':app/page.tsx')), false);
  await assert.rejects(() => projectContext(store, project.id, { sourceId: 'page', revision: '0'.repeat(64) }), { status: 413, code: 'CONTEXT_LIMIT' });
});
