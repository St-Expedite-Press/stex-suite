/** Frige project-password tests: the access record, unlock cookies, and every route that opens a project. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { AccessError, openProjectAccess } from '../src/project-access.mjs';

const appDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** Expects an AccessError with this status and code. */
const refused = (status, code) => (error) => error instanceof AccessError && error.status === status && error.code === code;
/** Turns a Set-Cookie value into the Cookie header a browser would send back. */
const cookieOf = (setCookie) => setCookie.split(';')[0];

test('the access record protects, unlocks, versions and clears project passwords', async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'stex-frige-access-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'access.json');
  let clock = Date.parse('2026-11-23T00:00:00Z');
  const access = openProjectAccess({ file, now: () => clock });

  // Without a configured file nothing is protected. With one configured, a missing
  // file refuses everything (it never silently switches protection off) until created.
  await openProjectAccess({}).assertUnlocked('book', 'alpha', {});
  await assert.rejects(access.assertUnlocked('book', 'alpha', {}), refused(503, 'ACCESS_UNAVAILABLE'));
  await assert.rejects(access.isProtected('book', 'alpha'), refused(503, 'ACCESS_UNAVAILABLE'));
  assert.deepEqual(await access.initialize(), { created: true });
  assert.deepEqual(await access.initialize(), { created: false });
  assert.equal(await access.isProtected('book', 'alpha'), false);
  await access.assertUnlocked('book', 'alpha', {});
  await assert.rejects(access.setPassword('book', 'alpha', 'short'), refused(400, 'INVALID_REQUEST'));
  assert.deepEqual(await access.setPassword('book', 'alpha', 'fixture-passphrase'), { key: 'book:alpha', version: 1 });
  const stored = await readFile(file, 'utf8');
  assert.doesNotMatch(stored, /fixture-passphrase/, 'only a hash is stored');
  if (process.platform !== 'win32') assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.equal(await access.isProtected('book', 'alpha'), true);
  assert.equal(await access.isProtected('book', 'beta'), false);
  assert.equal(await access.isProtected('project', 'alpha'), false, 'kinds are separate');

  await assert.rejects(access.assertUnlocked('book', 'alpha', {}), refused(403, 'PROJECT_LOCKED'));
  await assert.rejects(access.unlock({ kind: 'book', id: 'alpha', password: 'wrong-password', cookiePath: '/frige/', secure: true }), refused(403, 'WRONG_PASSWORD'));
  await assert.rejects(access.unlock({ kind: 'book', id: 'beta', password: 'fixture-passphrase', cookiePath: '/frige/', secure: true }), refused(400, 'INVALID_REQUEST'));
  const setCookie = await access.unlock({ kind: 'book', id: 'alpha', password: 'fixture-passphrase', cookiePath: '/frige/', secure: true });
  assert.match(setCookie, /^stex_frige_unlock_book_alpha=1\.\d+\.[A-Za-z0-9_-]+; Path=\/frige\/; Max-Age=43200; HttpOnly; SameSite=Strict; Secure$/);
  assert.doesNotMatch(await access.unlock({ kind: 'book', id: 'alpha', password: 'fixture-passphrase', cookiePath: '/', secure: false }), /Secure/);
  const cookie = cookieOf(setCookie);
  await access.assertUnlocked('book', 'alpha', { cookie: `other=1; ${cookie}` });

  // A forged, re-targeted or expired unlock is refused.
  const [name, value] = cookie.split('=');
  const [version, expires, signature] = value.split('.');
  for (const forged of [`${name}=${version}.${Number(expires) + 999999}.${signature}`, `${name}=${version}.${expires}.${signature.slice(0, -2)}xx`, `stex_frige_unlock_book_beta=${value}`, `${name}=2.${expires}.${signature}`]) {
    await assert.rejects(access.assertUnlocked('book', 'alpha', { cookie: forged }), refused(403, 'PROJECT_LOCKED'), forged);
  }
  clock += 13 * 60 * 60 * 1000;
  await assert.rejects(access.assertUnlocked('book', 'alpha', { cookie }), refused(403, 'PROJECT_LOCKED'), 'expired after twelve hours');
  clock -= 13 * 60 * 60 * 1000;

  // Changing the password voids earlier unlocks; the server reads the change without restarting.
  const other = openProjectAccess({ file, now: () => clock });
  await other.assertUnlocked('book', 'alpha', { cookie });
  assert.deepEqual(await access.setPassword('book', 'alpha', 'a-new-password'), { key: 'book:alpha', version: 2 });
  await new Promise((resolve) => setTimeout(resolve, 20));
  await assert.rejects(other.assertUnlocked('book', 'alpha', { cookie }), refused(403, 'PROJECT_LOCKED'));
  assert.deepEqual(await access.list(), [{ key: 'book:alpha', version: 2, protected: true, updatedAt: '2026-11-23T00:00:00.000Z' }]);

  // Ten wrong passwords in fifteen minutes stop further attempts, even the right one.
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await assert.rejects(access.unlock({ kind: 'book', id: 'alpha', password: `guess-${attempt}`, cookiePath: '/', secure: false }), refused(403, 'WRONG_PASSWORD'));
  }
  await assert.rejects(access.unlock({ kind: 'book', id: 'alpha', password: 'a-new-password', cookiePath: '/', secure: false }), refused(429, 'RATE_LIMITED'));
  clock += 16 * 60 * 1000;
  const second = cookieOf(await access.unlock({ kind: 'book', id: 'alpha', password: 'a-new-password', cookiePath: '/', secure: false }));

  // Parallel guesses share the limit: of thirty at once, at most ten are even checked.
  await access.setPassword('book', 'gamma', 'gamma-password');
  const parallel = await Promise.allSettled(Array.from({ length: 30 }, (_, index) => access.unlock({ kind: 'book', id: 'gamma', password: `parallel-${index}`, cookiePath: '/', secure: false })));
  const codes = parallel.map((result) => result.reason?.code);
  assert.equal(codes.filter((code) => code === 'WRONG_PASSWORD').length, 10);
  assert.equal(codes.filter((code) => code === 'RATE_LIMITED').length, 20);

  // Clearing keeps the version, so setting a password again never revives an old unlock.
  assert.deepEqual(await access.clearPassword('book', 'alpha'), { key: 'book:alpha', removed: true });
  assert.deepEqual(await access.clearPassword('book', 'alpha'), { key: 'book:alpha', removed: false });
  await access.assertUnlocked('book', 'alpha', {});
  assert.equal(await access.isProtected('book', 'alpha'), false);
  assert.deepEqual((await access.list()).find((entry) => entry.key === 'book:alpha'), { key: 'book:alpha', version: 2, protected: false, updatedAt: '2026-11-23T00:16:00.000Z' });
  assert.deepEqual(await access.setPassword('book', 'alpha', 'fixture-passphrase'), { key: 'book:alpha', version: 3 });
  for (const old of [cookie, second]) await assert.rejects(access.assertUnlocked('book', 'alpha', { cookie: old }), refused(403, 'PROJECT_LOCKED'));
  await assert.rejects(access.assertUnlocked('book', '../alpha', {}), refused(400, 'INVALID_REQUEST'));

  // A damaged record never opens anything: every check fails instead.
  await writeFile(file, '{"schemaVersion":1,"secret":"bad","projects":{}}');
  const damaged = openProjectAccess({ file });
  await assert.rejects(damaged.assertUnlocked('book', 'alpha', {}), /invalid/);
});

