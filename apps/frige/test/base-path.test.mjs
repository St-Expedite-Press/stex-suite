import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { access, mkdir, mkdtemp, readFile, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

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

test('cold context and knowledge routes reject manuscript links before creating any graph state', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'stex-frige-cold-context-'));
  const book = path.join(root, 'books', 'linked-book'); const outside = path.join(root, 'outside');
  await mkdir(book, { recursive: true }); await mkdir(outside);
  const privateText = '# Programme\n\nPRIVATE linked content\n';
  await writeFile(path.join(outside, 'Programme.md'), privateText);
  await symlink(outside, path.join(book, 'manuscript'), process.platform === 'win32' ? 'junction' : 'dir');
  await startFrige(root, 4427, context);
  const base = 'http://127.0.0.1:4427/frige/api/stex/context/v1/projects/';
  for (const [route, options] of [['linked-book', {}], ['linked-book/observation', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"sources":[]}' }]]) {
    const result = await fetch(base + route, options); assert.equal(result.status, 403);
    assert.ok(!(await result.text()).includes('PRIVATE'));
    await assert.rejects(access(path.join(book, '.texgraph')), { code: 'ENOENT' });
  }
  assert.equal((await fetch(base + 'missing-book')).status, 404);
  assert.equal(await readFile(path.join(outside, 'Programme.md'), 'utf8'), privateText);
});

test('returns to the Pantheon command center by default when mounted', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'stex-frige-shell-'));
  await startFrige(root, 4412, context, { STEX_FRIGE_SHELL_URL: '', TEXGRAPH_SHELL_URL: '' });
  const runtime = await fetch('http://127.0.0.1:4412/frige/runtime-config.js');
  assert.match(await runtime.text(), /STEX_SHELL_URL="\/home\/"/);
});

test('preserves the legacy books directory alias and refuses opaque/foreign browser mutations', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'stex-frige-legacy-'));
  const books = path.join(root, 'selected-books');
  await mkdir(path.join(books, 'existing', 'manuscript'), { recursive: true });
  await writeFile(path.join(books, 'existing', 'manuscript', 'Programme.md'), '# Programme\n');
  await startFrige(root, 4420, context, { STEX_FRIGE_BOOKS_DIR: '', TEXGRAPH_BOOKS_DIR: '', STEX_BOOKS_DIR: books, STEX_PANTHEON_URL: 'http://127.0.0.1:4300' });
  const route = 'http://127.0.0.1:4420/frige/api/stex/legacy-books/v1';
  assert.equal((await (await fetch(route)).json())[0].id, 'existing');
  for (const origin of ['null', 'https://foreign.invalid', 'http://127.0.0.1:9999']) {
    const response = await fetch(route, { method: 'POST', headers: { origin, 'x-forwarded-host': origin.replace('http://', ''), 'content-type': 'text/plain' }, body: JSON.stringify({ ticket: { title: 'Forbidden' } }) });
    assert.equal(response.status, 403);
  }
  const allowed = await fetch(route, { method: 'POST', headers: { origin: 'http://127.0.0.1:4300', 'content-type': 'application/json' }, body: JSON.stringify({ ticket: { title: 'Allowed' } }) });
  assert.equal(allowed.status, 201);
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

const repositoryRoot = path.resolve(appDirectory, '..', '..');
const rawGet = (port, requestPath) => new Promise((resolve, reject) => {
  // node:http keeps the path as written, so traversal attempts reach the server unnormalised.
  http.get({ host: '127.0.0.1', port, path: requestPath }, (response) => { let text = ''; response.on('data', (chunk) => { text += chunk; }); response.on('end', () => resolve({ status: response.statusCode, text })); }).on('error', reject);
});

