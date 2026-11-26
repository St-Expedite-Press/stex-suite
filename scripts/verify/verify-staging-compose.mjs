/**
 * Verifies the local staging Compose slice (deploy/staging-compose) end to end.
 *
 * Purpose: prove that Pantheon, Frige and the platform API run as separate
 * containers behind one loopback port, that the existing Pantheon routes and
 * UI documents are served through them, that a real LuaLaTeX proof is built,
 * that Frige can be recreated without losing data or restarting Pantheon, and
 * that knowledge now goes through the platform API (Pantheon opens no journal).
 *
 * Requires the stack to be running (`docker compose -f deploy/staging-compose/compose.yaml up -d --build`).
 * Uses only the synthetic seeded book. Prints a JSON report; exits non-zero on the first failure.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const composeFile = path.join(root, 'deploy', 'staging-compose', 'compose.yaml');
const base = 'http://127.0.0.1:4300';
const book = 'staging-fixture';
const report = { checks: [] };
/** Records a passed check. */
const pass = (name, detail = '') => { report.checks.push({ name, ok: true, ...(detail ? { detail } : {}) }); };
/** Runs docker compose with the staging file. */
const compose = (...args) => execFileSync('docker', ['compose', '-f', composeFile, ...args], { encoding: 'utf8' }).trim();
/** The start time of a service's container (changes only when it restarts or is recreated). */
const startedAt = (service) => execFileSync('docker', ['inspect', '--format', '{{.State.StartedAt}}', compose('ps', '-q', service)], { encoding: 'utf8' }).trim();
/** Calls Pantheon as a same-origin browser would. */
async function call(pathname, { method = 'GET', body, origin = base } = {}) {
  const headers = { origin };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${base}${pathname}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
  const type = response.headers.get('content-type') || '';
  const value = type.includes('json') ? await response.json() : Buffer.from(await response.arrayBuffer());
  return { status: response.status, type, value };
}
/** Polls until a predicate holds or the deadline passes. */
async function until(predicate, label, seconds = 120) {
  const deadline = Date.now() + seconds * 1000;
  for (;;) {
    try { const value = await predicate(); if (value) return value; } catch { /* retry */ }
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

// 1. Shell and composed documents through the single published port.
const home = await call('/home/');
assert.equal(home.status, 200); assert.match(home.type, /text\/html/); pass('command center served');
const splash = await call('/');
assert.equal(splash.status, 200); pass('public splash served');
const applications = await call('/api/applications');
assert.equal(applications.value.applications.find((entry) => entry.id === 'frige').state, 'active');
assert.equal(applications.value.applications.find((entry) => entry.id === 'seaxneat').state, 'deferred');
pass('registry: Frige active, Seaxneat honestly deferred');
const library = await call('/frige/');
assert.equal(library.status, 200); assert.match(library.type, /text\/html/); pass('Frige library page composed by Pantheon');
const workstation = await call(`/frige/?book=${book}`);
assert.equal(workstation.status, 200); pass('Frige workstation page composed by Pantheon');
const projects = await call('/api/platform/v1/projects');
assert.equal(projects.status, 200);
assert.ok(projects.value.projects.some((entry) => entry.id === book), 'the platform API lists the synthetic book');
pass('platform API project list through Pantheon');
const books = await call('/frige/api/books');
assert.ok(books.value.some?.((entry) => entry.id === book) || JSON.stringify(books.value).includes(book)); pass('Frige book list through the proxy');

// 2. A durable attachment and a real LuaLaTeX proof.
const marker = `staging marker ${Date.now()}`;
// A file name per run: the volumes persist, so earlier runs' uploads are still there.
const noteName = `staging-notes-${Date.now().toString(36)}.txt`;
const upload = await call(`/frige/api/project/attachments?book=${book}`, { method: 'POST', body: { attachments: [{ name: noteName, contentBase64: Buffer.from(`${marker}\nSynthetic note for container verification.\n`).toString('base64') }] } });
assert.equal(upload.status, 201, JSON.stringify(upload.value)); pass('synthetic attachment stored');
const build = await call(`/frige/api/project/build?book=${book}`, { method: 'POST', body: { scopeId: 'book', mode: 'prefix' } });
assert.equal(build.status, 200, JSON.stringify(build.value).slice(0, 400)); assert.equal(build.value.ok, true);
const proof = await call(`/frige/api/project/preview?book=${book}`);
assert.equal(proof.status, 200); assert.equal(proof.value.subarray(0, 5).toString('latin1'), '%PDF-');
pass('real LuaLaTeX proof built inside the Frige container', `${proof.value.length} bytes`);

// 3. Knowledge through the platform API; Pantheon holds no journal.
const knowledgeView = await call('/api/knowledge/v1');
assert.equal(knowledgeView.status, 200); assert.equal(knowledgeView.value.enabled, true);
const catalog = await call(`/api/knowledge/v1/sources?project=${encodeURIComponent(`stex://frige/project/${book}`)}`);
assert.equal(catalog.status, 200); const first = catalog.value.sources.find((entry) => entry.available);
// The volumes persist between runs; an owner event already accepted is not accepted twice (EVENT_CONFLICT by contract).
const already = knowledgeView.value.knowledge.sources.some((source) => source.id === first.id && source.revision === first.revision);
if (!already) {
  const accepted = await call('/api/knowledge/v1/accept', { method: 'POST', body: { idempotencyKey: `staging-${Date.now()}`, expectedVersion: knowledgeView.value.version, project: `stex://frige/project/${book}`, sources: [{ id: first.id, revision: first.revision }] } });
  assert.equal(accepted.status, 200, JSON.stringify(accepted.value));
}
assert.equal((await call('/api/knowledge/v1')).value.knowledge.sources.find((source) => source.id === first.id).access, 'current');
pass(already ? 'source already accepted in the platform-owned journal (persistent volume)' : 'source accepted into the platform-owned journal through Pantheon');
const foreign = await call('/api/knowledge/v1/accept', { method: 'POST', origin: 'http://attacker.example', body: {} });
assert.equal(foreign.status, 403); pass('foreign browser origin refused before the relay');
const pantheonEnv = execFileSync('docker', ['inspect', '--format', '{{json .Config.Env}}', compose('ps', '-q', 'pantheon')], { encoding: 'utf8' });
assert.ok(!pantheonEnv.includes('STEX_KNOWLEDGE_DATA_DIR')); assert.ok(pantheonEnv.includes('STEX_KNOWLEDGE_SERVICE=platform'));
const journalFiles = compose('exec', '-T', 'platform', 'ls', '/data/knowledge');
assert.match(journalFiles, /knowledge\.v1\.json/);
const pantheonFiles = compose('exec', '-T', 'pantheon', 'sh', '-c', 'find / -name knowledge.v1.json -not -path "/proc/*" 2>/dev/null | wc -l');
assert.equal(pantheonFiles, '0'); pass('journal exists only in the platform container');

// 4. Frige is not reachable from the host; only Pantheon is published.
await assert.rejects(fetch('http://127.0.0.1:4310/frige/api/books', { signal: AbortSignal.timeout(3000) })); pass('Frige port not published');

// 5. Recreate Frige; Pantheon keeps running and Frige's data survives.
const pantheonStarted = startedAt('pantheon'); const frigeStarted = startedAt('frige');
compose('up', '-d', '--force-recreate', '--no-deps', 'frige');
await until(async () => (await call('/frige/api/books')).status === 200, 'Frige after recreate');
assert.notEqual(startedAt('frige'), frigeStarted, 'Frige container was recreated');
assert.equal(startedAt('pantheon'), pantheonStarted, 'Pantheon was not restarted');
const attachments = await call(`/frige/api/project/attachments?book=${book}`);
assert.ok(JSON.stringify(attachments.value).includes(noteName));
const preview = await call(`/frige/api/project/attachments/${attachments.value.find((entry) => entry.name === noteName).id}/excerpt?book=${book}`);
assert.ok(JSON.stringify(preview.value).includes(marker), 'the uploaded bytes survived');
const proofAfter = await call(`/frige/api/project/preview?book=${book}`);
assert.equal(proofAfter.status, 200); assert.equal(proofAfter.value.subarray(0, 5).toString('latin1'), '%PDF-');
const knowledgeAfter = await call('/api/knowledge/v1');
assert.equal(knowledgeAfter.value.knowledge.sources.find((source) => source.id === first.id).access, 'current', 'the accepted source is still current after Frige returns');
pass('Frige recreated: attachment, proof and knowledge access survive; Pantheon not restarted');

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
