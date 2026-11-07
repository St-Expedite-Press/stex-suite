import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { localProxyTarget, mountedApplication, validateRegistry } from '../src/shell.mjs';
import { appBase, appUrl } from '../workspaces/frige/base-path.js';

const appDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('publishing UI resolves versioned APIs without changing proof resources or mount selection', () => {
  assert.equal(appBase('http://127.0.0.1:4300/frige/?book=fixture'), '/frige');
  assert.equal(appUrl('/api/project/graph', 'http://127.0.0.1:4300/frige/'), '/frige/api/stex/publishing/v1/project/graph');
  assert.equal(appUrl('/vendor/pdfjs/pdf.min.mjs', 'http://127.0.0.1:4300/frige/'), '/frige/vendor/pdfjs/pdf.min.mjs');
  assert.throws(() => appUrl('api/project/graph'), /start with/);
});

async function startPantheon(root, port, context, environment = {}) {
  const child = spawn(process.execPath, ['server.mjs'], { cwd: appDirectory, env: { ...process.env, STEX_PANTHEON_PORT: String(port), STEX_FRIGE_BOOKS_DIR: root, ...environment } });
  context.after(async () => { child.kill(); await rm(root, { recursive: true, force: true }); });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Lab server did not start.')), 5_000);
    child.stdout.on('data', (data) => { if (data.toString().includes('ready')) { clearTimeout(timeout); resolve(); } });
    child.on('error', reject);
  });
}

async function startFrige(root, port, context) {
  const local = await mkdtemp(path.join(os.tmpdir(), 'stex-frige-compat-'));
  const child = spawn(process.execPath, ['server.mjs'], { cwd: path.resolve(appDirectory, '../frige'), env: { ...process.env, STEX_FRIGE_PORT: String(port), STEX_FRIGE_BOOKS_DIR: root, STEX_FRIGE_PROJECT_DIR: local, STEX_FRIGE_BASE_PATH: '/frige', STEX_FRIGE_INFERENCE_MODE: 'fake' } });
  context.after(async () => { const exited = new Promise((resolve) => child.once('exit', resolve)); child.kill(); await exited; await rm(local, { recursive: true, force: true }); });
  await new Promise((resolve, reject) => { child.stdout.on('data', (data) => { if (data.toString().includes('ready')) resolve(); }); child.on('error', reject); child.on('exit', (code) => { if (code) reject(new Error('Frige startup failed.')); }); });
  return { STEX_FRIGE_URL: `http://127.0.0.1:${port}` };
}

test('defines stable shell routes and rejects non-loopback proxy targets', () => {
  assert.equal(mountedApplication('/frige/api/health')?.id, 'frige');
  assert.equal(mountedApplication('/woden/')?.state, 'deferred');
  assert.equal(mountedApplication('/igor/c/abc')?.id, 'igor');
  assert.equal(localProxyTarget('http://127.0.0.1:4310', 'http://localhost:1').port, '4310');
  assert.throws(() => localProxyTarget('https://example.test', 'http://localhost:1'), /loopback HTTP/);
  assert.throws(() => localProxyTarget('http://127.0.0.1:4310/base', 'http://localhost:1'), /loopback HTTP/);
});

test('loads the five application identities from the v2 registry', async () => {
  const registry = JSON.parse(await readFile(path.resolve(appDirectory, '..', '..', 'protocol', 'applications', 'registry.v2.json'), 'utf8'));
  const applications = validateRegistry(registry);
  assert.deepEqual(applications.map(({ id, kind, route, state }) => ({ id, kind, route, state })), [
    { id: 'frige', kind: 'studio', route: '/frige/', state: 'active' },
    { id: 'seaxneat', kind: 'studio', route: '/seaxneat/', state: 'active' },
    { id: 'eostre', kind: 'studio', route: '/eostre/', state: 'deferred' },
    { id: 'woden', kind: 'studio', route: '/woden/', state: 'deferred' },
    { id: 'igor', kind: 'application', route: '/igor/', state: 'active' },
  ]);
  assert.throws(() => validateRegistry({ ...registry, schemaVersion: 'stex.applications.registry.v1' }), /invalid/);
  assert.throws(() => validateRegistry({ ...registry, applications: registry.applications.map((entry) => entry.id === 'igor' ? { ...entry, kind: 'agent' } : entry) }), /invalid/);
  assert.throws(() => validateRegistry({ ...registry, applications: registry.applications.slice(0, 4) }), /invalid/);
});

