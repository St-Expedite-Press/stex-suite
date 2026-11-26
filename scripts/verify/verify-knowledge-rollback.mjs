/**
 * Proves knowledge rollback between the Node library and the platform API with new data.
 *
 * Disposable directories and synthetic data; real Frige and platform processes; the
 * Node path uses the same per-person library Pantheon uses in hosted mode. Exactly one
 * writer at a time: every switch stops the previous writer and asserts its lock is gone.
 *
 *   node scripts/verify/verify-knowledge-rollback.mjs
 *
 * Phases: Node (accept) → FastAPI (contribute, withdraw) → restart → Node (journal write;
 * contributions unavailable, files untouched, Igor fails closed) → FastAPI (nothing revived,
 * ownership unchanged) → Node (erase) → FastAPI (erasure honoured).
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const load = (...parts) => import(pathToFileURL(path.join(root, ...parts)).href);
const { openKnowledgeLibrary, personDirectoryName } = await load('services', 'knowledge', 'src', 'library.mjs');
const { knowledgeApi } = await load('apps', 'pantheon', 'src', 'knowledge-api.mjs');
const { actorHeaders } = await load('apps', 'pantheon', 'src', 'actor.mjs');
const { createKnowledgeResolver } = await load('stex-igor', 'apps', 'igor', 'server', 'knowledge.mjs');

const SECRET = 'r'.repeat(40); const IGOR = 'g'.repeat(40);
const PORTS = { frige: 4471, platform: 4472 };
const BOOK = 'fixture-book'; const PROJECT = `stex://frige/project/${BOOK}`;
const data = await mkdtemp(path.join(os.tmpdir(), 'stex-rollback-'));
const knowledgeDir = path.join(data, 'knowledge');
const python = path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const report = { phases: [], preserved: [], unavailableDuringRollback: [] };
const children = new Set();

/** Starts a process and resolves when its output matches `ready`. */
function start(command, args, options, ready, label) {
  const child = spawn(command, args, { windowsHide: true, ...options, env: { ...process.env, ...options.env } });
  children.add(child); child.once('exit', () => children.delete(child));
  return new Promise((resolve, reject) => {
    let output = ''; const timer = setTimeout(() => reject(new Error(`${label} did not start:\n${output}`)), 20_000);
    const listen = (chunk) => { output += chunk; if (ready.test(output)) { clearTimeout(timer); resolve(child); } };
    child.stdout.on('data', listen); child.stderr.on('data', listen);
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`${label} exited (${code}):\n${output}`)); });
  });
}
const stop = async (child) => { if (child.exitCode !== null) return; const done = new Promise((resolve) => child.once('exit', resolve)); child.kill(); await done; };
const actor = (username) => actorHeaders({ username, role: 'member' }, SECRET);
const as = (username) => ({ ...actor(username), 'x-stex-actor-journal': personDirectoryName(username) });
async function call(url, { method = 'GET', headers = {}, body } = {}) {
  const response = await fetch(url, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text(); let value; try { value = JSON.parse(text); } catch { value = text; }
  return { status: response.status, value };
}
const platformUrl = (route) => `http://127.0.0.1:${PORTS.platform}/api/knowledge/v1${route}`;
const frige = (route) => `http://127.0.0.1:${PORTS.frige}/frige${route}`;
const startPlatform = () => start(python, ['-m', 'stex'], { cwd: root, env: { STEX_PLATFORM_PORT: String(PORTS.platform), STEX_FRIGE_URL: `http://127.0.0.1:${PORTS.frige}`, STEX_KNOWLEDGE_DATA_DIR: knowledgeDir, STEX_KNOWLEDGE_ENGINES: 'frige', STEX_KNOWLEDGE_HOSTED: '1', STEX_PLATFORM_ACTOR_SECRET: SECRET, STEX_KNOWLEDGE_IGOR_SECRET: IGOR } }, /Uvicorn running/, 'platform API');
const people = ['alice', 'bob'];
const dirOf = (username) => path.join(knowledgeDir, 'people', personDirectoryName(username));
/**
 * One writer at a time. A lock may outlive a hard stop (Windows terminates the process, as a
 * crash would), but whatever lock remains must name a process that is gone, never this one
 * (the Node path closes cleanly): the next writer recovers it through the liveness check.
 */
async function noLocks(stopped = null) {
  if (stopped) assert.throws(() => process.kill(stopped.pid, 0), `the stopped writer ${stopped.pid} is gone`);
  for (const person of people) {
    let lock; try { lock = JSON.parse(await readFile(path.join(dirOf(person), 'knowledge.lock'), 'utf8')); } catch { continue; }
    assert.notEqual(lock.pid, process.pid, `${person}'s lock was left by the Node path after a clean close`);
    assert.throws(() => process.kill(lock.pid, 0), `the writer ${lock.pid} named by ${person}'s lock is gone`);
    report.recoveredLocks = (report.recoveredLocks || 0) + 1;
  }
}
const digestOf = async (file) => createHash('sha256').update(await readFile(file)).digest('hex');

/** The Node path: the hosted per-person library and Pantheon's in-process knowledge API. */
async function nodePath() {
  const library = await openKnowledgeLibrary({ directory: knowledgeDir, hosted: true });
  const route = knowledgeApi({ library, targets: { frige: new URL(`http://127.0.0.1:${PORTS.frige}`) } });
  /** Calls Pantheon's in-process route for an admitted person. */
  async function api(username, pathname, body) {
    const request = Object.assign(Readable.from(body ? [Buffer.from(JSON.stringify(body))] : []), { method: body ? 'POST' : 'GET', headers: { host: '127.0.0.1:4300', ...(body ? { 'content-type': 'application/json' } : {}) } });
    const response = { status: 0, body: '', writeHead(status) { this.status = status; }, end(value) { this.body = String(value ?? ''); } };
    const url = new URL(`http://127.0.0.1:4300/api/knowledge/v1${pathname}`);
    await route(request, response, url, { user: { username }, actor: actor(username) });
    return { status: response.status, value: JSON.parse(response.body) };
  }
  return { api, close: () => library.close() };
}

try {
  // Synthetic book and one approved document in Frige (actor required for changes).
  await mkdir(path.join(data, 'books', BOOK, 'manuscript'), { recursive: true });
  await writeFile(path.join(data, 'books', BOOK, 'manuscript', 'Programme.md'), '# Programme\n\n- [Morning](Morning.md)\n');
  await writeFile(path.join(data, 'books', BOOK, 'manuscript', 'Morning.md'), '# Morning\n\nThe kettle sings.\n');
  await start(process.execPath, ['server.mjs'], { cwd: path.join(root, 'apps', 'frige'), env: { STEX_FRIGE_PORT: String(PORTS.frige), STEX_FRIGE_BASE_PATH: '/frige', STEX_FRIGE_BOOKS_DIR: path.join(data, 'books'), STEX_FRIGE_PROJECT_DIR: path.join(data, 'local'), STEX_FRIGE_PROJECTS_DIR: path.join(data, 'projects'), STEX_FRIGE_INFERENCE_MODE: 'fake', STEX_PLATFORM_ACTOR_SECRET: SECRET } }, /ready/, 'Frige');
  const text = 'Ledger.\n\nFirst passage about the orchard rows.\n\nSecond passage about the orchard gate.\n';
  assert.equal((await call(frige(`/api/project/attachments?book=${BOOK}`), { method: 'POST', headers: actor('alice'), body: { attachments: [{ name: 'orchard.txt', contentBase64: Buffer.from(text).toString('base64') }] } })).status, 201);
  const [record] = (await call(frige(`/api/project/attachments?book=${BOOK}`))).value;
  const preview = (await call(frige(`/api/project/attachments/${record.id}/excerpt?book=${BOOK}`))).value;
  assert.equal((await call(frige(`/api/project/attachments/${record.id}/approve?book=${BOOK}`), { method: 'POST', headers: actor('alice'), body: { hash: preview.hash } })).status, 200);

  // Phase 1: Node path — each person accepts the manuscript source into their own journal.
  let node = await nodePath();
  const nodeViews = {};
  for (const person of people) {
    const catalog = await node.api(person, `/sources?project=${encodeURIComponent(PROJECT)}`);
    const view = await node.api(person, '');
    const accepted = await node.api(person, '/accept', { idempotencyKey: `node-accept-${person}`, expectedVersion: view.value.version, project: PROJECT, sources: [{ id: catalog.value.sources[0].id, revision: catalog.value.sources[0].revision }] });
    assert.equal(accepted.status, 200, JSON.stringify(accepted.value)); nodeViews[person] = accepted.value;
  }
  await node.close(); await noLocks();
  report.phases.push('Node: alice and bob each accepted a source in their own journal');

  // Phase 2: FastAPI — same journals, then new data that only this path understands.
  let platform = await startPlatform();
  for (const person of people) {
    const view = (await call(platformUrl(''), { headers: as(person) })).value;
    assert.equal(view.version, nodeViews[person].version, `${person}: same version token`);
    assert.deepEqual(view.knowledge, nodeViews[person].knowledge, `${person}: same knowledge view`);
  }
  /** A citation for a passage containing `word`. */
  const cite = async (person, word) => {
    const hit = (await call(platformUrl(`/passages/search?project=${encodeURIComponent(PROJECT)}&q=${word}`), { headers: as(person) })).value.passages[0];
    return { project: PROJECT, attachmentId: hit.attachmentId, excerptHash: hit.excerptHash, start: hit.start, end: hit.end, passageSha256: hit.passageSha256 };
  };
  const contribute = async (person, citation, key) => {
    const { version } = (await call(platformUrl('/contributions'), { headers: as(person) })).value;
    const created = await call(platformUrl('/contributions'), { method: 'POST', headers: as(person), body: { idempotencyKey: key, expectedVersion: version, citation } });
    assert.equal(created.status, 200, JSON.stringify(created.value));
    return created.value.contributions.find((c) => c.passageSha256 === citation.passageSha256);
  };
  const kept = await contribute('alice', await cite('alice', 'rows'), 'alice-keep-0001');
  const dropped = await contribute('alice', await cite('alice', 'gate'), 'alice-drop-0001');
  const bobs = await contribute('bob', await cite('bob', 'rows'), 'bob-keep-00001');
  const { version: before } = (await call(platformUrl('/contributions'), { headers: as('alice') })).value;
  const withdrawBody = { idempotencyKey: 'alice-withdraw-1', expectedVersion: before, id: dropped.id };
  assert.equal((await call(platformUrl('/contributions/withdraw'), { method: 'POST', headers: as('alice'), body: withdrawBody })).status, 200);
  report.phases.push('FastAPI: same journals as Node (versions and views); alice made two contributions and withdrew one; bob made one');

  // Phase 3: restart.
  await stop(platform); await noLocks(platform); platform = await startPlatform();
  const resolver = createKnowledgeResolver({ url: `http://127.0.0.1:${PORTS.platform}`, secret: IGOR });
  assert.equal((await resolver.resolve('alice', [kept.reference]))[0].status, 'current');
  assert.equal((await resolver.resolve('alice', [dropped.reference]))[0].status, 'withdrawn');
  assert.equal((await resolver.resolve('bob', [kept.reference]))[0].status, 'unavailable', 'bob cannot resolve alice\'s');
  const exportBefore = { alice: (await call(platformUrl('/export'), { headers: as('alice') })).value, bob: (await call(platformUrl('/export'), { headers: as('bob') })).value };
  report.phases.push('restart: alice\'s kept contribution resolves; the withdrawn one is withdrawn; bob cannot resolve alice\'s');

  // Phase 4: back to Node. Contributions become unavailable; their files are untouched; Igor fails closed.
  await stop(platform); await noLocks(platform);
  const ledgers = Object.fromEntries(await Promise.all(people.map(async (p) => [p, await digestOf(path.join(dirOf(p), 'contributions.v1.json'))])));
  node = await nodePath();
  for (const person of people) {
    const exported = (await node.api(person, '/export')).value;
    assert.deepEqual(exported.journal, exportBefore[person].journal, `${person}: Node reads the platform's journal byte-for-byte as JSON`);
  }
  const contributionsOnNode = await node.api('alice', '/contributions');
  assert.equal(contributionsOnNode.status, 404);
  assert.equal((await resolver.resolve('alice', [kept.reference]))[0].status, 'unavailable', 'Igor fails closed while the platform is off');
  const bobView = (await node.api('bob', '')).value;
  const revoked = await node.api('bob', '/revoke', { idempotencyKey: 'bob-revoke-node', expectedVersion: bobView.version, project: PROJECT });
  assert.equal(revoked.status, 200); assert.equal(revoked.value.graph.projects[0].consent, false);
  await node.close(); await noLocks();
  for (const person of people) assert.equal(await digestOf(path.join(dirOf(person), 'contributions.v1.json')), ledgers[person], `${person}'s contributions untouched by Node`);
  report.unavailableDuringRollback.push('GET/POST /contributions*, /passages/*, /notes* answer 404 on the Node path', 'Igor resolves every contribution as unavailable (passages are not used; turns still run)', 'withdrawing a contribution is not possible until the platform returns');
  report.preserved.push('journals (Node reads and writes them; bob revoked consent on Node)', 'contributions.v1.json files are byte-identical across the rollback', 'per-person directories and ownership');
  report.phases.push('Node: journals parity with the platform export; contributions 404; Igor fails closed; bob revoked on Node; contribution files unchanged');

  // Phase 5: forward again. Nothing revived; ownership unchanged; Node's change visible.
  platform = await startPlatform();
  const alice = (await call(platformUrl('/contributions'), { headers: as('alice') })).value.contributions;
  assert.deepEqual(alice.map((c) => [c.id, c.status]).sort(), [[kept.id, 'active'], [dropped.id, 'withdrawn']].sort());
  assert.equal((await resolver.resolve('alice', [dropped.reference]))[0].status, 'withdrawn', 'no resurrection');
  assert.equal((await resolver.resolve('alice', [kept.reference]))[0].status, 'current');
  const bob = (await call(platformUrl('/contributions'), { headers: as('bob') })).value.contributions;
  assert.deepEqual(bob.map((c) => c.id), [bobs.id]);
  assert.equal((await call(platformUrl(''), { headers: as('bob') })).value.graph.projects[0].consent, false, 'Node\'s revocation is visible');
  assert.deepEqual((await readdir(path.join(knowledgeDir, 'people'))).sort(), people.map(personDirectoryName).sort(), 'no new or renamed person directories');
  report.phases.push('FastAPI again: kept is current, withdrawn stays withdrawn, bob\'s unchanged, Node\'s revocation visible, same person directories');

  // Phase 6: erase on Node, then forward: the erasure is honoured.
  await stop(platform); await noLocks(platform);
  node = await nodePath();
  const aliceView = (await node.api('alice', '')).value;
  assert.equal((await node.api('alice', '/erase', { confirmation: 'delete-knowledge', expectedVersion: aliceView.version })).status, 200);
  await node.close(); await noLocks();
  platform = await startPlatform();
  assert.deepEqual((await call(platformUrl('/contributions'), { headers: as('alice') })).value.contributions, [], 'alice\'s contributions died with her erased journal');
  assert.equal((await resolver.resolve('alice', [kept.reference]))[0].status, 'unavailable');
  assert.equal((await call(platformUrl('/contributions'), { headers: as('bob') })).value.contributions.length, 1, 'bob is unaffected');
  report.phases.push('erase on Node then FastAPI: alice\'s contributions are gone (not revived); bob unaffected');
  await stop(platform); await noLocks(platform);
  report.result = 'PASS';
} finally {
  await Promise.all([...children].map(stop));
  await rm(data, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
console.log(JSON.stringify(report, null, 2));
