/**
 * Frige platform-actor tests (`stex.platform.actor.v1`, D-028): the resolution
 * table, and the refusal of state-changing requests without a verified actor.
 *
 * Every test uses synthetic books in temporary directories and the fake
 * inference transport. No test reads a real manuscript.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { LOCAL_ACTOR, actorRefused, resolveActor } from '../src/actor.mjs';

const appDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRET = 'a-shared-secret-of-at-least-32-characters';
const env = { STEX_PLATFORM_ACTOR_SECRET: SECRET };
/** Headers Pantheon would send for a signed-in person. */
const headersFor = (overrides = {}) => ({ 'x-stex-actor': 'ada', 'x-stex-actor-role': 'member', 'x-stex-platform-token': SECRET, ...overrides });

test('the actor resolution table: local mode, verified actor, and every refusal', () => {
  // No secret: actor headers are ignored entirely, even a well-formed set.
  assert.deepEqual(resolveActor(headersFor(), {}), LOCAL_ACTOR);
  assert.deepEqual(resolveActor({}, { STEX_PLATFORM_ACTOR_SECRET: '' }), { id: 'local', role: 'owner', verified: false });
  assert.deepEqual(resolveActor(headersFor({ 'x-stex-actor': 'mallory', 'x-stex-actor-role': 'owner' }), {}), LOCAL_ACTOR, 'a forged actor header changes nothing in local mode');

  // Secret set: only a matching token with a valid username and role verifies.
  assert.deepEqual(resolveActor(headersFor(), env), { id: 'ada', role: 'member', verified: true });
  assert.deepEqual(resolveActor(headersFor({ 'x-stex-actor-role': 'owner' }), env), { id: 'ada', role: 'owner', verified: true });
  assert.deepEqual(resolveActor(headersFor({ 'x-stex-actor': 'x'.repeat(128) }), env), { id: 'x'.repeat(128), role: 'member', verified: true });
  const refused = {
    'no headers': {},
    'wrong token': headersFor({ 'x-stex-platform-token': `${SECRET}x` }),
    'same-length wrong token': headersFor({ 'x-stex-platform-token': SECRET.replace(/.$/, 'X') }),
    'short token': headersFor({ 'x-stex-platform-token': SECRET.slice(0, 10) }),
    'missing token': headersFor({ 'x-stex-platform-token': undefined }),
    'missing actor': headersFor({ 'x-stex-actor': undefined }),
    'empty actor': headersFor({ 'x-stex-actor': '' }),
    'actor with a space': headersFor({ 'x-stex-actor': 'ada lovelace' }),
    'actor with a control character': headersFor({ 'x-stex-actor': 'ada\u0007' }),
    'non-ASCII actor': headersFor({ 'x-stex-actor': 'adé' }),
    'actor over 128 characters': headersFor({ 'x-stex-actor': 'x'.repeat(129) }),
    'unknown role': headersFor({ 'x-stex-actor-role': 'admin' }),
    'missing role': headersFor({ 'x-stex-actor-role': undefined }),
    'repeated header': headersFor({ 'x-stex-actor': ['ada', 'bob'] }),
  };
  for (const [label, headers] of Object.entries(refused)) assert.equal(resolveActor(headers, env), null, label);

  // A secret shorter than the contract's 32 characters fails closed: nothing can verify.
  const weak = { STEX_PLATFORM_ACTOR_SECRET: 'short' };
  assert.equal(resolveActor(headersFor({ 'x-stex-platform-token': 'short' }), weak), null);
});

test('only state-changing methods need an actor, and only when the secret is set', () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    assert.equal(actorRefused(method, null, env), true, method);
    assert.equal(actorRefused(method, { id: 'ada', role: 'member', verified: true }, env), false, `${method} with an actor`);
    assert.equal(actorRefused(method, null, {}), false, `${method} in local mode`);
  }
  for (const method of ['GET', 'HEAD', 'OPTIONS']) assert.equal(actorRefused(method, null, env), false, method);
});

/**
 * Starts Frige with disposable state, optionally with the actor secret.
 *
 * @param {import('node:test').TestContext} context
 * @param {number} port
 * @param {Record<string, string>} extra
 * @returns {Promise<string>}  The mounted base URL.
 */