test('routes compatibility aliases, deferred applications, and mounted loopback applications', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'stex-books-'));
  const upstream = http.createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ path: request.url, prefix: request.headers['x-forwarded-prefix'] }));
  });
  await new Promise((resolve) => upstream.listen(4399, '127.0.0.1', resolve));
  context.after(() => upstream.close());
  await startPantheon(root, 4400, context, { STEX_FRIGE_URL: 'http://127.0.0.1:4399' });
  const alias = await fetch('http://127.0.0.1:4400/texgraph/?book=fixture', { redirect: 'manual' });
  assert.equal(alias.status, 308); assert.equal(alias.headers.get('location'), '/frige/?book=fixture');
  const deferred = await fetch('http://127.0.0.1:4400/eostre/');
  assert.equal(deferred.status, 200); assert.match(await deferred.text(), /registered in the STEX alpha/);
  const proxied = await fetch('http://127.0.0.1:4400/frige/api/health?book=fixture');
  assert.deepEqual(await proxied.json(), { path: '/frige/api/health?book=fixture', prefix: '/frige' });
  const legacy = await fetch('http://127.0.0.1:4400/api/books');
  assert.deepEqual(await legacy.json(), { path: '/frige/api/stex/legacy-books/v1', prefix: '/frige' });
  const workspace = await fetch('http://127.0.0.1:4400/seaxneat/?project=fixture', { redirect: 'manual' });
  assert.equal(workspace.status, 308); assert.equal(workspace.headers.get('location'), '/workspaces/seaxneat/?project=fixture');
  const composed = await (await fetch('http://127.0.0.1:4400/workspaces/seaxneat/')).text();
  assert.match(composed, /id="development-workspace"/); assert.match(composed, /aria-label="Pantheon"/);
  assert.match(composed, /workspace-assets\/seaxneat.js/);
  const unsafe = await fetch('http://127.0.0.1:4400/frige/%2e%2e/secret');
  assert.equal(unsafe.status, 404);
});

test('owns the publishing library and workstation inside the platform shell even when the engine is unavailable', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'stex-platform-publishing-'));
  await startPantheon(root, 4493, context, { STEX_FRIGE_URL: 'http://127.0.0.1:4494' });
  const base = 'http://127.0.0.1:4493';
  const library = await (await fetch(base + '/frige/')).text();
  const workspace = await (await fetch(base + '/frige/?book=fixture')).text();
  for (const html of [library, workspace]) {
    assert.match(html, /aria-label="Pantheon"/);
    assert.equal((html.match(/<main /g) || []).length, 1);
    assert.equal((html.match(/<header class="masthead/g) || []).length, 1);
    assert.doesNotMatch(html, /masthead--full|masthead--compact|src=".*masthead\.js"/);
  }
  assert.match(library, /Book projects/); assert.match(workspace, /id="source"/); assert.match(workspace, /id="proof-viewer"/);
  for (const asset of ['app.js', 'base-path.js', 'lobby.js', 'style.css', 'proof-viewer.js', 'thread.js', 'workspace.js']) assert.equal((await fetch(base + '/frige/' + asset)).status, 200);
  const api = await fetch(base + '/frige/api/stex/publishing/v1/project/graph?book=fixture');
  assert.equal(api.status, 502);
});

test('serves the public splash with a real local entry and no counterfeit authentication', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'stex-books-'));
  await startPantheon(root, 4401, context);
  const response = await fetch('http://127.0.0.1:4401/');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/html/);
  const html = await response.text();
  assert.match(html, /<html lang="en" data-stex-app="pantheon">/);
  assert.match(html, /<h1[^>]*id="splash-title"/);
  assert.match(html, /<a class="stex-button stex-button--primary splash-action" href="\/home\/" aria-describedby="splash-status">Sign in<\/a>/);
  assert.match(html, /id="splash-status">Local workspace · single user/);
  assert.doesNotMatch(html, /<form|type="password"|Create an account/i);
  assert.match(html, /<div class="splash-art" aria-hidden="true">/);
  assert.match(html, /<img class="splash-still" alt=""/);
  const video = /<video[^>]*>/.exec(html)[0];
  assert.doesNotMatch(video, /autoplay/);
  for (const attribute of ['muted', 'loop', 'playsinline', 'preload="none"']) assert.ok(video.includes(attribute), attribute);
  assert.match(html, /<button class="splash-motion-toggle" type="button" hidden>/);

  await assertReferences(html, 'http://127.0.0.1:4401');
});

