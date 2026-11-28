/**
 * Verifies hosted-style sign-in through the staging Compose stack (compose.yaml + compose.hosted.yaml).
 *
 * Real Igor password sign-in, real session checks by Pantheon, a TLS edge standing in for the
 * Cloudflare Tunnel (https://pantheon.stex.test:8443 on the host's loopback only), the platform
 * and Frige verifying the actor. Fixture accounts and secrets are generated per run in a
 * temporary directory outside the repository and never printed.
 *
 *   node scripts/verify/verify-staging-hosted.mjs [--keep]
 *
 * Synthetic data only. Prints a JSON report; exits non-zero on the first failure.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { hashPassword } = await import(pathToFileURL(path.join(root, 'stex-igor', 'apps', 'igor', 'server', 'auth.mjs')).href);
const dir = path.join(root, 'deploy', 'staging-compose');
const HOST = 'pantheon.stex.test'; const PORT = 8443; const ORIGIN = `https://${HOST}:${PORT}`;
const report = { checks: [], limits: ['synthetic accounts and data; local Docker; Caddy local CA instead of Cloudflare; no model calls'] };
const pass = (name) => report.checks.push(name);

// Fixtures: two accounts and fresh secrets, outside the repository.
const fixtures = await mkdtemp(path.join(os.tmpdir(), 'stex-staging-hosted-'));
const secret = () => randomBytes(32).toString('hex');
const accounts = { alice: { password: secret(), role: 'owner' }, bob: { password: secret(), role: 'member' } };
await writeFile(path.join(fixtures, 'igor-users.json'), JSON.stringify({ users: await Promise.all(Object.entries(accounts).map(async ([username, { password, role }]) => ({ username, role, passwordHash: await hashPassword(password) }))) }));
const envFile = path.join(fixtures, 'staging.env');
await writeFile(envFile, [`STEX_STAGING_FIXTURES=${fixtures.replaceAll('\\', '/')}`, `STEX_STAGING_IGOR_SESSION_SECRET=${secret()}`, `STEX_STAGING_ACTOR_SECRET=${secret()}`, `STEX_STAGING_KNOWLEDGE_IGOR_SECRET=${secret()}`].join('\n'));
const compose = (...args) => execFileSync('docker', ['compose', '-f', path.join(dir, 'compose.yaml'), '-f', path.join(dir, 'compose.hosted.yaml'), '--env-file', envFile, ...args], { encoding: 'utf8', env: { ...process.env, MSYS_NO_PATHCONV: '1' }, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const startedAt = (service) => execFileSync('docker', ['inspect', '--format', '{{.State.StartedAt}}', compose('ps', '-q', service)], { encoding: 'utf8' }).trim();

compose('up', '-d', '--build', '--wait');
const ca = compose('exec', '-T', 'edge', 'cat', '/data/caddy/pki/authorities/local/root.crt');

/** One HTTPS request through the edge, as a browser at ORIGIN would send it. */
function call(route, { method = 'GET', cookie, body, origin = ORIGIN, host = `${HOST}:${PORT}` } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const headers = { host, accept: 'application/json', ...(origin && method !== 'GET' ? { origin } : {}), ...(cookie ? { cookie } : {}), ...(payload ? { 'content-type': 'application/json', 'content-length': payload.length } : {}) };
    const request = https.request({ hostname: '127.0.0.1', port: PORT, servername: HOST, ca, method, path: route, headers }, (response) => {
      const chunks = []; response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => { const text = Buffer.concat(chunks).toString('utf8'); let value; try { value = JSON.parse(text); } catch { value = text; } resolve({ status: response.statusCode, headers: response.headers, value }); });
    });
    request.on('error', reject); if (payload) request.write(payload); request.end();
  });
}
/** Signs in and returns the session cookie pair. */
async function signIn(username) {
  const response = await call('/igor/api/session', { method: 'POST', body: { username, password: accounts[username].password } });
  assert.equal(response.status, 200, JSON.stringify(response.value));
  const cookie = [response.headers['set-cookie']].flat().find((value) => value.startsWith('__Host-igor_session='));
  assert.match(cookie, /Secure/); assert.match(cookie, /HttpOnly/);
  return cookie.split(';')[0];
}
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

