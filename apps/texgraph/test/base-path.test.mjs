import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { appBase, appUrl } from '../public/base-path.js';

const appDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function startFrige(root, port, context) {
  const child = spawn(process.execPath, ['server.mjs'], { cwd: appDirectory, env: { ...process.env, TEXGRAPH_PORT: String(port), TEXGRAPH_PROJECT_DIR: root, TEXGRAPH_BOOKS_DIR: path.join(root, 'books'), TEXGRAPH_BASE_PATH: '/frige', TEXGRAPH_SHELL_URL: '/' } });
  context.after(async () => { child.kill(); await rm(root, { recursive: true, force: true }); });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Frige server did not start.')), 5_000);
    child.stdout.on('data', (data) => { if (data.toString().includes('ready')) { clearTimeout(timeout); resolve(); } });
    child.on('error', reject);
  });
}

test('builds Frige URLs from the mounted application path without changing direct TexGraph URLs', () => {
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