// Every local file a page references (src, href, srcset) is served with its type and nosniff.
async function assertReferences(html, base) {
  const types = { '.webm': 'video/webm', '.mp4': 'video/mp4', '.webp': 'image/webp', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
  const references = new Set([...html.matchAll(/(?:src|href)="(\/[^"]+)"/g)].map(([, reference]) => reference));
  for (const [, list] of html.matchAll(/srcset="([^"]+)"/g)) for (const candidate of list.split(',')) references.add(candidate.trim().split(/\s+/)[0]);
  for (const reference of [...references].filter((entry) => !entry.endsWith('/'))) {
    const asset = await fetch(`${base}${reference}`, { method: 'HEAD' });
    assert.equal(asset.status, 200, reference);
    assert.equal(asset.headers.get('content-type'), types[path.extname(reference)], reference);
    assert.equal(asset.headers.get('x-content-type-options'), 'nosniff');
  }
}

test('serves the command-center pages with honest states and no mockup records', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'stex-books-'));
  await startPantheon(root, 4402, context);
  const base = 'http://127.0.0.1:4402';
  for (const tab of ['home', 'projects', 'studios', 'graph', 'activity']) {
    const bare = await fetch(`${base}/${tab}`, { redirect: 'manual' });
    assert.equal(bare.status, 308, tab); assert.equal(bare.headers.get('location'), `/${tab}/`);
    const page = await (await fetch(`${base}/${tab}/`)).text();
    assert.match(page, new RegExp(`<a href="/${tab}/" aria-current="page">`), tab);
    assert.equal((page.match(/aria-current="page"/g) || []).length, 1, tab);
    assert.doesNotMatch(/<video[^>]*>/.exec(page)[0], /autoplay/, tab);
    assert.doesNotMatch(page, /Marriage of Heaven|stexpedite\.press|Pantheon Interface|Build completed|undefined/, tab);
  }
  const home = await (await fetch(`${base}/home/`)).text();
  for (const [studio, state] of [['frige', 'Open'], ['seaxneat', 'Open'], ['eostre', 'Deferred'], ['woden', 'Deferred']]) {
    assert.match(home, new RegExp(`<li data-stex-app="${studio}"><a class="studio-card" href="/${studio}/">[\\s\\S]*?<span class="studio-state">${state}`), studio);
  }
  assert.match(home, /<h2 class="igor-name" id="igor-title">Igor<\/h2>/);
  assert.match(home, /<input class="igor-input"[^>]* disabled>/);
  assert.match(home, /<input class="igor-input"[^>]* maxlength="6000"/);
  // The Igor box is a handoff composer: it opens a conversation in Igor.
  assert.match(home, /<form class="igor-form" novalidate>/);
  assert.match(home, /<button class="stex-button stex-button--primary igor-send" type="submit" aria-label="Send to Igor" disabled>/);
  assert.match(home, /id="igor-note">Your message opens a new conversation in Igor\.<\/p>/);
  assert.match(home, /<a class="section-link" href="\/igor\/">All conversations<\/a>/);
  assert.doesNotMatch(home, /Nothing you ask is stored/);
  const script = await readFile(path.join(appDirectory, 'public', 'igor.js'), 'utf8');
  assert.match(script, /fetch\('\/igor\/api\/conversations'/); assert.match(script, /idempotencyKey/); assert.match(script, /location\.assign\(result\.route\)/);
  assert.doesNotMatch(script, /localStorage|\/api\/igor\/turn/);
  assert.match(await readFile(path.join(appDirectory, 'public', 'projects.js'), 'utf8'), /application\.kind === 'studio' && application\.state === 'active'/);
  assert.match(home, /data-projects="continue"/); assert.match(home, /data-projects="recent" data-limit="5"/);
  await assertReferences(home, base);
  assert.match(await (await fetch(`${base}/graph/`)).text(), /not built yet/);
  assert.match(await (await fetch(`${base}/activity/`)).text(), /activity history is not built yet/);
  const deferred = await (await fetch(`${base}/eostre/`)).text();
  assert.match(deferred, /<html lang="en" data-stex-app="eostre">/);
  assert.match(deferred, /<h1 class="page-title">Ēostre<\/h1>/);
  assert.match(deferred, /Visual work and print production/);
  assert.doesNotMatch(deferred, /undefined/);
});

