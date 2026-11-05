import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { appBase, appUrl } from '../public/base-path.js';

const appDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function startFrige(root, port, context, environment = { STEX_FRIGE_SHELL_URL: '/' }) {
  const child = spawn(process.execPath, ['server.mjs'], { cwd: appDirectory, env: { ...process.env, STEX_FRIGE_PORT: String(port), STEX_FRIGE_PROJECT_DIR: root, STEX_FRIGE_BOOKS_DIR: path.join(root, 'books'), STEX_FRIGE_BASE_PATH: '/frige', ...environment } });
  context.after(async () => { child.kill(); await rm(root, { recursive: true, force: true }); });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Frige server did not start.')), 5_000);
    child.stdout.on('data', (data) => { if (data.toString().includes('ready')) { clearTimeout(timeout); resolve(); } });
    child.on('error', reject);
  });
}

test('builds Frige URLs from the mounted application path without changing direct compatibility URLs', () => {
  assert.equal(appBase('http://127.0.0.1:4310/'), '');
  assert.equal(appUrl('/api/project/graph', 'http://127.0.0.1:4310/'), '/api/project/graph');
  assert.equal(appBase('http://127.0.0.1:4300/frige/?book=fixture'), '/frige');
  assert.equal(appUrl('/api/project/graph', 'http://127.0.0.1:4300/frige/?book=fixture'), '/frige/api/project/graph');
  assert.throws(() => appUrl('api/project/graph', 'http://127.0.0.1:4300/frige/'), /start with/);
});

test('serves Frige APIs and runtime configuration under its shell mount', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'stex-frige-'));
  await startFrige(root, 4410, context);
  const health = await fetch('http://127.0.0.1:4410/frige/api/health');
  assert.equal(health.status, 200); assert.equal((await health.json()).ok, true);
  const runtime = await fetch('http://127.0.0.1:4410/frige/runtime-config.js');
  assert.match(await runtime.text(), /STEX_SHELL_URL="\/"/);
  const unmapped = await fetch('http://127.0.0.1:4410/api/health');
  assert.equal(unmapped.status, 404);
});

test('returns to the Pantheon command center by default when mounted', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'stex-frige-shell-'));
  await startFrige(root, 4412, context, { STEX_FRIGE_SHELL_URL: '', TEXGRAPH_SHELL_URL: '' });
  const runtime = await fetch('http://127.0.0.1:4412/frige/runtime-config.js');
  assert.match(await runtime.text(), /STEX_SHELL_URL="\/home\/"/);
});

test('serves stex.projects.summary.v1 from file times without touching the manuscript', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'stex-frige-summary-'));
  const book = path.join(root, 'books', 'field-notes');
  await mkdir(path.join(book, 'manuscript'), { recursive: true });
  await mkdir(path.join(book, '.texgraph'), { recursive: true });
  await writeFile(path.join(book, 'README.md'), '# Field Notes\n');
  await writeFile(path.join(book, 'manuscript', 'Programme.md'), '# Programme\n');
  await writeFile(path.join(book, '.texgraph', 'cache.json'), '{}');
  await mkdir(path.join(book, '.git'), { recursive: true });
  await writeFile(path.join(book, '.git', 'FETCH_HEAD'), '');
  const authored = new Date('2026-03-04T05:06:07.000Z');
  for (const file of ['README.md', 'manuscript/Programme.md']) await utimes(path.join(book, file), authored, authored);
  // Tooling activity is newer but is not an author change.
  const later = new Date('2026-10-01T00:00:00.000Z');
  for (const file of ['.texgraph/cache.json', '.git/FETCH_HEAD']) await utimes(path.join(book, file), later, later);
  await startFrige(root, 4413, context);
  const summary = await (await fetch('http://127.0.0.1:4413/frige/api/stex/projects')).json();
  assert.deepEqual(summary, {
    schemaVersion: 'stex.projects.summary.v1', application: 'frige',
    projects: [{ reference: 'stex://frige/project/field-notes', id: 'field-notes', title: 'Field Notes', kind: 'book', updatedAt: authored.toISOString(), status: { state: 'ready', label: 'Manuscript' }, openPath: '/?book=field-notes' }],
  });
  assert.equal(await readFile(path.join(book, 'manuscript', 'Programme.md'), 'utf8'), '# Programme\n');
});

test('offers a mount-aware Frige project selector and creates an isolated book project', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'stex-frige-lobby-'));
  await startFrige(root, 4411, context);
  const lobby = await fetch('http://127.0.0.1:4411/frige/');
  assert.equal(lobby.status, 200); assert.match(await lobby.text(), /Book projects/);
  const created = await fetch('http://127.0.0.1:4411/frige/api/books', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'New Fixture', author: 'A. Author' }) });
  assert.equal(created.status, 201); const project = await created.json(); assert.match(project.id, /^new-fixture-/);
  assert.match(await readFile(path.join(root, 'books', project.id, 'manuscript', 'Programme.md'), 'utf8'), /New Fixture/);
  const listed = await fetch('http://127.0.0.1:4411/frige/api/books');
  assert.equal((await listed.json())[0].id, project.id);
});
