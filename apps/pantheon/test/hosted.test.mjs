/** Pantheon hosted-mode tests: Igor-session gate, public-host normalisation and cookie isolation. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createHostedGate, createIgorSessionCheck, hostedConfig, HostedRefusal, igorSessionCookie, isSignInRequest, withoutIgorSession } from '../src/hosted.mjs';

const appDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = { publicOrigin: 'https://pantheon.example.test', publicHost: 'pantheon.example.test' };
const good = '__Host-igor_session=valid.sig';

/** Starts a stub Igor whose session endpoint accepts only `good`; `mode` lets a test pretend to be local mode. */
async function stubIgor(port, seen, { mode = 'password' } = {}) {
  const server = http.createServer((request, response) => {
    seen.push({ method: request.method, path: request.url, host: request.headers.host, forwardedHost: request.headers['x-forwarded-host'], origin: request.headers.origin, cookie: request.headers.cookie });
    if (request.url === '/igor/api/session' && request.method === 'GET') {
      if (request.headers.cookie === good) { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ mode, username: 'owner@example.test', role: 'owner' })); return; }
      response.writeHead(401, { 'content-type': 'application/json' }); response.end('{"code":"UNAUTHORIZED"}'); return;
    }
    response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ igor: request.url }));
  });
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  return server;
}

test('hosted configuration is off by default and requires an https public origin', () => {
  assert.equal(hostedConfig({}), null);
  assert.deepEqual(hostedConfig({ STEX_PANTHEON_PUBLIC_ORIGIN: 'https://pantheon.example.test' }), config);
  assert.throws(() => hostedConfig({ STEX_PANTHEON_PUBLIC_ORIGIN: 'http://pantheon.example.test' }), /https origin/);
  assert.throws(() => hostedConfig({ STEX_PANTHEON_PUBLIC_ORIGIN: 'https://pantheon.example.test/base' }), /https origin/);
  assert.throws(() => hostedConfig({ STEX_PANTHEON_PUBLIC_ORIGIN: 'not a url' }), /valid URL/);
});

test('only signing in works without a session, and the session cookie is isolated', () => {
  for (const [pathname, method] of [['/igor/login', 'GET'], ['/igor/api/session', 'GET'], ['/igor/api/session', 'POST'], ['/igor/api/session', 'DELETE'], ['/igor/splash/motion.js', 'GET'],
    ['/igor/splash/splash.css', 'HEAD'], ['/igor/media/splash/a.webm', 'GET'], ['/igor/media/masthead/a.webm', 'GET'], ['/design-system/src/stex.css', 'GET'], ['/design-system/fonts/a.woff2', 'GET']]) {
    assert.equal(isSignInRequest(pathname, method), true, `${method} ${pathname}`);
  }
  for (const [pathname, method] of [['/igor/login', 'POST'], ['/igor/api/conversations', 'GET'], ['/igor/api/agent-config', 'GET'], ['/igor/assets/app.js', 'GET'], ['/igor/', 'GET'], ['/igor/team', 'GET'],
    ['/igor/splash/', 'GET'], ['/igor/splash/x.js', 'POST'], ['/design-system/', 'GET'], ['/home/', 'GET'], ['/', 'GET'], ['/frige/app.js', 'GET'], ['/igor/api/ready', 'GET']]) {
    assert.equal(isSignInRequest(pathname, method), false, `${method} ${pathname}`);
  }
  assert.equal(igorSessionCookie(`draft=1; ${good}; x=2`), good);
  assert.equal(igorSessionCookie('draft=1'), '');
  assert.equal(withoutIgorSession(`draft=1; ${good}`), 'draft=1');
  assert.equal(withoutIgorSession(good), undefined);
  assert.equal(withoutIgorSession(undefined), undefined);
});

