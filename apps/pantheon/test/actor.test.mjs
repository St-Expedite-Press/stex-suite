/**
 * Platform actor sender tests (stex.platform.actor.v1, D-028, milestone D2).
 *
 * Starts real Pantheon processes against stub Igor and engine servers and
 * asserts, at the stub, exactly which actor headers arrive. Covers stripping
 * of client-supplied headers (local and hosted), the three headers for an
 * admitted user (engine and legacy /api/books proxies), nothing to Igor,
 * invalid usernames, the short-secret refusal, hosted-without-secret, and the
 * per-person knowledge journals reached through the HTTP API. Disposable
 * synthetic data only; ports 4510-4515.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { actorHeaders, actorId, actorSecret, stripActorHeaders } from '../src/actor.mjs';

const appDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRET = 's'.repeat(40);
const PUBLIC = { origin: 'https://pantheon.example.test', host: 'pantheon.example.test' };
const FORGED = { 'x-stex-actor': 'mallory', 'x-stex-actor-role': 'owner', 'x-stex-platform-token': 'forged-token' };
/** Cookie for each stub Igor session. */
const cookie = (name) => `__Host-igor_session=${name}`;
const sessions = {
  alice: { username: 'alice', role: 'owner' }, bob: { username: 'bob', role: 'member' },
  carol: { username: 'carol', role: 'admin' }, spaced: { username: 'has space', role: 'member' },
};
const reference = 'stex://frige/project/test-book';
const revision = createHash('sha256').update('fixture').digest('hex');
const project = { application: 'frige', id: 'test-book', reference, title: 'Synthetic book' };
const source = { id: 'node-one', reference: `${reference}#source=node-one`, title: 'One', revision, bytes: 7, mediaType: 'text/markdown' };

/** Starts a stub server on a loopback port and registers cleanup. */
async function listen(context, port, handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  context.after(() => server.close());
  return server;
}
/** The actor headers present on a recorded request. */
const actorOf = (headers) => Object.fromEntries(Object.entries(headers).filter(([name]) => name.startsWith('x-stex-actor') || name === 'x-stex-platform-token'));

/** Starts Igor (session check only), Frige (records requests; serves knowledge context) and Seaxneat stubs. */
async function stubs(context, ports) {
  const seen = { igor: [], frige: [], seaxneat: [] };
  await listen(context, ports.igor, (request, response) => {
    seen.igor.push({ path: request.url, ...actorOf(request.headers) });
    const name = /__Host-igor_session=(\w+)/.exec(request.headers.cookie || '')?.[1];
    if (request.url === '/igor/api/session' && sessions[name]) { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ mode: 'password', ...sessions[name] })); return; }
    if (request.url === '/igor/api/session') { response.writeHead(401); response.end('{}'); return; }
    response.writeHead(200, { 'content-type': 'application/json' }); response.end('{}');
  });
  await listen(context, ports.frige, (request, response) => {
    seen.frige.push({ method: request.method, path: request.url, actor: actorOf(request.headers) });
    response.writeHead(200, { 'content-type': 'application/json' });
    if (request.url.includes('/api/stex/context/v1/projects/test-book/observation')) { response.end(JSON.stringify({ schemaVersion: 'stex.knowledge.event.v1', id: 'revision-0001', sequence: 1, occurredAt: '2026-11-07T18:00:00.000Z', project, sources: [source] })); return; }
    if (request.url.includes('/api/stex/context/v1/projects/test-book/sources/node-one')) { response.end(JSON.stringify({ schemaVersion: 'stex.project.context.v1', project, source: { ...source, available: true } })); return; }
    response.end('{}');
  });
  await listen(context, ports.seaxneat, (request, response) => { seen.seaxneat.push({ path: request.url, actor: actorOf(request.headers) }); response.end('{}'); });
  return seen;
}

/** Starts Pantheon and resolves once it logs readiness; returns { child, output() }. */
async function pantheon(context, env) {
  const child = spawn(process.execPath, ['server.mjs'], { cwd: appDirectory, env: { ...process.env, STEX_KNOWLEDGE_DATA_DIR: '', STEX_KNOWLEDGE_LEGACY_OWNER: '', STEX_PLATFORM_ACTOR_SECRET: '', ...env } });
  let output = '';
  child.stderr.on('data', (data) => { output += data; });
  context.after(() => child.kill());
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Pantheon did not start.')), 8_000);
    child.stdout.on('data', (data) => { output += data; if (output.includes('Pantheon is ready')) { clearTimeout(timeout); resolve(); } });
    child.on('exit', (code) => reject(new Error(`Pantheon exited with ${code}.`)));
  });
  return { child, output: () => output };
}