test('serves the shared design system read-only, mounted and standalone, and nothing else of the package', async (context) => {
  const mounted = await mkdtemp(path.join(os.tmpdir(), 'stex-frige-ds-'));
  await startFrige(mounted, 4414, context);
  const standalone = await mkdtemp(path.join(os.tmpdir(), 'stex-frige-ds-direct-'));
  await startFrige(standalone, 4415, context, { STEX_FRIGE_BASE_PATH: '', TEXGRAPH_BASE_PATH: '' });
  const source = await readFile(path.join(repositoryRoot, 'packages', 'design-system', 'src', 'stex.css'));
  for (const base of ['http://127.0.0.1:4414/frige', 'http://127.0.0.1:4415']) {
    const css = await fetch(`${base}/design-system/src/stex.css`);
    assert.equal(css.status, 200); assert.match(css.headers.get('content-type'), /^text\/css/);
    assert.deepEqual(Buffer.from(await css.arrayBuffer()), source);
    for (const [file, type] of [['fonts/inter-latin-wght-normal.woff2', 'font/woff2'], ['brand/pantheon-emblem.svg', 'image/svg+xml'], ['icons/book-open.svg', 'image/svg+xml']]) {
      const response = await fetch(`${base}/design-system/${file}`);
      assert.equal(response.status, 200, file); assert.equal(response.headers.get('content-type'), type, file); await response.arrayBuffer();
    }
    for (const refused of ['package.json', 'README.md', 'AGENTS.md', 'specimen/index.html', 'test/tokens.test.mjs', 'src/', '']) {
      const response = await fetch(`${base}/design-system/${refused}`);
      assert.equal(response.status, 404, refused); await response.arrayBuffer();
    }
  }
  const prefix = { 4414: '/frige', 4415: '' };
  for (const port of [4414, 4415]) {
    for (const attempt of ['/design-system/src/../../package.json', '/design-system/src/%2e%2e/%2e%2e/package.json', '/design-system/src/..%2f..%2fpackage.json', '/design-system/fonts/..%5c..%5cpackage.json', '/design-system/../server.mjs', '/design-system/src/../../../frige/server.mjs']) {
      const response = await rawGet(port, `${prefix[port]}${attempt}`);
      assert.notEqual(response.status, 200, attempt);
      assert.doesNotMatch(response.text, /"name": "@stex\/|createServer/, attempt);
    }
  }
});

test('serves its own masthead media, byte-identical to Pantheon, with byte ranges for video', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'stex-frige-media-'));
  await startFrige(root, 4416, context);
  const base = 'http://127.0.0.1:4416/frige';
  for (const [file, type] of [['masthead/pantheon-masthead-still-1920w.webp', 'image/webp'], ['masthead/pantheon-masthead-loop-960w.mp4', 'video/mp4'], ['studios/frige-emblem-388w.webp', 'image/webp']]) {
    const response = await fetch(`${base}/media/${file}`);
    assert.equal(response.status, 200, file); assert.equal(response.headers.get('content-type'), type, file);
    const pantheon = await readFile(path.join(repositoryRoot, 'apps', 'pantheon', 'public', 'media', file));
    assert.ok(Buffer.from(await response.arrayBuffer()).equals(pantheon), `${file} differs from Pantheon's copy`);
  }
  const range = await fetch(`${base}/media/masthead/pantheon-masthead-loop-1920w.webm`, { headers: { range: 'bytes=0-99' } });
  assert.equal(range.status, 206); assert.equal(range.headers.get('content-type'), 'video/webm');
  assert.match(range.headers.get('content-range'), /^bytes 0-99\/\d+$/); assert.equal((await range.arrayBuffer()).byteLength, 100);
});

test('redirects presentation to Pantheon and creates an isolated book through publishing v1', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'stex-frige-lobby-'));
  await startFrige(root, 4411, context);
  const lobby = await fetch('http://127.0.0.1:4411/frige/', { redirect: 'manual' });
  assert.equal(lobby.status, 308); assert.equal(lobby.headers.get('location'), 'http://127.0.0.1:4300/frige/');
  const created = await fetch('http://127.0.0.1:4411/frige/api/stex/publishing/v1/books', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'New Fixture', author: 'A. Author' }) });
  assert.equal(created.status, 201); const project = await created.json(); assert.match(project.id, /^new-fixture-/);
  assert.equal(created.headers.get('x-stex-contract'), 'stex.frige.publishing.v1');
  assert.match(await readFile(path.join(root, 'books', project.id, 'manuscript', 'Programme.md'), 'utf8'), /New Fixture/);
  const listed = await fetch('http://127.0.0.1:4411/frige/api/stex/publishing/v1/books');
  assert.equal((await listed.json())[0].id, project.id);
  const prefix = `http://127.0.0.1:4411/frige/api/stex/publishing/v1`;
  const graph = await (await fetch(`${prefix}/project/graph?book=${project.id}`)).json();
  const node = await (await fetch(`${prefix}/nodes/${graph.readingOrder[0]}?book=${project.id}`)).json();
  const save = await fetch(`${prefix}/nodes/${node.id}?book=${project.id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source: '# Revised synthetic title\n', baseHash: node.hash }) });
  assert.equal(save.status, 200);
  const stale = await fetch(`${prefix}/nodes/${node.id}?book=${project.id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source: 'stale', baseHash: node.hash }) });
  assert.equal(stale.status, 409);
  assert.equal((await fetch(`${prefix}/books`, { method: 'DELETE' })).status, 405);
  assert.equal((await fetch(`${prefix}/stex/legacy-books/v1`)).status, 404);
});