test('a protected book is closed on every Frige route until this browser unlocks it', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'stex-frige-locked-'));
  const accessFile = path.join(root, 'access.json');
  const child = spawn(process.execPath, ['server.mjs'], { cwd: appDirectory, env: {
    ...process.env, STEX_FRIGE_PORT: '4431', STEX_FRIGE_PROJECT_DIR: root, STEX_FRIGE_BOOKS_DIR: path.join(root, 'books'), STEX_FRIGE_BASE_PATH: '/frige',
    STEX_FRIGE_SHELL_URL: '/', STEX_FRIGE_INFERENCE_MODE: 'fake', STEX_FRIGE_ACCESS_FILE: accessFile,
  } });
  context.after(async () => { const exited = new Promise((resolve) => child.once('exit', resolve)); child.kill(); await exited; await rm(root, { recursive: true, force: true }); });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Frige server did not start.')), 5_000);
    child.stdout.on('data', (data) => { if (data.toString().includes('ready')) { clearTimeout(timeout); resolve(); } });
    child.on('error', reject);
  });
  const base = 'http://127.0.0.1:4431/frige';
  const json = { 'content-type': 'application/json' };
  const created = await (await fetch(`${base}/api/stex/publishing/v1/books`, { method: 'POST', headers: json, body: JSON.stringify({ title: 'Locked Fixture', author: 'A. Author' }) })).json();
  const id = created.id;
  const open = await (await fetch(`${base}/api/stex/publishing/v1/books`, { method: 'POST', headers: json, body: JSON.stringify({ title: 'Open Fixture', author: 'A. Author' }) })).json();
  // A configured record that is missing refuses every book, and the listing hides them.
  const missing = await fetch(`${base}/api/stex/publishing/v1/project/graph?book=${id}`);
  assert.equal(missing.status, 503); assert.equal((await missing.json()).code, 'ACCESS_UNAVAILABLE');
  assert.equal((await fetch(`${base}/api/stex/context/v1/projects/${id}`)).status, 503);
  assert.deepEqual((await (await fetch(`${base}/api/stex/legacy-books/v1`)).json()).map((entry) => entry.id), []);
  await openProjectAccess({ file: accessFile }).initialize();
  const graph = await fetch(`${base}/api/stex/publishing/v1/project/graph?book=${id}`);
  assert.equal(graph.status, 200, 'unprotected before a password is set');
  const [nodeId] = (await graph.json()).readingOrder;
  const editorial = `/api/stex/publishing/v1/nodes/${nodeId}`;
  const piece = await (await fetch(`${base}${editorial}?book=${id}`)).json();
  const replacement = piece.source + '\nA synthetic revision.\n';
  const saved = await fetch(`${base}${editorial}?book=${id}`, { method: 'PUT', headers: json, body: JSON.stringify({ source: replacement, baseHash: piece.hash }) });
  assert.equal(saved.status, 200);
  const { currentHash, currentRevisionId, entries } = await (await fetch(`${base}${editorial}/revisions?book=${id}`)).json();
  const originalId = entries[1].id;
  assert.equal(entries[0].kind, 'save');
  const currentBase = { baseHash: currentHash, baseRevisionId: currentRevisionId };
  const upload = await fetch(`${base}/api/stex/publishing/v1/project/attachments?book=${id}`, {
    method: 'POST', headers: json, body: JSON.stringify({ attachments: [{ name: 'notes.md', contentBase64: Buffer.from('Synthetic café.\r\n  A note.').toString('base64') }] }),
  });
  assert.equal(upload.status, 201);
  const [document] = await upload.json();
  const attachment = `/api/stex/publishing/v1/project/attachments/${document.id}`;

  await openProjectAccess({ file: accessFile }).setPassword('book', id, 'fixture-passphrase');
  const closed = [
    `/api/stex/publishing/v1/project/graph?book=${id}`,
    `/api/stex/publishing/v1/project/build?book=${id}`,
    `/api/project/graph?book=${id}`,
    `/api/stex/context/v1/projects/${id}`,
    `/api/stex/legacy-books/v1/${id}/documents`,
  ];
  for (const route of closed) {
    const response = await fetch(`${base}${route}`);
    assert.equal(response.status, 403, route); assert.equal((await response.json()).code, 'PROJECT_LOCKED', route);
  }
  const editorialRoutes = [
    [`${editorial}/revisions`, 'GET'],
    [`${editorial}/revisions/${originalId}`, 'GET'],
    [`${editorial}/revisions/${originalId}/restore`, 'POST'],
    [`${editorial}/decisions`, 'GET'],
    [`${editorial}/decisions`, 'POST'],
    [`${attachment}/excerpt`, 'GET'],
    [`${attachment}/approve`, 'POST'],
  ];
  for (const [route, method] of editorialRoutes) {
    const options = method === 'POST' ? { method, headers: json, body: '{}' } : { method };
    const response = await fetch(`${base}${route}?book=${id}`, options);
    assert.equal(response.status, 403, route);
    assert.equal((await response.json()).code, 'PROJECT_LOCKED', route);
  }
  const other = await fetch(`${base}${editorial}/revisions/${originalId}?book=${open.id}`);
  assert.equal(other.status, 404, 'another book cannot resolve the protected book’s revision');
  const write = await fetch(`${base}/api/stex/publishing/v1/project/build?book=${id}`, { method: 'POST', headers: json, body: '{}' });
  assert.equal(write.status, 403, 'writes are closed too'); await write.arrayBuffer();
  assert.equal((await fetch(`${base}/api/stex/publishing/v1/project/graph?book=${open.id}`)).status, 200, 'other books stay open');

  // Listings show the book, marked, without opening it.
  // The legacy listing keeps only the title of a protected book.
  const legacy = await (await fetch(`${base}/api/stex/legacy-books/v1`)).json();
  const legacyLocked = legacy.find((entry) => entry.id === id);
  assert.deepEqual([legacyLocked.locked, legacyLocked.author, legacyLocked.description, legacyLocked.manuscriptNodes], [true, '', 'Password protected', 0]);
  const legacyOpen = legacy.find((entry) => entry.id === open.id);
  assert.equal(legacyOpen.locked, undefined, 'an open book is not marked');
  assert.notEqual(legacyOpen.description, 'Password protected');
  const listed = await (await fetch(`${base}/api/stex/publishing/v1/books`)).json();
  assert.equal(listed.find((entry) => entry.id === id).locked, true);
  assert.equal(listed.find((entry) => entry.id === open.id).locked, false);
  const summaries = await (await fetch(`${base}/api/stex/projects`)).json();
  assert.deepEqual(summaries.projects.find((entry) => entry.id === id).status, { state: 'ready', label: 'Password protected' });

  const wrong = await fetch(`${base}/api/stex/access/v1/unlock`, { method: 'POST', headers: json, body: JSON.stringify({ kind: 'book', id, password: 'nope-nope' }) });
  assert.equal(wrong.status, 403); assert.equal((await wrong.json()).code, 'WRONG_PASSWORD'); assert.equal(wrong.headers.get('set-cookie'), null);
  assert.equal((await fetch(`${base}/api/stex/access/v1/unlock`, { method: 'POST', body: JSON.stringify({ kind: 'book', id, password: 'fixture-passphrase' }) })).status, 415, 'JSON only');
  assert.equal((await fetch(`${base}/api/stex/access/v1/unlock`)).status, 405);
  const foreign = await fetch(`${base}/api/stex/access/v1/unlock`, { method: 'POST', headers: { ...json, origin: 'https://attacker.test' }, body: JSON.stringify({ kind: 'book', id, password: 'fixture-passphrase' }) });
  assert.equal(foreign.status, 403); assert.equal(foreign.headers.get('set-cookie'), null);

  const right = await fetch(`${base}/api/stex/access/v1/unlock`, { method: 'POST', headers: { ...json, 'x-forwarded-proto': 'https' }, body: JSON.stringify({ kind: 'book', id, password: 'fixture-passphrase' }) });
  assert.equal(right.status, 200);
  const setCookie = right.headers.get('set-cookie');
  assert.match(setCookie, /Path=\/frige\/; Max-Age=43200; HttpOnly; SameSite=Strict; Secure$/);
  const unlocked = { cookie: cookieOf(setCookie) };
  for (const route of closed.slice(0, 4)) assert.equal((await fetch(`${base}${route}`, { headers: unlocked })).status, 200, route);
  const original = await (await fetch(`${base}${editorial}/revisions/${originalId}?book=${id}`, { headers: unlocked })).json();
  assert.equal(original.source, piece.source);
  const allowedWrite = { method: 'POST', headers: { ...json, ...unlocked } };
  const preview = await (await fetch(`${base}${attachment}/excerpt?book=${id}`, { headers: unlocked })).json();
  assert.equal(preview.excerpt, 'Synthetic café.\r\n  A note.');
  const foreignExcerpt = await fetch(`${base}${attachment}/excerpt?book=${open.id}`, { headers: unlocked });
  assert.equal(foreignExcerpt.status, 404);
  const staleExcerpt = await fetch(`${base}${attachment}/approve?book=${id}`, { ...allowedWrite, body: JSON.stringify({ hash: '0'.repeat(64) }) });
  assert.equal(staleExcerpt.status, 409);
  const approvedExcerpt = await fetch(`${base}${attachment}/approve?book=${id}`, { ...allowedWrite, body: JSON.stringify({ hash: preview.hash }) });
  assert.equal(approvedExcerpt.status, 200);
  assert.equal((await approvedExcerpt.json()).approvalHash, preview.hash);
  const decision = await fetch(`${base}${editorial}/decisions?book=${id}`, { ...allowedWrite, body: JSON.stringify({ ...currentBase, reason: 'Retain the synthetic reading.' }) });
  assert.equal(decision.status, 201);
  assert.equal((await decision.json()).revisionId, currentRevisionId);
  const decisions = await (await fetch(`${base}${editorial}/decisions?book=${id}`, { headers: unlocked })).json();
  assert.equal(decisions.entries.length, 1);
  assert.equal((await fetch(`${base}${editorial}/decisions?book=${id}`)).status, 403, 'another client stays locked');
  const restore = await fetch(`${base}${editorial}/revisions/${originalId}/restore?book=${id}`, { ...allowedWrite, body: JSON.stringify(currentBase) });
  assert.equal(restore.status, 200);
  const restored = await restore.json();
  assert.equal(restored.revision.restoredFrom, originalId);
  assert.equal(restored.node.source, piece.source);

  const locked = await fetch(`${base}/api/stex/access/v1/lock`, { method: 'POST', headers: json, body: JSON.stringify({ kind: 'book', id }) });
  assert.match(locked.headers.get('set-cookie'), /Max-Age=0/);
});