async function startFrige(context, port, extra) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'stex-frige-actor-'));
  const child = spawn(process.execPath, ['server.mjs'], { cwd: appDirectory, env: {
    ...process.env, STEX_FRIGE_PORT: String(port), STEX_FRIGE_PROJECT_DIR: root, STEX_FRIGE_BOOKS_DIR: path.join(root, 'books'), STEX_FRIGE_BASE_PATH: '/frige',
    STEX_FRIGE_SHELL_URL: '/', STEX_FRIGE_INFERENCE_MODE: 'fake', STEX_PLATFORM_ACTOR_SECRET: '', ...extra,
  } });
  context.after(async () => { const exited = new Promise((resolve) => child.once('exit', resolve)); child.kill(); await exited; await rm(root, { recursive: true, force: true }); });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Frige server did not start.')), 5_000);
    child.stdout.on('data', (data) => { if (data.toString().includes('ready')) { clearTimeout(timeout); resolve(); } });
    child.on('error', reject);
  });
  return `http://127.0.0.1:${port}/frige`;
}

test('with the secret set, every state-changing Frige route refuses a request without a verified actor', async (context) => {
  const base = await startFrige(context, 4461, env);
  const json = { 'content-type': 'application/json' };
  const create = (headers) => fetch(`${base}/api/stex/publishing/v1/books`, { method: 'POST', headers: { ...json, ...headers }, body: JSON.stringify({ title: 'Actor Fixture', author: 'A. Author' }) });

  // Refused without any actor, with a wrong token, and with forged actor headers alone.
  for (const headers of [{}, headersFor({ 'x-stex-platform-token': 'f'.repeat(40) }), { 'x-stex-actor': 'ada', 'x-stex-actor-role': 'owner' }]) {
    const refusal = await create(headers);
    assert.equal(refusal.status, 401); assert.equal((await refusal.json()).code, 'ACTOR_REQUIRED');
  }
  // Every method and mount that changes state is covered: publishing v1, the legacy API, legacy-books and the unlock route.
  for (const [method, route] of [
    ['PUT', '/api/stex/publishing/v1/project/design?book=none'], ['PATCH', '/api/stex/publishing/v1/scopes/book/conversations/main?book=none'],
    ['DELETE', '/api/books'], ['POST', '/api/books'], ['POST', '/api/stex/legacy-books/v1'], ['POST', '/api/stex/access/v1/unlock'],
    ['POST', '/api/project/refresh?book=none'],
  ]) {
    const refusal = await fetch(`${base}${route}`, { method, headers: json, body: '{}' });
    assert.equal(refusal.status, 401, `${method} ${route}`); assert.equal((await refusal.json()).code, 'ACTOR_REQUIRED', `${method} ${route}`);
  }
  // The knowledge observation checkpoint has no exemption: Pantheon forwards the actor on it (D-028), so a bare call is refused.
  const observation = await fetch(`${base}/api/stex/context/v1/projects/none/observation`, { method: 'POST', headers: json, body: '{"sources":[]}' });
  assert.equal(observation.status, 401); assert.equal((await observation.json()).code, 'ACTOR_REQUIRED');

  // Reads keep today's behaviour without an actor.
  assert.equal((await fetch(`${base}/api/stex/publishing/v1/books`)).status, 200);
  assert.equal((await fetch(`${base}/api/stex/projects`)).status, 200);
  assert.equal((await fetch(`${base}/api/health`)).status, 200);

  // A verified actor is admitted.
  const created = await create(headersFor());
  assert.equal(created.status, 201);
});

test('without the secret, actor headers are ignored and state-changing requests work as `local`', async (context) => {
  const base = await startFrige(context, 4462, {});
  const json = { 'content-type': 'application/json' };
  for (const headers of [{}, headersFor(), headersFor({ 'x-stex-platform-token': 'wrong' })]) {
    const created = await fetch(`${base}/api/stex/publishing/v1/books`, { method: 'POST', headers: { ...json, ...headers }, body: JSON.stringify({ title: 'Local Fixture', author: 'A. Author' }) });
    assert.equal(created.status, 201);
  }
});
