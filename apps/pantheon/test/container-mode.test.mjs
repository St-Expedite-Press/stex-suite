/**
 * Container-mode switches and the knowledge relay (separation milestone M1).
 *
 * Native defaults must be unchanged; STEX_BIND_ALL and STEX_INTERNAL_HOSTS are
 * explicit opt-ins; hosted mode refuses to bind every interface; the platform
 * knowledge path never opens a journal in Pantheon and forwards only what the
 * relay contract names. Synthetic servers only.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { bindAddress, internalHosts, localProxyTarget } from '../src/shell.mjs';
import { knowledgeRelay } from '../src/knowledge-relay.mjs';
import { personDirectoryName } from '../../../services/knowledge/src/library.mjs';

const appDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Starts Pantheon and resolves when it is ready, or with its exit code when it refuses to start. */
function startPantheon(port, environment) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['server.mjs'], { cwd: appDirectory, env: { ...process.env, STEX_PANTHEON_PORT: String(port), ...environment } });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; if (output.includes('Pantheon is ready')) resolve({ child, output }); });
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.on('exit', (code) => resolve({ child: null, code, output }));
  });
}

/** A free loopback port. */
async function freePort() {
  const server = http.createServer(); await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address(); await new Promise((resolve) => server.close(resolve)); return port;
}

test('container switches are explicit opt-ins and native defaults stay loopback', () => {
  assert.equal(bindAddress(undefined), '127.0.0.1');
  assert.equal(bindAddress(''), '127.0.0.1');
  assert.equal(bindAddress('1'), '0.0.0.0');
  assert.throws(() => bindAddress('yes'));
  assert.deepEqual([...internalHosts('')], []);
  assert.deepEqual([...internalHosts(' frige , platform ')], ['frige', 'platform']);
  for (const bad of ['frige.example.com', 'Frige', 'localhost', '-x', 'a/b']) assert.throws(() => internalHosts(bad), /invalid service name/);
  assert.equal(localProxyTarget(undefined, 'http://127.0.0.1:4310').host, '127.0.0.1:4310');
  assert.throws(() => localProxyTarget('http://frige:4310', 'http://127.0.0.1:4310'), /loopback/);
  assert.equal(localProxyTarget('http://frige:4310', 'http://127.0.0.1:4310', internalHosts('frige')).host, 'frige:4310');
  assert.throws(() => localProxyTarget('http://evil:4310', 'http://127.0.0.1:4310', internalHosts('frige')), /loopback/);
  assert.throws(() => localProxyTarget('https://frige:4310', 'http://127.0.0.1:4310', internalHosts('frige')), /loopback/);
  assert.throws(() => localProxyTarget('http://user:pw@frige:4310', 'http://127.0.0.1:4310', internalHosts('frige')), /loopback/);
});

test('hosted Pantheon in a container admits no loopback probe: only /healthz, the public host and a session', async () => {
  const port = await freePort();
  const hosted = await startPantheon(port, { STEX_BIND_ALL: '1', STEX_PANTHEON_PUBLIC_ORIGIN: 'https://pantheon.example.com', STEX_IGOR_URL: 'http://127.0.0.1:9' });
  assert.ok(hosted.child, hosted.output);
  try {
    const base = `http://127.0.0.1:${port}`;
    assert.deepEqual(await (await fetch(`${base}/healthz`)).json(), { status: 'ok' });
    // A peer claiming a loopback Host is not "this machine" in a container: refused or sent to sign in, never admitted.
    for (const route of ['/home/', '/api/knowledge/v1', '/frige/api/books', '/api/platform/v1/projects']) {
      const response = await fetch(`${base}${route}`, { redirect: 'manual' });
      assert.ok([303, 401, 403].includes(response.status), `${route} answered ${response.status}`);
    }
    // With the public host and no session: sign in first (Igor unreachable fails closed on protected routes).
    const page = await new Promise((resolve) => http.get({ hostname: '127.0.0.1', port, path: '/home/', headers: { host: 'pantheon.example.com' } }, (response) => { response.resume(); resolve(response.statusCode); }));
    assert.equal(page, 303);
  } finally { hosted.child.kill(); }
});