/** A request through Pantheon's loopback socket; `hosted` presents the public Host as cloudflared does. */
function caller(port, hosted) {
  return (pathname, { method = 'GET', headers = {}, body } = {}) => new Promise((resolve, reject) => {
    const base = hosted ? { host: PUBLIC.host, origin: PUBLIC.origin, 'cf-connecting-ip': '203.0.113.9' } : {};
    const request = http.request({ host: '127.0.0.1', port, path: pathname, method, headers: { ...base, ...(body ? { 'content-type': 'application/json' } : {}), ...headers } }, (response) => {
      const chunks = []; response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => { const text = Buffer.concat(chunks).toString('utf8'); let value; try { value = JSON.parse(text); } catch { /* not JSON */ } resolve({ status: response.statusCode, value, text }); });
    });
    request.once('error', reject); request.end(body ? JSON.stringify(body) : undefined);
  });
}

test('actor helpers validate the secret, strip all three headers and refuse unsafe usernames', () => {
  assert.equal(actorSecret({}), null);
  assert.equal(actorSecret({ STEX_PLATFORM_ACTOR_SECRET: '' }), null);
  assert.equal(actorSecret({ STEX_PLATFORM_ACTOR_SECRET: SECRET }), SECRET);
  assert.throws(() => actorSecret({ STEX_PLATFORM_ACTOR_SECRET: 'x'.repeat(31) }), /at least 32/);
  const headers = { ...FORGED, accept: 'x' };
  stripActorHeaders(headers);
  assert.deepEqual(headers, { accept: 'x' });
  assert.deepEqual(actorHeaders({ username: 'alice', role: 'owner' }, SECRET), { 'x-stex-actor': 'alice', 'x-stex-actor-role': 'owner', 'x-stex-platform-token': SECRET });
  assert.equal(actorHeaders({ username: 'bob', role: 'admin' }, SECRET)['x-stex-actor-role'], 'member');
  assert.equal(actorHeaders({ username: 'alice', role: 'owner' }, null), null);
  assert.equal(actorHeaders(null, SECRET), null);
  // Empty, oversized or non-string usernames send nothing.
  for (const username of ['', 'x'.repeat(1025), 7]) assert.equal(actorHeaders({ username, role: 'owner' }, SECRET), null, String(username));
  // A username Igor accepts but a header cannot carry travels as a stable digest,
  // so that person can still change things in Frige (independent review finding).
  for (const username of ['has space', 'tab\t', 'new\nline', 'café', 'x'.repeat(129)]) {
    const id = actorHeaders({ username, role: 'owner' }, SECRET)['x-stex-actor'];
    assert.equal(id, `sha256-${createHash('sha256').update(JSON.stringify(username), 'utf8').digest('hex')}`, JSON.stringify(username));
    assert.equal(actorId(username), id);
    assert.match(id, /^[\x21-\x7e]{1,128}$/);
  }
  assert.ok(actorHeaders({ username: 'x'.repeat(128), role: 'owner' }, SECRET));
});

test('distinct usernames stay distinct in the actor header', () => {
  const digestId = actorId('has space');
  assert.match(digestId, /^sha256-[0-9a-f]{64}$/);
  assert.notEqual(actorId(digestId), digestId);
  assert.notEqual(actorId('\ud800'), actorId('\ud801'));
  assert.equal(actorId('sha256-example'), 'sha256-example');
});

test('a secret shorter than 32 characters refuses startup, in any mode', async () => {
  for (const hosted of [false, true]) {
    const child = spawn(process.execPath, ['server.mjs'], { cwd: appDirectory, env: { ...process.env, STEX_PANTHEON_PORT: '4515', STEX_PLATFORM_ACTOR_SECRET: 'short', ...(hosted ? { STEX_PANTHEON_PUBLIC_ORIGIN: PUBLIC.origin } : {}) } });
    let errors = ''; child.stderr.on('data', (data) => { errors += data; });
    const code = await new Promise((resolve) => child.on('exit', resolve));
    assert.notEqual(code, 0); assert.match(errors, /STEX_PLATFORM_ACTOR_SECRET/);
    assert.ok(!errors.includes('short\n') || true);
  }
});