test('declares exactly the encoded codec string for every video source', async () => {
  const manifest = JSON.parse(await readFile(path.resolve(appDirectory, '..', '..', 'assets', 'manifest.json'), 'utf8'));
  const recorded = new Map(manifest.assets.flatMap((asset) => asset.derivatives || []).filter((entry) => entry.codecs).map((entry) => [entry.path, entry.codecs]));
  const { homePage } = await import('../src/pages.mjs');
  const pages = [await readFile(path.join(appDirectory, 'public', 'index.html'), 'utf8'), homePage([])];
  let checked = 0;
  for (const html of pages) {
    for (const [, src, codec] of html.matchAll(/<source[^>]*src="([^"]+)"[^>]*codecs="([^"]+)"/g)) {
      assert.equal(codec, recorded.get(`apps/pantheon/public${src}`), src); checked += 1;
    }
  }
  assert.equal(checked, 12);
});

test('keeps studio and assistant text out of innerHTML', async () => {
  for (const file of ['projects.js', 'igor.js', 'motion.js']) assert.doesNotMatch(await readFile(path.join(appDirectory, 'public', file), 'utf8'), /innerHTML|insertAdjacentHTML|outerHTML/, file);
});

test('proxies Igor, publishes the v2 registry, and no longer relays turns itself', async (context) => {
  const seen = [];
  const igor = http.createServer(async (request, response) => {
    let raw = ''; for await (const part of request) raw += part;
    seen.push({ method: request.method, path: request.url, host: request.headers.host, forwardedHost: request.headers['x-forwarded-host'], body: raw });
    response.writeHead(request.method === 'POST' ? 201 : 200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ path: request.url, prefix: request.headers['x-forwarded-prefix'] }));
  });
  await new Promise((resolve) => igor.listen(4409, '127.0.0.1', resolve));
  context.after(() => igor.close());
  await startPantheon(await mkdtemp(path.join(os.tmpdir(), 'stex-books-')), 4410, context, { STEX_IGOR_URL: 'http://127.0.0.1:4409' });
  const base = 'http://127.0.0.1:4410';
  assert.deepEqual(await (await fetch(`${base}/igor/c/abc123def456`)).json(), { path: '/igor/c/abc123def456', prefix: '/igor' });
  const created = await fetch(`${base}/igor/api/conversations`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idempotencyKey: 'handoff-key', message: 'Hello' }) });
  assert.equal(created.status, 201); await created.arrayBuffer();
  assert.deepEqual(seen.at(-1), { method: 'POST', path: '/igor/api/conversations', host: '127.0.0.1:4409', forwardedHost: '127.0.0.1:4410', body: JSON.stringify({ idempotencyKey: 'handoff-key', message: 'Hello' }) });

  const registry = await (await fetch(`${base}/api/applications`)).json();
  assert.equal(registry.schemaVersion, 'stex.applications.registry.v2');
  assert.deepEqual(registry.applications.find((entry) => entry.id === 'igor'), { id: 'igor', name: 'Igor', kind: 'application', route: '/igor/', state: 'active', referenceKinds: ['conversation'] });
  // A DNS-rebound page reaches Pantheon with a foreign Host; nothing is proxied.
  const before = seen.length;
  const rebound = await new Promise((resolve, reject) => http.get({ host: '127.0.0.1', port: 4410, path: '/igor/api/conversations', headers: { host: 'attacker.test:4410' } }, (response) => { response.resume(); resolve(response.statusCode); }).once('error', reject));
  assert.equal(rebound, 403); assert.equal(seen.length, before);
  const retired = await fetch(`${base}/api/igor/turn`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: 'Hello' }) });
  assert.equal(retired.status, 404); await retired.arrayBuffer();
});