test('the platform knowledge path refuses a local journal directory', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'stex-relay-'));
  try {
    const both = await startPantheon(await freePort(), { STEX_KNOWLEDGE_SERVICE: 'platform', STEX_KNOWLEDGE_DATA_DIR: root });
    assert.equal(both.child, null); assert.match(both.output, /belongs to the platform API/);
    assert.deepEqual(await readdir(root), [], 'no journal was created');
    const unknown = await startPantheon(await freePort(), { STEX_KNOWLEDGE_SERVICE: 'elsewhere' });
    assert.equal(unknown.child, null); assert.match(unknown.output, /must be "platform" or unset/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('the platform knowledge path relays only the method, path, query, bounded JSON body and actor', async () => {
  const seen = [];
  const platform = http.createServer(async (request, response) => {
    let body = ''; for await (const chunk of request) body += chunk;
    seen.push({ method: request.method, url: request.url, headers: request.headers, body });
    if (request.url.startsWith('/api/knowledge/v1/html')) { response.writeHead(200, { 'content-type': 'text/html' }); response.end('<p>no</p>'); return; }
    response.writeHead(201, { 'content-type': 'application/json; charset=utf-8' }); response.end(JSON.stringify({ relayed: true }));
  });
  await new Promise((resolve) => platform.listen(0, '127.0.0.1', resolve));
  const port = await freePort();
  const started = await startPantheon(port, { STEX_KNOWLEDGE_SERVICE: 'platform', STEX_PLATFORM_URL: `http://127.0.0.1:${platform.address().port}` });
  assert.ok(started.child, started.output);
  try {
    const base = `http://127.0.0.1:${port}`;
    const reply = await fetch(`${base}/api/knowledge/v1/accept?x=1`, { method: 'POST', headers: { origin: base, 'content-type': 'application/json', cookie: 'stex_igor_session=secret; other=1', 'x-stex-actor': 'forged', 'x-stex-platform-token': 'forged', authorization: 'Bearer nope' }, body: '{"a":1}' });
    assert.equal(reply.status, 201); assert.deepEqual(await reply.json(), { relayed: true });
    const [forwarded] = seen;
    assert.equal(forwarded.method, 'POST'); assert.equal(forwarded.url, '/api/knowledge/v1/accept?x=1'); assert.equal(forwarded.body, '{"a":1}');
    for (const header of ['cookie', 'authorization', 'x-stex-actor', 'x-stex-platform-token', 'x-stex-actor-journal', 'origin']) assert.equal(forwarded.headers[header], undefined, header);
    const foreign = await fetch(`${base}/api/knowledge/v1/accept`, { method: 'POST', headers: { origin: 'http://attacker.example', 'content-type': 'application/json' }, body: '{}' });
    assert.equal(foreign.status, 403); assert.equal(seen.length, 1, 'a foreign origin never reaches the platform');
    const oversized = await fetch(`${base}/api/knowledge/v1/accept`, { method: 'POST', headers: { origin: base, 'content-type': 'application/json' }, body: 'x'.repeat(20_000) });
    assert.equal(oversized.status, 413);
    const html = await fetch(`${base}/api/knowledge/v1/html`);
    assert.equal(html.status, 503); assert.equal((await html.json()).code, 'KNOWLEDGE_UNAVAILABLE');
    const put = await fetch(`${base}/api/knowledge/v1`, { method: 'PUT', headers: { origin: base } });
    assert.equal(put.status, 405);
  } finally { started.child.kill(); platform.close(); }
});

test('hosted relays add the admitted actor and its journal digest, and an unreachable platform is unavailable', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url: String(url), init }); return new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } }); };
  const relay = knowledgeRelay({ target: new URL('http://platform:4340'), fetchImpl });
  /** A minimal request and response pair. */
  const exchange = () => {
    const request = Object.assign(Readable.from([]), { method: 'GET', headers: { host: '127.0.0.1:4300' } });
    const response = { status: 0, body: '', writeHead(status) { this.status = status; }, end(body) { this.body = String(body); } };
    return { request, response };
  };
  const actor = { 'x-stex-actor': 'sha256-' + 'a'.repeat(64), 'x-stex-actor-role': 'member', 'x-stex-platform-token': 't'.repeat(40) };
  const { request, response } = exchange();
  await relay(request, response, new URL('http://127.0.0.1:4300/api/knowledge/v1'), { user: { username: 'josé' }, actor });
  assert.equal(response.status, 200);
  assert.equal(calls[0].url, 'http://platform:4340/api/knowledge/v1');
  assert.equal(calls[0].init.headers['x-stex-actor-journal'], personDirectoryName('josé'));
  assert.equal(calls[0].init.headers['x-stex-actor'], actor['x-stex-actor']);
  assert.equal(calls[0].init.redirect, 'manual');
  assert.equal(calls[0].init.headers['x-stex-knowledge-hosted'], undefined, 'a local relay does not claim hosting');
  const hostedRelay = knowledgeRelay({ target: new URL('http://platform:4340'), hosted: true, fetchImpl });
  const third = exchange();
  await hostedRelay(third.request, third.response, new URL('http://127.0.0.1:4300/api/knowledge/v1'), { user: { username: 'alice' }, actor });
  assert.equal(calls.at(-1).init.headers['x-stex-knowledge-hosted'], '1');
  const down = knowledgeRelay({ target: new URL('http://platform:4340'), fetchImpl: async () => { throw new Error('refused'); } });
  const second = exchange();
  await down(second.request, second.response, new URL('http://127.0.0.1:4300/api/knowledge/v1'));
  assert.equal(second.response.status, 503); assert.equal(JSON.parse(second.response.body).code, 'KNOWLEDGE_UNAVAILABLE');
});