test('the gate admits signed-in public requests, sends pages to sign-in and refuses everything else', async () => {
  const checkSession = async (cookie) => (igorSessionCookie(cookie) === good ? { username: 'owner@example.test', role: 'owner' } : null);
  const admit = createHostedGate(config, { port: 4300, checkSession });
  const request = { method: 'POST', url: '/frige/api/thing', headers: { host: 'pantheon.example.test', origin: 'https://pantheon.example.test', cookie: good } };
  assert.equal((await admit(request)).user.username, 'owner@example.test');
  assert.deepEqual(request.headers, { host: '127.0.0.1:4300', origin: 'http://127.0.0.1:4300', cookie: good });
  // Igor's own sign-in route and the design system's public files need no session.
  for (const url of ['/igor/login?next=%2Figor%2F', '/igor/api/session', '/design-system/fonts/a.woff2']) {
    const open = { method: 'GET', url, headers: { host: 'pantheon.example.test' } };
    assert.deepEqual(await admit(open), { user: null }, url);
    assert.equal(open.headers.host, '127.0.0.1:4300');
  }
  // A loopback caller with no proxy headers keeps local behaviour.
  assert.deepEqual(await admit({ method: 'GET', url: '/home/', headers: { host: '127.0.0.1:4300' } }), { user: null });
  /** Expects a refusal with this status (and redirect target). */
  const refused = (status, location) => (error) => error instanceof HostedRefusal && error.status === status && error.location === location;
  await assert.rejects(admit({ method: 'GET', url: '/home/', headers: { host: 'pantheon.example.test' } }), refused(303, '/igor/login?next=%2Figor%2F'));
  await assert.rejects(admit({ method: 'GET', url: '/igor/team', headers: { host: 'pantheon.example.test', cookie: '__Host-igor_session=forged.sig' } }), refused(303, '/igor/login?next=%2Figor%2F'));
  await assert.rejects(admit({ method: 'GET', url: '/api/books', headers: { host: 'pantheon.example.test' } }), refused(401));
  await assert.rejects(admit({ method: 'GET', url: '/frige/api/stex/projects', headers: { host: 'pantheon.example.test' } }), refused(401));
  await assert.rejects(admit({ method: 'POST', url: '/frige/', headers: { host: 'pantheon.example.test' } }), refused(401));
  await assert.rejects(admit({ method: 'GET', url: '/design-system/', headers: { host: 'pantheon.example.test' } }), refused(303, '/igor/login?next=%2Figor%2F'));
  await assert.rejects(admit({ method: 'GET', url: '/home/', headers: { host: 'attacker.test', cookie: good } }), refused(403));
  await assert.rejects(admit({ method: 'GET', url: '/home/', headers: { host: 'PANTHEON.example.test', cookie: good } }), refused(403));
  await assert.rejects(admit({ method: 'GET', url: '/home/', headers: { host: '127.0.0.1:4300', 'cf-connecting-ip': '203.0.113.9', cookie: good } }), refused(403));
  await assert.rejects(admit({ method: 'POST', url: '/igor/api/session', headers: { host: 'pantheon.example.test', origin: 'https://attacker.test' } }), refused(403));
  await assert.rejects(admit({ method: 'POST', url: '/igor/api/session', headers: { host: 'pantheon.example.test', 'sec-fetch-site': 'cross-site' } }), refused(403));
  // A literal dot path is resolved before the decision (here to /home/), the same way routing resolves it.
  await assert.rejects(admit({ method: 'GET', url: '/igor/login/../../home/', headers: { host: 'pantheon.example.test' } }), refused(303, '/igor/login?next=%2Figor%2F'));
  // The URL parser treats %2e%2e as a dot segment too, so this also resolves to /home/.
  await assert.rejects(admit({ method: 'GET', url: '/igor/login/%2e%2e/%2e%2e/home/', headers: { host: 'pantheon.example.test' } }), refused(303, '/igor/login?next=%2Figor%2F'));
  await assert.rejects(admit({ method: 'GET', url: '/igor/%E0%A4%A', headers: { host: 'pantheon.example.test' } }), refused(400));
  // Igor's own API and app files need a session too, not only Pantheon's pages.
  await assert.rejects(admit({ method: 'GET', url: '/igor/api/conversations', headers: { host: 'pantheon.example.test' } }), refused(401));
  await assert.rejects(admit({ method: 'POST', url: '/igor/api/agent-config', headers: { host: 'pantheon.example.test' } }), refused(401));
  await assert.rejects(admit({ method: 'GET', url: '/igor/assets/app.js', headers: { host: 'pantheon.example.test' } }), refused(303, '/igor/login?next=%2Figor%2F'));
});