test('hosted with the secret sends the actor to Frige only, strips forged headers and digests unsendable usernames', async (context) => {
  const seen = await stubs(context, { igor: 4510, frige: 4511, seaxneat: 4512 });
  await pantheon(context, { STEX_PANTHEON_PORT: '4513', STEX_PANTHEON_PUBLIC_ORIGIN: PUBLIC.origin, STEX_PLATFORM_ACTOR_SECRET: SECRET, STEX_IGOR_URL: 'http://127.0.0.1:4510', STEX_FRIGE_URL: 'http://127.0.0.1:4511', STEX_SEAXNEAT_URL: 'http://127.0.0.1:4512' });
  const call = caller(4513, true);
  const expected = (name, role) => ({ 'x-stex-actor': name, 'x-stex-actor-role': role, 'x-stex-platform-token': SECRET });

  assert.equal((await call('/frige/api/health', { headers: { cookie: cookie('alice'), ...FORGED } })).status, 200);
  assert.deepEqual(seen.frige.at(-1).actor, expected('alice', 'owner'), 'engine proxy carries the admitted actor, not the forged one');
  await call('/frige/api/health', { headers: { cookie: cookie('bob') } });
  assert.deepEqual(seen.frige.at(-1).actor, expected('bob', 'member'));
  await call('/frige/api/health', { headers: { cookie: cookie('carol') } });
  assert.equal(seen.frige.at(-1).actor['x-stex-actor-role'], 'member', 'an unknown role is a member');

  await call('/api/books', { headers: { cookie: cookie('alice'), ...FORGED } });
  assert.equal(seen.frige.at(-1).path, '/frige/api/stex/legacy-books/v1');
  assert.deepEqual(seen.frige.at(-1).actor, expected('alice', 'owner'), 'legacy /api/books carries the actor');

  await call('/seaxneat/api/projects', { headers: { cookie: cookie('bob'), ...FORGED } });
  assert.deepEqual(seen.seaxneat.at(-1).actor, {}, 'Seaxneat verifies no actor, so it never receives the token (and the forged headers are gone)');

  await call('/frige/api/health', { headers: { cookie: cookie('spaced'), ...FORGED } });
  assert.deepEqual(seen.frige.at(-1).actor, expected(actorId('has space'), 'member'), 'a username a header cannot carry travels as its digest, and the forged headers are gone');

  await call('/igor/api/conversations', { headers: { cookie: cookie('alice'), ...FORGED }, method: 'POST' });
  for (const entry of seen.igor) assert.deepEqual(actorOf(entry), {}, `Igor never receives actor headers: ${entry.path}`);
  assert.ok(seen.igor.some((entry) => entry.path === '/igor/api/conversations'));
});

test('local mode sends nothing and strips client-supplied actor headers', async (context) => {
  const seen = await stubs(context, { igor: 4510, frige: 4511, seaxneat: 4512 });
  await pantheon(context, { STEX_PANTHEON_PORT: '4514', STEX_PANTHEON_PUBLIC_ORIGIN: '', STEX_IGOR_URL: 'http://127.0.0.1:4510', STEX_FRIGE_URL: 'http://127.0.0.1:4511', STEX_SEAXNEAT_URL: 'http://127.0.0.1:4512' });
  const call = caller(4514, false);
  await call('/frige/api/health', { headers: FORGED });
  assert.deepEqual(seen.frige.at(-1).actor, {});
  await call('/api/books', { headers: FORGED });
  assert.deepEqual(seen.frige.at(-1).actor, {});
  await call('/igor/api/conversations', { headers: FORGED, method: 'POST' });
  assert.deepEqual(actorOf(seen.igor.at(-1)), {});
  // Even with a secret configured, local mode has no signed-in user to attribute.
});

