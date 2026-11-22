/** Frige regression tests source that checks base path behavior with disposable fixtures. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { access, mkdir, mkdtemp, readFile, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const appDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Starts Frige with disposable publishing state and fake inference. */
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
/** Reads the status, headers and raw bytes of an HTTP fixture response. */
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

test('publishing v1 carries a change contract from proposal through acceptance, history and rollback', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'stex-frige-contract-'));
  // The deterministic simulator stands in for the director: no gateway, no provider.
  await startFrige(root, 4417, context, { STEX_FRIGE_SHELL_URL: '/', STEX_FRIGE_INFERENCE_MODE: 'fake' });
  const prefix = 'http://127.0.0.1:4417/frige/api/stex/publishing/v1';
  /** Calls the local fixture boundary with the encoded request. */
  const call = async (route, { method = 'GET', payload } = {}) => {
    const response = await fetch(`${prefix}${route}`, { method, headers: { 'content-type': 'application/json' }, ...(payload ? { body: JSON.stringify(payload) } : {}) });
    return { status: response.status, contract: response.headers.get('x-stex-contract'), body: await response.json().catch(() => null) };
  };
  const project = (await call('/books', { method: 'POST', payload: { title: 'Contract Fixture', author: 'A. Author' } })).body;
  const book = `?book=${project.id}`;
  const graph = (await call(`/project/graph${book}`)).body;
  const nodeId = graph.readingOrder[0];
  const file = path.join(root, 'books', project.id, 'manuscript', graph.nodes.find((entry) => entry.id === nodeId).relativePath);
  const original = await readFile(file);
  const node = (await call(`/nodes/${nodeId}${book}`)).body;

  // A save must name the text it replaces.
  const unguarded = await call(`/nodes/${nodeId}${book}`, { method: 'PUT', payload: { source: 'Overwritten.\n' } });
  assert.equal(unguarded.status, 400); assert.equal(unguarded.body.code, 'BASE_HASH_REQUIRED');

  const turn = await call(`/scopes/${nodeId}/turn${book}`, { method: 'POST', payload: { message: 'Simulate change: A synthetic closing line.' } });
  assert.equal(turn.status, 200); assert.equal(turn.contract, 'stex.frige.publishing.v1');
  const proposed = turn.body.changeSet;
  assert.equal(proposed.contract, 'stex.frige.change-contract.v1'); assert.equal(proposed.request, 'Simulate change: A synthetic closing line.');
  assert.equal(proposed.origin.userTurnId, turn.body.userTurn.id); assert.equal(proposed.origin.transport, 'fake');
  assert.deepEqual(proposed.context.offered, [{ nodeId, relativePath: node.relativePath, hash: node.hash, category: 'canonical-source' }]);
  assert.match(proposed.context.designHash, /^[a-f0-9]{8,}$/);
  // The context from the levels around the scope is recorded by category (Wave 3c).
  assert.deepEqual(proposed.context.outline, { category: 'outline', count: graph.readingOrder.length, truncated: false });
  assert.deepEqual(proposed.context.settings, { category: 'document-settings', designHash: proposed.context.designHash });
  assert.deepEqual(proposed.context.contracts, []);
  assert.equal(proposed.context.hierarchyConfirmed, false, 'with no gateway, the record says it is what Frige sent');
  assert.ok((await readFile(file)).equals(original), 'the proposal is inert');

  const accepted = await call(`/scopes/${nodeId}/changes/decide${book}`, { method: 'POST', payload: { changeSetId: proposed.id, nodeId, decision: 'accept' } });
  assert.equal(accepted.status, 200); assert.equal(accepted.body.changes[0].status, 'accepted');
  assert.match(await readFile(file, 'utf8'), /A synthetic closing line\./);

  const history = await call(`/project/contracts${book}&node=${nodeId}`);
  assert.equal(history.status, 200); assert.equal(history.body.length, 1); assert.equal(history.body[0].id, proposed.id);
  assert.equal('source' in history.body[0].changes[0], false, 'a history listing carries no manuscript text');
  const full = await call(`/contracts/${proposed.id}${book}`);
  assert.equal(full.status, 200); assert.equal(full.body.changes[0].before, node.source);

  const reverted = await call(`/contracts/${proposed.id}/revert${book}`, { method: 'POST', payload: {} });
  assert.equal(reverted.status, 200); assert.equal(reverted.body.changes[0].status, 'reverted');
  assert.ok((await readFile(file)).equals(original), 'rollback restores the exact bytes');
  assert.equal((await call(`/nodes/${nodeId}${book}`)).body.hash, node.hash);

  const again = await call(`/contracts/${proposed.id}/revert${book}`, { method: 'POST', payload: {} });
  assert.equal(again.status, 409); assert.equal(again.body.code, 'NOTHING_TO_REVERT');

  // A piece edited after acceptance: the rollback is refused over HTTP and the edit survives.
  const second = (await call(`/scopes/${nodeId}/turn${book}`, { method: 'POST', payload: { message: 'Simulate change: Another closing line.' } })).body.changeSet;
  await call(`/scopes/${nodeId}/changes/decide${book}`, { method: 'POST', payload: { changeSetId: second.id, nodeId, decision: 'accept' } });
  const afterAccept = (await call(`/nodes/${nodeId}${book}`)).body;
  const byHand = `${afterAccept.source}Edited by hand.\n`;
  assert.equal((await call(`/nodes/${nodeId}${book}`, { method: 'PUT', payload: { source: byHand, baseHash: afterAccept.hash } })).status, 200);
  const refused = await call(`/contracts/${second.id}/revert${book}`, { method: 'POST', payload: {} });
  assert.equal(refused.status, 409); assert.equal(refused.body.code, 'STALE_SOURCE');
  assert.doesNotMatch(refused.body.error, /[A-Za-z]:\\|\/tmp\//, 'the refusal names the piece, not a path');
  assert.equal(await readFile(file, 'utf8'), byHand);
  // A body of `null` is a request with no piece named, not a server error.
  const nullBody = await fetch(`${prefix}/contracts/${second.id}/revert${book}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: 'null' });
  assert.equal(nullBody.status, 409); assert.equal((await nullBody.json()).code, 'STALE_SOURCE');
  // The unversioned compatibility path reaches the same operations and the same refusals.
  const unversioned = await fetch(`http://127.0.0.1:4417/frige/api/contracts/${second.id}${book}`);
  assert.equal(unversioned.status, 200); assert.equal((await unversioned.json()).id, second.id);
  const missing = await call(`/contracts/00000000-0000-4000-8000-000000000000${book}`);
  assert.equal(missing.status, 404); assert.equal(missing.body.code, 'CONTRACT_NOT_FOUND');
  assert.equal((await call(`/contracts/00000000-0000-4000-8000-000000000000/revert${book}`, { method: 'POST', payload: {} })).status, 404);
  assert.equal((await call(`/project/contracts${book}`, { method: 'DELETE' })).status, 405);
  assert.equal((await call(`/contracts/${proposed.id}/revert${book}`)).status, 405, 'rollback is never a GET');
  assert.equal((await call(`/contracts/not-a-contract${book}`)).status, 404);
});