test('if Igor is not in password mode, Igor paths fail closed instead of open', async () => {
  // createIgorSessionCheck answers 503 for any non-password Igor; the gate must pass that on for Igor's own paths.
  const checkSession = async (cookie) => { if (igorSessionCookie(cookie)) throw new HostedRefusal(503, 'Pantheon could not check your sign-in. Try again shortly.'); return null; };
  const admit = createHostedGate(config, { port: 4300, checkSession });
  const refused = (status) => (error) => error instanceof HostedRefusal && error.status === status;
  for (const url of ['/igor/api/conversations', '/igor/api/agent-config', '/igor/c/abc', '/igor/assets/app.js']) {
    await assert.rejects(admit({ method: 'GET', url, headers: { host: 'pantheon.example.test', cookie: good } }), refused(503), url);
    await assert.rejects(admit({ method: 'GET', url, headers: { host: 'pantheon.example.test' } }), (error) => error instanceof HostedRefusal && [303, 401].includes(error.status), url);
  }
});

test('the session check trusts only a password-mode answer from Igor and fails closed', async (context) => {
  const seen = [];
  const igor = await stubIgor(4491, seen);
  const local = await stubIgor(4492, [], { mode: 'local' });
  context.after(() => { igor.close(); local.close(); });
  let clock = 0;
  const check = createIgorSessionCheck(new URL('http://127.0.0.1:4491'), '127.0.0.1:4300', { now: () => clock });
  assert.deepEqual(await check(`a=1; ${good}`), { username: 'owner@example.test', role: 'owner' });
  assert.deepEqual(seen.at(-1), { method: 'GET', path: '/igor/api/session', host: '127.0.0.1:4491', forwardedHost: '127.0.0.1:4300', origin: undefined, cookie: good });
  const calls = seen.length;
  await check(good);
  assert.equal(seen.length, calls, 'cached within five seconds');
  clock += 6_000; await check(good);
  assert.equal(seen.length, calls + 1, 'rechecked after five seconds');
  assert.equal(await check('__Host-igor_session=forged.sig'), null);
  const asked = seen.length;
  assert.equal(await check('other=1'), null);
  assert.equal(seen.length, asked, 'no cookie, no request');
  const localCheck = createIgorSessionCheck(new URL('http://127.0.0.1:4492'), '127.0.0.1:4300');
  await assert.rejects(localCheck(good), (error) => error instanceof HostedRefusal && error.status === 503);
  const downCheck = createIgorSessionCheck(new URL('http://127.0.0.1:4499'), '127.0.0.1:4300');
  await assert.rejects(downCheck(good), (error) => error instanceof HostedRefusal && error.status === 503);
});