try {
  // Only the edge is published; engines and Pantheon are private.
  const published = compose('ps', '--format', '{{.Service}} {{.Publishers}}');
  for (const port of [4300, 4310, 4330, 4340]) await assert.rejects(fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(2000) }), `port ${port} is not published`);
  pass('only the TLS edge is published (127.0.0.1:8443); Pantheon, Frige, Igor and the platform ports are private');
  report.published = published.split('\n').filter((line) => /127\.0\.0\.1/.test(line));

  // Signed out: sign-in page only; everything else refused or redirected.
  assert.equal((await call('/igor/login')).status, 200);
  const home = await call('/home/'); assert.equal(home.status, 303); assert.match(home.headers.location, /^\/igor\/login/);
  for (const route of ['/api/knowledge/v1', '/frige/api/books', '/igor/api/conversations', '/api/platform/v1/projects']) assert.equal((await call(route)).status, 401, route);
  pass('signed out: only the sign-in page; pages redirect to sign-in; APIs answer 401');

  // Refusals: foreign origin, wrong password, wrong Host.
  assert.equal((await call('/igor/api/session', { method: 'POST', origin: 'https://attacker.example', body: { username: 'alice', password: accounts.alice.password } })).status, 403);
  assert.equal((await call('/igor/api/session', { method: 'POST', body: { username: 'alice', password: 'wrong-password' } })).status, 401);
  assert.equal((await call('/home/', { host: `other.stex.test:${PORT}` })).status, 421, 'the edge refuses any other Host');
  pass('foreign-origin sign-in refused (403); wrong password refused (401); a Host other than the published one is refused');

  // Sign in two accounts.
  const alice = await signIn('alice'); const bob = await signIn('bob');
  for (const route of ['/home/', '/frige/', '/api/knowledge/v1', '/frige/api/books', '/igor/api/conversations']) assert.equal((await call(route, { cookie: alice })).status, 200, route);
  const session = await call('/igor/api/session', { cookie: alice }); assert.equal(session.value.username, 'alice'); assert.equal(session.value.mode, 'password');
  pass('signed in (real Igor password session, Secure HttpOnly cookie): command centre, Frige, knowledge, Igor API');

  // Protected route with a foreign origin, even signed in.
  assert.equal((await call('/api/knowledge/v1/accept', { method: 'POST', cookie: alice, origin: 'https://attacker.example', body: {} })).status, 403);
  pass('a signed-in request from a foreign origin is refused (403)');

  // Cross-account isolation: Igor conversations and knowledge journals.
  const created = await call('/igor/api/conversations', { method: 'POST', cookie: alice, body: { idempotencyKey: `alice-${Date.now()}` } });
  assert.ok([200, 201].includes(created.status), JSON.stringify(created.value));
  const id = created.value.conversation.id;
  assert.equal((await call(`/igor/api/conversations/${id}`, { cookie: bob })).status, 404, 'bob cannot open alice\'s conversation');
  assert.ok(!JSON.stringify((await call('/igor/api/conversations', { cookie: bob })).value).includes(id));
  const book = 'stex://frige/project/staging-fixture';
  const catalog = (await call(`/api/knowledge/v1/sources?project=${encodeURIComponent(book)}`, { cookie: alice })).value;
  const view = (await call('/api/knowledge/v1', { cookie: alice })).value;
  const source = catalog.sources.find((entry) => entry.available);
  const accepted = await call('/api/knowledge/v1/accept', { method: 'POST', cookie: alice, body: { idempotencyKey: `alice-accept-${Date.now()}`, expectedVersion: view.version, project: book, sources: [{ id: source.id, revision: source.revision }] } });
  assert.ok([200, 409].includes(accepted.status), JSON.stringify(accepted.value));
  assert.ok((await call('/api/knowledge/v1', { cookie: alice })).value.knowledge.sources.length >= 1);
  assert.equal((await call('/api/knowledge/v1', { cookie: bob })).value.knowledge.sources.length, 0, 'bob\'s journal is his own');
  pass('cross-account isolation: bob cannot see or open alice\'s conversation; knowledge journals are per person');

  // Refresh: after Pantheon's five-second session cache, the session is checked again and still valid.
  await wait(6000);
  assert.equal((await call('/home/', { cookie: alice })).status, 200);
  pass('refresh after the session-cache window: still signed in (Igor re-confirms the session)');

  // Through-Pantheon Frige proof as alice, then recreate Frige without restarting Pantheon or Igor.
  const build = await call('/frige/api/project/build?book=staging-fixture', { method: 'POST', cookie: alice, body: { scopeId: 'book', mode: 'prefix' } });
  assert.equal(build.status, 200, JSON.stringify(build.value).slice(0, 300));
  const proof = await call('/frige/api/project/preview?book=staging-fixture', { cookie: alice });
  assert.equal(proof.status, 200); assert.ok(String(proof.value).startsWith('%PDF-'));
  const pantheonStarted = startedAt('pantheon'); const igorStarted = startedAt('igor'); const frigeStarted = startedAt('frige');
  compose('up', '-d', '--force-recreate', '--no-deps', '--wait', 'frige');
  assert.notEqual(startedAt('frige'), frigeStarted); assert.equal(startedAt('pantheon'), pantheonStarted); assert.equal(startedAt('igor'), igorStarted);
  assert.ok(String((await call('/frige/api/project/preview?book=staging-fixture', { cookie: alice })).value).startsWith('%PDF-'));
  assert.equal((await call('/home/', { cookie: alice })).status, 200, 'still signed in after Frige was recreated');
  pass('signed-in Frige proof through Pantheon; Frige recreated with the proof intact, Pantheon and Igor not restarted, session kept');

  // Probe identity is separate: a peer claiming a loopback Host is not admitted; /healthz is all it gets.
  const peer = (route, host) => compose('exec', '-T', 'frige', 'node', '-e', `fetch('http://pantheon:4300${route}', { headers: { host: '${host}' }, redirect: 'manual' }).then((r) => console.log(r.status))`);
  assert.equal(peer('/healthz', '127.0.0.1:4300'), '200');
  for (const route of ['/home/', '/api/knowledge/v1', '/frige/api/books']) assert.ok(['303', '401', '403'].includes(peer(route, '127.0.0.1:4300')), `peer loopback ${route}`);
  assert.ok(['303', '401', '403'].includes(peer('/home/', `${HOST}:${PORT}`)), 'a peer using the public Host still needs a session');
  assert.equal(peer('/home/', `other.stex.test:${PORT}`), '403', 'Pantheon itself refuses any Host but the published one');
  pass('internal peers: loopback Host grants nothing (no probe exemption in containers); /healthz reveals liveness only');

  // Sign-out revokes: the old cookie stops working once the cache window passes.
  assert.equal((await call('/igor/api/session', { method: 'DELETE', cookie: alice, body: {} })).status, 204);
  await wait(6000);
  assert.equal((await call('/home/', { cookie: alice })).status, 303);
  assert.equal((await call('/api/knowledge/v1', { cookie: alice })).status, 401);
  assert.equal((await call('/home/', { cookie: bob })).status, 200, 'bob is unaffected');
  pass('sign-out revokes alice\'s session server-side (old cookie refused after the 5 s cache); bob unaffected');
  report.result = 'PASS';
} finally {
  if (!process.argv.includes('--keep')) compose('down', '-v');
}
console.log(JSON.stringify(report, null, 2));