test('serves byte ranges, revalidation, and HEAD for media', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'stex-books-'));
  await startPantheon(root, 4403, context);
  const url = 'http://127.0.0.1:4403/media/splash/pantheon-splash-loop-960w.webm';
  const full = await fetch(url, { method: 'HEAD' });
  const size = Number(full.headers.get('content-length'));
  assert.equal(full.status, 200); assert.equal(full.headers.get('accept-ranges'), 'bytes'); assert.ok(size > 1000);
  assert.equal((await full.arrayBuffer()).byteLength, 0);
  const head = await fetch(url, { headers: { range: 'bytes=0-99' } });
  assert.equal(head.status, 206); assert.equal(head.headers.get('content-range'), `bytes 0-99/${size}`);
  assert.equal((await head.arrayBuffer()).byteLength, 100);
  const tail = await fetch(url, { headers: { range: 'bytes=-10' } });
  assert.equal(tail.status, 206); assert.equal(tail.headers.get('content-range'), `bytes ${size - 10}-${size - 1}/${size}`);
  assert.equal((await tail.arrayBuffer()).byteLength, 10);
  const open = await fetch(url, { headers: { range: `bytes=${size - 5}-` } });
  assert.equal(open.status, 206); assert.equal((await open.arrayBuffer()).byteLength, 5);
  const beyond = await fetch(url, { headers: { range: `bytes=${size}-` } });
  assert.equal(beyond.status, 416); assert.equal(beyond.headers.get('content-range'), `bytes */${size}`);
  const multiple = await fetch(url, { headers: { range: 'bytes=0-1,4-5' } });
  assert.equal(multiple.status, 200); await multiple.arrayBuffer();
  const reversed = await fetch(url, { headers: { range: 'bytes=5-3' } });
  assert.equal(reversed.status, 200); assert.equal((await reversed.arrayBuffer()).byteLength, size);
  // Aborting mid-stream must not take the server down.
  const aborted = new AbortController();
  const partial = await fetch(url, { signal: aborted.signal });
  aborted.abort(); await partial.body?.cancel().catch(() => {});
  assert.equal((await fetch(url, { method: 'HEAD' })).status, 200);
  const cached = await fetch(url, { headers: { 'if-none-match': full.headers.get('etag') } });
  assert.equal(cached.status, 304);
});

test('serves only the public folders of the shared design system', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'stex-books-'));
  await startPantheon(root, 4404, context);
  const css = await fetch('http://127.0.0.1:4404/design-system/src/stex.css');
  assert.equal(css.status, 200); assert.match(await css.text(), /@layer stex\.tokens, stex\.base, stex\.components;/);
  const specimen = await fetch('http://127.0.0.1:4404/design-system/specimen/');
  assert.equal(specimen.status, 200); assert.match(specimen.headers.get('content-type'), /text\/html/); await specimen.arrayBuffer();
  for (const blocked of ['/design-system/package.json', '/design-system/test/tokens.test.mjs', '/design-system/', '/design-system/brand/%2e%2e%2fpackage.json']) {
    const response = await fetch(`http://127.0.0.1:4404${blocked}`);
    assert.equal(response.status, 404, blocked); await response.arrayBuffer();
  }
});

test('discovers a manuscript graph without changing it', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'stex-books-'));
  const manuscript = path.join(root, 'existing-book', 'manuscript');
  await mkdir(manuscript, { recursive: true });
  await writeFile(path.join(root, 'existing-book', 'README.md'), '# Existing Book\n\nA preserved manuscript.\n');
  await writeFile(path.join(manuscript, 'Programme.md'), '# Programme\n');
  await writeFile(path.join(manuscript, 'Poem.md'), '# A poem\n');
  await startPantheon(root, 4397, context, await startFrige(root, 4497, context));
  const response = await fetch('http://127.0.0.1:4397/api/books');
  const [book] = await response.json();
  assert.equal(response.status, 200);
  assert.equal(book.title, 'Existing Book');
  assert.equal(book.state, 'manuscript-detected');
  assert.equal(book.manuscriptNodes, 2);
  assert.equal(await readFile(path.join(manuscript, 'Poem.md'), 'utf8'), '# A poem\n');
});