test('hosted Pantheon requires an Igor session, composes Igor, and keeps the session cookie away from engines', async (context) => {
  const igorSeen = []; const frigeSeen = [];
  const igor = await stubIgor(4493, igorSeen);
  const frige = http.createServer((request, response) => {
    frigeSeen.push({ host: request.headers.host, origin: request.headers.origin, cookie: request.headers.cookie });
    response.writeHead(200, { 'content-type': 'application/json' }); response.end('{"ok":true}');
  });
  await new Promise((resolve) => frige.listen(4494, '127.0.0.1', resolve));
  context.after(() => { igor.close(); frige.close(); });
  const root = await mkdtemp(path.join(os.tmpdir(), 'stex-hosted-'));
  const child = spawn(process.execPath, ['server.mjs'], { cwd: appDirectory, env: {
    ...process.env, STEX_PANTHEON_PORT: '4495', STEX_PANTHEON_PUBLIC_ORIGIN: config.publicOrigin,
    STEX_IGOR_URL: 'http://127.0.0.1:4493', STEX_FRIGE_URL: 'http://127.0.0.1:4494', STEX_FRIGE_BOOKS_DIR: root,
    STEX_SEAXNEAT_URL: 'http://127.0.0.1:4496', STEX_PANTHEON_DEFERRED: 'seaxneat',
  } });
  const seaxneatSeen = [];
  const seaxneat = http.createServer((request, response) => { seaxneatSeen.push(request.url); response.end('{}'); });
  await new Promise((resolve) => seaxneat.listen(4496, '127.0.0.1', resolve));
  context.after(() => seaxneat.close());
  context.after(async () => { child.kill(); await rm(root, { recursive: true, force: true }); });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Hosted Pantheon did not start.')), 5_000);
    child.stdout.on('data', (data) => { if (data.toString().includes('Igor sign-in required')) { clearTimeout(timeout); resolve(); } });
    child.on('exit', (code) => reject(new Error(`Hosted Pantheon exited with ${code}.`)));
  });
  /** Requests through the loopback socket while presenting the public Host, as cloudflared does. */
  const call = (pathname, headers = {}, method = 'GET') => new Promise((resolve, reject) => {
    const request = http.request({ host: '127.0.0.1', port: 4495, path: pathname, method, headers: { host: config.publicHost, 'cf-connecting-ip': '203.0.113.9', ...headers } }, (response) => {
      const chunks = []; response.on('data', (chunk) => chunks.push(chunk)); response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    request.once('error', reject); request.end();
  });
  const signIn = await call('/home/');
  assert.equal(signIn.status, 303); assert.equal(signIn.headers.location, '/igor/login?next=%2Figor%2F');
  assert.equal((await call('/', {})).status, 303, 'the public splash also requires sign-in when hosted');
  assert.equal((await call('/frige/api/health', {}, 'POST')).status, 401);
  assert.equal(frigeSeen.length, 0, 'nothing reached Frige without a session');
  // Igor's own sign-in route is proxied to Igor, which enforces it.
  const login = await call('/igor/login?next=%2Figor%2F');
  assert.equal(login.status, 200); assert.equal(JSON.parse(login.body).igor, '/igor/login?next=%2Figor%2F');
  const home = await call('/home/', { cookie: good });
  assert.equal(home.status, 200); assert.match(home.body, /<html/i);
  const composed = await call('/igor/team', { cookie: good });
  assert.equal(composed.status, 200); assert.match(composed.body, /data-stex-composed="true"/);
  await call('/igor/api/conversations', { cookie: `${good}; draft=1`, origin: config.publicOrigin }, 'POST');
  const forwarded = igorSeen.filter((entry) => entry.path === '/igor/api/conversations').at(-1);
  assert.deepEqual(forwarded, { method: 'POST', path: '/igor/api/conversations', host: '127.0.0.1:4493', forwardedHost: '127.0.0.1:4495', origin: 'http://127.0.0.1:4495', cookie: `${good}; draft=1` });
  const proxied = await call('/frige/api/health', { cookie: `${good}; draft=1`, origin: config.publicOrigin }, 'POST');
  assert.equal(proxied.status, 200);
  assert.deepEqual(frigeSeen.at(-1), { host: '127.0.0.1:4494', origin: 'http://127.0.0.1:4495', cookie: 'draft=1' });
  assert.equal((await call('/frige/api/health', { cookie: good, origin: 'https://attacker.test' }, 'POST')).status, 403);
  assert.equal((await call('/home/', { host: 'attacker.test', cookie: good })).status, 403);
  // A host-deferred studio renders the honest deferred page and is never proxied.
  for (const pathname of ['/seaxneat/api/stex/projects', '/workspaces/seaxneat/', '/workspace-assets/seaxneat.js']) {
    const deferred = await call(pathname, { cookie: good });
    assert.equal(deferred.status, 200, pathname); assert.match(deferred.body, /registered in the STEX alpha/, pathname);
  }
  assert.equal(seaxneatSeen.length, 0);
  const registry = JSON.parse((await call('/api/applications', { cookie: good })).body);
  assert.equal(registry.applications.find((entry) => entry.id === 'seaxneat').state, 'deferred');
  // Loopback callers (the installer's health check) keep local behaviour.
  assert.equal((await fetch('http://127.0.0.1:4495/home/')).status, 200);
});

test('an unknown or required application cannot be deferred', async () => {
  for (const value of ['nonsense', 'igor']) {
    const child = spawn(process.execPath, ['server.mjs'], { cwd: appDirectory, env: { ...process.env, STEX_PANTHEON_PORT: '4497', STEX_PANTHEON_DEFERRED: value } });
    let errors = ''; child.stderr.on('data', (data) => { errors += data; });
    const code = await new Promise((resolve) => child.on('exit', resolve));
    assert.notEqual(code, 0, value); assert.match(errors, /STEX_PANTHEON_DEFERRED/, value);
  }
});