test('a passage turn is checked against the current source, recorded with the message, and limits its proposal', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'stex-frige-passage-'));
  await startFrige(root, 4419, context, { STEX_FRIGE_SHELL_URL: '/', STEX_FRIGE_INFERENCE_MODE: 'fake' });
  const prefix = 'http://127.0.0.1:4419/frige/api/stex/publishing/v1';
  /** Calls the local fixture boundary with the encoded request. */
  const call = async (route, { method = 'GET', payload } = {}) => {
    const response = await fetch(`${prefix}${route}`, { method, headers: { 'content-type': 'application/json' }, ...(payload ? { body: JSON.stringify(payload) } : {}) });
    return { status: response.status, body: await response.json().catch(() => null) };
  };
  const project = (await call('/books', { method: 'POST', payload: { title: 'Passage Fixture' } })).body;
  const book = `?book=${project.id}`;
  const nodeId = (await call(`/project/graph${book}`)).body.readingOrder[0];
  const file = path.join(root, 'books', project.id, 'manuscript', (await call(`/project/graph${book}`)).body.nodes.find((entry) => entry.id === nodeId).relativePath);
  // A CRLF piece in which the selected phrase also occurs outside the passage.
  const source = '# Passage\r\n\r\nThe river ran.\r\n  The river ran again.\r\nA bell sounded.\r\n';
  const saved = (await call(`/nodes/${nodeId}${book}`, { method: 'PUT', payload: { source, baseHash: (await call(`/nodes/${nodeId}${book}`)).body.hash } })).body;
  const editor = source.replace(/\r\n/g, '\n'); const text = '  The river ran again.';
  /** Resolves the requested revision selection within the owning engine. */
  const selection = (overrides = {}) => ({ nodeId, baseHash: saved.hash, start: editor.indexOf(text), end: editor.indexOf(text) + text.length, text, action: 'revise', ...overrides });
  /** Reads the conversation history for the requested target. */
  const turns = async () => (await call(`/scopes/${nodeId}/turns${book}`)).body.length;

  // A revise: the passage is recorded with the message, and the simulator's edit lands inside it.
  const revise = await call(`/scopes/${nodeId}/turn${book}`, { method: 'POST', payload: { message: 'Revise the selected passage.', selection: selection() } });
  assert.equal(revise.status, 200, JSON.stringify(revise.body));
  const recorded = revise.body.userTurn.passage;
  assert.deepEqual({ ...recorded, start: undefined, end: undefined }, { nodeId, relativePath: saved.relativePath, title: saved.title, baseHash: saved.hash, action: 'revise', start: undefined, end: undefined, startLine: 4, endLine: 4, text });
  assert.equal(source.slice(recorded.start, recorded.end), text, 'offsets name the canonical bytes, past the CRLFs before them');
  assert.equal(revise.body.changeSet.origin.userTurnId, revise.body.userTurn.id, 'the contract leads back to the passage');
  await call(`/scopes/${nodeId}/changes/decide${book}`, { method: 'POST', payload: { changeSetId: revise.body.changeSet.id, nodeId, decision: 'accept' } });
  assert.equal(await readFile(file, 'utf8'), source.replace(text, `${text} — simulated revision`), 'only the passage changed; CRLFs and the other lines are untouched');

  // The piece has changed, so the old selection is stale: refused, and nothing is recorded.
  const before = await turns();
  const stale = await call(`/scopes/${nodeId}/turn${book}`, { method: 'POST', payload: { message: 'Again.', selection: selection() } });
  assert.equal(stale.status, 409); assert.equal(stale.body.code, 'PASSAGE_STALE');
  const current = (await call(`/nodes/${nodeId}${book}`)).body;
  for (const [overrides, pattern] of [
    [{ baseHash: current.hash, text: 'Not what is there.'.padEnd(text.length, '.') }, /no longer at that place/],
    [{ baseHash: current.hash, action: 'rewrite-everything' }, /passage action is one of/],
    [{ baseHash: current.hash, nodeId: 'node-not-offered-here' }, /not in a piece this conversation offers/],
  ]) {
    const refused = await call(`/scopes/${nodeId}/turn${book}`, { method: 'POST', payload: { message: 'Again.', selection: selection(overrides) } });
    assert.equal(refused.status, 400, JSON.stringify(overrides)); assert.equal(refused.body.code, 'INVALID_PASSAGE'); assert.match(refused.body.error, pattern);
  }
  assert.equal(await turns(), before, 'a refused selection records no turn');

  // An edit outside the passage is set aside and the reply says why; with "ask", the passage is context only.
  /** Creates isolated route test data for the next scenario. */
  const fresh = (overrides = {}) => { const shown = current.source.replace(/\r\n/g, '\n'); const at = shown.indexOf('A bell sounded.'); return { nodeId, baseHash: current.hash, start: at, end: at + 15, text: 'A bell sounded.', ...overrides }; };
  const outside = await call(`/scopes/${nodeId}/turn${book}`, { method: 'POST', payload: { message: 'Simulate edit: The river ran. => The stream ran.', selection: fresh({ action: 'revise' }) } });
  assert.equal(outside.body.changeSet, null); assert.match(outside.body.assistantTurn.droppedChanges[0].reason, /not in the selected passage/);
  const asked = await call(`/scopes/${nodeId}/turn${book}`, { method: 'POST', payload: { message: 'Simulate edit: The river ran. => The stream ran.', selection: fresh({ action: 'ask' }) } });
  assert.equal(asked.body.changeSet.changes.length, 1, 'a question about a passage may still propose elsewhere in the piece');
});