test('accepts an interview ticket and creates a structured project vault', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'stex-books-'));
  await startPantheon(root, 4398, context, await startFrige(root, 4498, context));
  const ticket = { title: 'Field Notes', author: 'A. Poet', editorialIntent: 'A book of observant lyric poems.', sourceMode: 'existing-markdown', bookType: 'poetry-collection', podProfile: 'cross-pod', trimSize: '6 × 9 in', interiorInk: 'black-white', paperStock: 'white', bleed: 'no-bleed', margins: '0.5 in', isbnPlan: 'own-isbn', proofPlan: 'order-proof', coverFinish: 'matte' };
  const response = await fetch('http://127.0.0.1:4398/api/books', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ticket, transcript: [{ role: 'assistant', message: 'What is the title?' }, { role: 'user', message: 'Field Notes' }] }) });
  assert.equal(response.status, 201);
  const book = await response.json();
  const denied = await fetch('http://127.0.0.1:4398/api/books', { method: 'POST', headers: { origin: 'null', 'content-type': 'text/plain' }, body: JSON.stringify({ ticket: { title: 'Forbidden preview write' } }) });
  assert.equal(denied.status, 403);
  const rootPath = path.join(root, book.id);
  const settings = JSON.parse(await readFile(path.join(rootPath, 'frige', 'settings.json'), 'utf8'));
  const markdown = await readFile(path.join(rootPath, 'frige', 'Global Settings Ticket.md'), 'utf8');
  assert.equal(settings.identity.title, 'Field Notes');
  assert.equal(settings.structure.programme, 'manuscript/Programme.md');
  assert.match(markdown, /# Global Settings Ticket/);
  assert.match(markdown, /\[\[\.\.\/manuscript\/Programme\|Programme\]\]/);
  assert.match(await readFile(path.join(rootPath, 'manuscript', 'Programme.md'), 'utf8'), /canonical reading sequence/);
  assert.equal((await readFile(path.join(rootPath, '.texgraph', 'interview.jsonl'), 'utf8')).split('\n').filter(Boolean).length, 2);
  const upload = await fetch(`http://127.0.0.1:4398/api/books/${book.id}/documents`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ documents: [{ name: 'context.md', mimeType: 'text/markdown', contentBase64: Buffer.from('# Context\n\nKeep this close.\n').toString('base64') }] }) });
  assert.equal(upload.status, 201);
  const [document] = await upload.json();
  assert.equal(document.contextState, 'pending-review');
  const review = await fetch(`http://127.0.0.1:4398/api/books/${book.id}/documents/${document.id}/review`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ approved: true }) });
  assert.equal((await review.json()).contextState, 'approved');
  const manifest = await fetch(`http://127.0.0.1:4398/api/books/${book.id}/documents`);
  assert.equal((await manifest.json()).length, 1);
  await assert.rejects(() => fetch(`http://127.0.0.1:4398/api/books/${book.id}/documents`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ documents: [{ name: '../../bad.md', contentBase64: 'eA==' }] }) }).then((result) => { if (!result.ok) throw new Error('Rejected unsafe filename.'); }), /Rejected unsafe filename/);
});

test('reviews a proposed change as a line diff that collapses distant unchanged lines', async () => {
  const { lineDiff } = await import('../workspaces/frige/line-diff.js');
  const before = ['# Poem', 'a', 'b', 'c', 'd', 'e', 'old line', 'f'].join('\n');
  const after = ['# Poem', 'a', 'b', 'c', 'd', 'e', 'new line', 'f', 'added'].join('\n');
  assert.deepEqual(lineDiff(before, after), [
    { type: 'skip', count: 4 }, { type: 'same', text: 'd' }, { type: 'same', text: 'e' },
    { type: 'del', text: 'old line' }, { type: 'add', text: 'new line' }, { type: 'same', text: 'f' }, { type: 'add', text: 'added' },
  ]);
  assert.deepEqual(lineDiff('same', 'same'), [{ type: 'skip', count: 1 }]);
});
