import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const appDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('creates a POD poetry project with TexGraph context', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'stex-lab-'));
  const port = 4397;
  const child = spawn(process.execPath, ['server.mjs'], { cwd: appDirectory, env: { ...process.env, STEX_LAB_PORT: String(port), STEX_PROJECTS_DIR: root } });
  context.after(async () => { child.kill(); await rm(root, { recursive: true, force: true }); });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Lab server did not start.')), 5_000);
    child.stdout.on('data', (data) => { if (data.toString().includes('ready')) { clearTimeout(timeout); resolve(); } });
    child.on('error', reject);
  });
  const payload = {
    title: 'Field Notes', author: 'A. Poet', bookType: 'chapbook', podProfile: 'ingramspark', trimSize: '6 × 9 in',
    margins: '0.5 in', bleed: 'no-bleed', interiorInk: 'black-white', printerNotes: 'Keep it ready for bookstore distribution.',
    bodyFont: 'Crimson Pro', editorialIntent: 'A book of observant lyric poems.', bookDesign: 'Spacious pages.',
  };
  const response = await fetch(`http://127.0.0.1:${port}/api/projects`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  assert.equal(response.status, 201);
  const project = await response.json();
  const book = JSON.parse(await readFile(path.join(root, project.id, 'texgraph', 'book.json'), 'utf8'));
  assert.equal(book.title, 'Field Notes');
  assert.equal(book.context.editorialIntent, 'A book of observant lyric poems.');
  assert.equal(book.author, 'A. Poet');
  assert.equal(book.settings.bookType, 'chapbook');
  assert.equal(book.settings.podProfile, 'ingramspark');
  assert.equal(book.settings.trimSize, '6 × 9 in');
  assert.equal(book.settings.margins, '0.5 in');
  assert.equal(book.settings.printerNotes, 'Keep it ready for bookstore distribution.');
  assert.equal(book.pages[0].id, 'page-001');
});