test('a contract records the context the gateway reports it forwarded, marked as confirmed', async (context) => {
  // A stub gateway that proposes one change and reports a trimmed outline and one contract forwarded.
  const gateway = http.createServer(async (request, response) => {
    let raw = ''; for await (const chunk of request) raw += chunk;
    const turn = JSON.parse(raw); const source = turn.scopeSources[0];
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ commentary: 'Stub proposal.', changes: [{ nodeId: source.nodeId, source: `${source.source}\nFrom the stub.\n`, summary: 'Stub' }], parts: [], meta: { model: 'stub', usage: { transport: 'stub' }, forwardedContext: { outline: { count: 1, truncated: true }, documentSettings: true, approvedContracts: [] } } }));
  });
  await new Promise((resolve) => gateway.listen(0, '127.0.0.1', resolve));
  context.after(() => gateway.close());
  const root = await mkdtemp(path.join(os.tmpdir(), 'stex-frige-confirmed-'));
  await startFrige(root, 4418, context, { STEX_FRIGE_SHELL_URL: '/', STEX_FRIGE_INFERENCE_MODE: '', TEXGRAPH_INFERENCE_MODE: '', STEX_INFERENCE_URL: `http://127.0.0.1:${gateway.address().port}`, STEX_INFERENCE_SHARED_SECRET: 'test-only' });
  const prefix = 'http://127.0.0.1:4418/frige/api/stex/publishing/v1';
  /** Posts the synthetic payload to the selected fixture route. */
  const post = async (route, payload) => (await fetch(`${prefix}${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })).json();
  const project = await post('/books', { title: 'Confirmed Fixture' });
  const graph = await (await fetch(`${prefix}/project/graph?book=${project.id}`)).json();
  const turn = await post(`/scopes/${graph.readingOrder[0]}/turn?book=${project.id}`, { message: 'Propose something.' });
  assert.deepEqual(turn.changeSet.context.outline, { category: 'outline', count: 1, truncated: true }, 'what the gateway forwarded, not what Frige sent');
  assert.equal(turn.changeSet.context.hierarchyConfirmed, true);
  assert.deepEqual(turn.changeSet.context.contracts, []);
});
