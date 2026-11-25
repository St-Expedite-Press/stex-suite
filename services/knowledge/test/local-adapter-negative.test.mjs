/**
 * Knowledge negative tests: the vault adapter must refuse links, junctions and
 * Windows alias forms before any vault read may be exposed (Obsidian gate).
 *
 * Ownership: services/knowledge. Cases that need OS privileges the machine
 * lacks are skipped with an explicit message saying they were NOT exercised.
 */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { localKnowledgeAdapter } from '../src/local-adapter.mjs';

/**
 * Creates a vault with a real note, an `.obsidian` directory and an outside secret.
 * @param {import('node:test').TestContext} context
 */
async function vaultFixture(context) {
  const base = await mkdtemp(path.join(os.tmpdir(), 'stex-vault-neg-')); context.after(() => rm(base, { recursive: true, force: true }));
  const root = path.join(base, 'vault'); const outside = path.join(base, 'outside');
  await mkdir(path.join(root, '01_Knowledge'), { recursive: true }); await mkdir(path.join(root, '.obsidian')); await mkdir(outside);
  await writeFile(path.join(root, '01_Knowledge', 'note.md'), '# Note\n'); await writeFile(path.join(root, '.obsidian', 'app.md'), 'config\n');
  await writeFile(path.join(outside, 'secret.md'), 'SECRET\n');
  return { base, root, outside, adapter: localKnowledgeAdapter(root) };
}

/**
 * Creates a link, or skips the calling test with an explicit reason where the OS refuses
 * (for example Windows without symlink privilege).
 * @returns {Promise<boolean>} Whether the link now exists.
 */
async function link(context, target, file, type) {
  try { await symlink(target, file, type); return true; }
  catch (error) { context.skip(`cannot create ${type} link here (${error.code}); this negative case was NOT exercised`); return false; }
}

test('a file symlink to an outside file is refused by read and absent from notes', async (context) => {
  const { root, outside, adapter } = await vaultFixture(context);
  if (!await link(context, path.join(outside, 'secret.md'), path.join(root, 'link.md'), 'file')) return;
  await assert.rejects(() => adapter.read('link.md'), /Invalid/);
  assert.deepEqual(await adapter.notes(), ['01_Knowledge/note.md']);
});

test('a symlink to an outside directory is refused anywhere in the chain', async (context) => {
  const { root, outside, adapter } = await vaultFixture(context);
  if (!await link(context, outside, path.join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')) return;
  await assert.rejects(() => adapter.read('linked/secret.md'), /Invalid/);
  assert.deepEqual(await adapter.notes(), ['01_Knowledge/note.md']);
});

test('a directory symlink (not a junction) to an outside directory is refused', async (context) => {
  const { root, outside, adapter } = await vaultFixture(context);
  if (!await link(context, outside, path.join(root, 'dirlink'), 'dir')) return;
  await assert.rejects(() => adapter.read('dirlink/secret.md'), /Invalid/);
  assert.deepEqual(await adapter.notes(), ['01_Knowledge/note.md']);
});

test('a nested link below a real directory is refused', async (context) => {
  const { root, outside, adapter } = await vaultFixture(context);
  if (!await link(context, outside, path.join(root, '01_Knowledge', 'deep'), process.platform === 'win32' ? 'junction' : 'dir')) return;
  await assert.rejects(() => adapter.read('01_Knowledge/deep/secret.md'), /Invalid/);
});

test('a vault root that is itself a link is resolved, and notes inside it stay readable', async (context) => {
  const { base, root } = await vaultFixture(context);
  if (!await link(context, root, path.join(base, 'rootlink'), process.platform === 'win32' ? 'junction' : 'dir')) return;
  assert.equal(await localKnowledgeAdapter(path.join(base, 'rootlink')).read('01_Knowledge/note.md'), '# Note\n');
});

test('traversal, absolute, drive, UNC and stream forms are refused', async (context) => {
  const { adapter } = await vaultFixture(context);
  const forms = ['../outside/secret.md', '01_Knowledge/../../outside/secret.md', '/etc/passwd.md', 'C:/Windows/win.md', 'C:\\Windows\\win.md', '\\\\server\\share\\x.md', '01_Knowledge/note.md:stream', '01_Knowledge:x/note.md', '01_Knowledge/note.md::$DATA', '', '01_Knowledge//note.md', 'a\u0000b.md'];
  for (const bad of forms) await assert.rejects(() => adapter.read(bad), /Invalid|Markdown/, JSON.stringify(bad));
});

test('Windows alias forms are refused whatever the host OS', async (context) => {
  const { adapter } = await vaultFixture(context);
  const forms = ['01_KNOWL~1/note.md', '01_Knowledge/NOTE~1.md', '01_Knowledge./note.md', '01_Knowledge /note.md', '01_Knowledge/note.md.', '01_Knowledge/note.md ', 'CON/note.md', '01_Knowledge/nul.md', '01_Knowledge/COM1.md', '01_Knowledge/lpt1.txt.md', 'aux.md'];
  for (const bad of forms) await assert.rejects(() => adapter.read(bad), /Invalid|Markdown/, bad);
});

test('the .obsidian directory is refused in every letter case and by notes', async (context) => {
  const { adapter } = await vaultFixture(context);
  for (const bad of ['.obsidian/app.md', '.OBSIDIAN/app.md', '.Obsidian/app.md']) await assert.rejects(() => adapter.read(bad), /Invalid/, bad);
  assert.ok(!(await adapter.notes()).some((entry) => entry.toLowerCase().includes('.obsidian')));
});

test('a directory or a missing path is not a readable note', async (context) => {
  const { root, adapter } = await vaultFixture(context);
  await mkdir(path.join(root, 'folder.md'));
  await assert.rejects(() => adapter.read('folder.md'), /Invalid/);
  await assert.rejects(() => adapter.read('missing.md'), /Invalid/);
});
