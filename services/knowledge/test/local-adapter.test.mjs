import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { localKnowledgeAdapter } from '../src/local-adapter.mjs';

test('the User Graph adapter is disabled by default', async () => {
  const adapter = localKnowledgeAdapter('');
  assert.equal(adapter.enabled, false); assert.deepEqual(await adapter.notes(), []);
  await assert.rejects(() => adapter.read('01_Knowledge/note.md'), /disabled/);
});

test('the User Graph adapter reads only selected Markdown inside its root', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'stex-vault-')); context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, '01_Knowledge')); await mkdir(path.join(root, '.obsidian'));
  await writeFile(path.join(root, '01_Knowledge', 'note.md'), '# Note\n'); await writeFile(path.join(root, 'ignored.txt'), 'x');
  const adapter = localKnowledgeAdapter(root);
  assert.deepEqual(await adapter.notes(), ['01_Knowledge/note.md']);
  assert.equal(await adapter.read('01_Knowledge/note.md'), '# Note\n');
  await assert.rejects(() => adapter.read('../secret.md'), /Invalid/);
});