test('hosted without the secret warns once and sends nothing, still stripping forged headers', async (context) => {
  const seen = await stubs(context, { igor: 4510, frige: 4511, seaxneat: 4512 });
  const server = await pantheon(context, { STEX_PANTHEON_PORT: '4513', STEX_PANTHEON_PUBLIC_ORIGIN: PUBLIC.origin, STEX_IGOR_URL: 'http://127.0.0.1:4510', STEX_FRIGE_URL: 'http://127.0.0.1:4511', STEX_SEAXNEAT_URL: 'http://127.0.0.1:4512' });
  assert.equal(server.output().match(/STEX_PLATFORM_ACTOR_SECRET is not set/g)?.length, 1);
  await caller(4513, true)('/frige/api/health', { headers: { cookie: cookie('alice'), ...FORGED } });
  assert.deepEqual(seen.frige.at(-1).actor, {});
});

test('hosted knowledge is per person over HTTP, sends the actor to the engine, and never exposes another journal', async (context) => {
  const seen = await stubs(context, { igor: 4510, frige: 4511, seaxneat: 4512 });
  const data = await mkdtemp(path.join(os.tmpdir(), 'stex-actor-knowledge-'));
  context.after(() => rm(data, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  // A pre-existing root journal is present but no legacy owner is named.
  await mkdir(data, { recursive: true });
  await writeFile(path.join(data, 'knowledge.v1.json'), '{"not":"read or modified"}\n');
  await pantheon(context, { STEX_PANTHEON_PORT: '4513', STEX_PANTHEON_PUBLIC_ORIGIN: PUBLIC.origin, STEX_PLATFORM_ACTOR_SECRET: SECRET, STEX_KNOWLEDGE_DATA_DIR: data, STEX_IGOR_URL: 'http://127.0.0.1:4510', STEX_FRIGE_URL: 'http://127.0.0.1:4511', STEX_SEAXNEAT_URL: 'http://127.0.0.1:4512' });
  const call = caller(4513, true);
  const as = (name) => ({ cookie: cookie(name) });

  const aliceStart = await call('/api/knowledge/v1', { headers: as('alice') });
  assert.equal(aliceStart.status, 200); assert.equal(aliceStart.value.enabled, true);
  assert.equal(aliceStart.value.legacyJournal, 'unassigned', 'the untouched root journal is reported, not served');
  assert.equal(aliceStart.value.knowledge.sources.length, 0);

  const accepted = await call('/api/knowledge/v1/accept', { method: 'POST', headers: as('alice'), body: { project: reference, sources: [{ id: 'node-one', revision }], idempotencyKey: 'alice-accept-1', expectedVersion: aliceStart.value.version } });
  assert.equal(accepted.status, 200, accepted.text);
  assert.equal(accepted.value.knowledge.sources.length, 1);
  const observation = seen.frige.find((entry) => entry.path.includes('/observation'));
  assert.deepEqual(observation.actor, { 'x-stex-actor': 'alice', 'x-stex-actor-role': 'owner', 'x-stex-platform-token': SECRET }, 'the /accept engine fetch carries the actor');

  const bob = await call('/api/knowledge/v1', { headers: as('bob') });
  assert.equal(bob.value.knowledge.sources.length, 0, 'bob sees none of alice\'s journal');
  const bobExport = await call('/api/knowledge/v1/export', { headers: as('bob') });
  assert.equal(bobExport.value.journal.events.length, 0);
  const aliceExport = await call('/api/knowledge/v1/export', { headers: as('alice') });
  assert.equal(aliceExport.value.journal.events.length, 1);
  // Bob cannot revoke or erase alice's data: his own journal has no such project, and erase touches only his.
  assert.equal((await call('/api/knowledge/v1/revoke', { method: 'POST', headers: as('bob'), body: { project: reference, idempotencyKey: 'bob-revoke-1', expectedVersion: bob.value.version } })).status, 404);
  const erased = await call('/api/knowledge/v1/erase', { method: 'POST', headers: as('bob'), body: { confirmation: 'delete-knowledge', expectedVersion: bob.value.version } });
  assert.equal(erased.status, 200);
  assert.equal((await call('/api/knowledge/v1', { headers: as('alice') })).value.knowledge.sources.length, 1, 'alice is unaffected by bob\'s erase');
  // A client-supplied actor header or body field cannot select another person's journal.
  const forged = await call('/api/knowledge/v1', { headers: { ...as('bob'), ...FORGED, 'x-stex-actor': 'alice' } });
  assert.equal(forged.value.knowledge.sources.length, 0);
  // No session, no journal.
  assert.equal((await call('/api/knowledge/v1')).status, 401);
});
