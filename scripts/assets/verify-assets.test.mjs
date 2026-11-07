import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { verifyAssets } from './verify-assets.mjs';

const digest = (text) => createHash('sha256').update(text).digest('hex');

async function fixture(context, files, assets) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'stex-assets-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  for (const [file, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), content);
  }
  await writeFile(path.join(root, 'assets', 'manifest.json'), JSON.stringify({ schemaVersion: 'stex.assets.manifest.v1', assets }));
  return root;
}

const record = (file, content, extra = {}) => ({ path: file, sha256: digest(content), bytes: Buffer.byteLength(content), ...extra });
const asset = (master, derivatives = [], extra = {}) => ({ id: 'P01', owner: 'pantheon', provenance: { author: 'Test', rights: 'Test' }, alt: 'Test', master, derivatives, ...extra });

test('the repository asset manifest matches the files on disk', async () => {
  assert.deepEqual(await verifyAssets(), []);
});

test('accepts a well-formed master and derivative', async (context) => {
  const root = await fixture(context, { 'assets/masters/pantheon/pantheon-still.png': 'master', 'apps/pantheon/public/media/pantheon-still-960w.webp': 'small' },
    [asset(record('assets/masters/pantheon/pantheon-still.png', 'master'), [record('apps/pantheon/public/media/pantheon-still-960w.webp', 'small', { width: 960, budgetBytes: 10 })])]);
  assert.deepEqual(await verifyAssets(root), []);
});

test('requires a copy served by another application to stay byte-identical to its source', async (context) => {
  const source = 'apps/pantheon/public/media/pantheon-still-960w.webp';
  const copy = 'apps/frige/public/media/pantheon-still-960w.webp';
  const master = record('assets/masters/pantheon/pantheon-still.png', 'master');
  const derivatives = (copyContent) => [record(source, 'small', { width: 960 }), record(copy, copyContent, { width: 960, copyOf: source })];
  const matching = await fixture(context, { 'assets/masters/pantheon/pantheon-still.png': 'master', [source]: 'small', [copy]: 'small' }, [asset(master, derivatives('small'))]);
  assert.deepEqual(await verifyAssets(matching), []);
  // The copy matches its own (updated) record but no longer matches the source.
  const drifted = await fixture(context, { 'assets/masters/pantheon/pantheon-still.png': 'master', [source]: 'small', [copy]: 'edited' }, [asset(master, derivatives('edited'))]);
  assert.match((await verifyAssets(drifted)).join('\n'), /pantheon-still-960w\.webp differs from apps\/pantheon/);
  const orphan = await fixture(context, { 'assets/masters/pantheon/pantheon-still.png': 'master', [copy]: 'small' }, [asset(master, [record(copy, 'small', { width: 960, copyOf: source })])]);
  assert.match((await verifyAssets(orphan)).join('\n'), /which is not a built derivative/);
});

test('rejects bad names, checksums, budgets, LFS pointers, orphans, and duplicate IDs', async (context) => {
  const pointer = 'version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 1\n';
  const root = await fixture(context, {
    'assets/masters/pantheon/Pantheon_Still_v2.png': 'x',
    'assets/masters/pantheon/pantheon-loop.mp4': pointer,
    'assets/masters/pantheon/pantheon-sky.png': 'changed',
    'assets/reference/pantheon-orphan.png': 'orphan',
    'apps/pantheon/public/media/pantheon-sky-960w.webp': 'too large',
    'apps/pantheon/public/media/pantheon-sky-small.webp': 'misnamed',
  }, [
    asset(record('assets/masters/pantheon/Pantheon_Still_v2.png', 'x')),
    asset(record('assets/masters/pantheon/pantheon-loop.mp4', pointer), [], { id: 'P02' }),
    asset(record('assets/masters/pantheon/pantheon-sky.png', 'original'), [
      record('apps/pantheon/public/media/pantheon-sky-960w.webp', 'too large', { width: 960, budgetBytes: 2 }),
      record('apps/pantheon/public/media/pantheon-sky-small.webp', 'misnamed', { width: 480 }),
    ], { id: 'P02' }),
  ]);
  const errors = (await verifyAssets(root)).join('\n');
  assert.match(errors, /Pantheon_Still_v2\.png does not follow/);
  assert.match(errors, /pantheon-loop\.mp4 is an unresolved Git LFS pointer/);
  assert.match(errors, /pantheon-sky\.png does not match its manifest checksum/);
  assert.match(errors, /over its 2-byte budget/);
  assert.match(errors, /must be named pantheon-sky-480w/);
  assert.match(errors, /pantheon-orphan\.png is not listed/);
  assert.match(errors, /P02: duplicate asset ID/);
});
