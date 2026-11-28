/**
 * Verifies passages and private knowledge contributions end to end (separation milestone, track 2).
 *
 * Real processes, synthetic data only: Frige (fake inference), the Python platform API
 * (knowledge owner) and Igor (local mode) with a recording stand-in for the inference
 * service, so no model or provider is ever called.
 *
 * Part A, hosted platform with two accounts (alice, bob) asserted as Pantheon does:
 *   search and exact citation; private approval; no leakage to bob through search marks,
 *   counts, listings, the knowledge view, export, or resolve; Igor's secret works on resolve
 *   only; stale excerpts; withdrawal; restart and replay; Node can still open the journal.
 * Part B, Igor: a conversation names a contribution by reference; every turn resolves it
 *   first; the text reaches only that turn's request and never the stored conversation;
 *   after withdrawal the next turn excludes it and earlier turns are unchanged.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { createKnowledgeResolver, personDirectoryName } = await import(pathToFileURL(path.join(root, 'stex-igor', 'apps', 'igor', 'server', 'knowledge.mjs')).href);
const { openKnowledge } = await import(pathToFileURL(path.join(root, 'services', 'knowledge', 'src', 'projections.mjs')).href);
const data = await mkdtemp(path.join(os.tmpdir(), 'stex-passages-'));
const ACTOR_SECRET = 'a'.repeat(40); const IGOR_SECRET = 'i'.repeat(40);
const PORTS = { frige: 4461, platform: 4462, igor: 4463, inference: 4464 };
const BOOK = 'fixture-book'; const PROJECT = `stex://frige/project/${BOOK}`;
const PASSAGE = 'The frost-bound orchard keeps its counted rows — 雪.';
const report = { checks: [], limits: ['synthetic data; local processes; no model or provider calls; Pantheon is represented by the actor headers it sends (relay covered by apps/pantheon tests)'] };
const pass = (name) => report.checks.push(name);
const children = new Set();
const python = path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');

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
/** Stops a process and waits for it. */
async function stop(child) { if (child.exitCode !== null) return; const done = new Promise((resolve) => child.once('exit', resolve)); child.kill(); await done; }
/** Headers Pantheon sends for an admitted person. */
const as = (username) => ({ 'x-stex-actor': username, 'x-stex-actor-role': 'member', 'x-stex-platform-token': ACTOR_SECRET, 'x-stex-actor-journal': personDirectoryName(username) });
/** Calls a JSON endpoint. */
async function call(url, { method = 'GET', headers = {}, body } = {}) {
  const response = await fetch(url, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  let value; try { value = JSON.parse(text); } catch { value = text; }
  return { status: response.status, value, text };
}
const knowledge = (route) => `http://127.0.0.1:${PORTS.platform}/api/knowledge/v1${route}`;
const frige = (route) => `http://127.0.0.1:${PORTS.frige}/frige${route}`;
const platformEnv = (hosted) => ({ STEX_PLATFORM_PORT: String(PORTS.platform), STEX_FRIGE_URL: `http://127.0.0.1:${PORTS.frige}`, STEX_KNOWLEDGE_DATA_DIR: path.join(data, hosted ? 'knowledge-hosted' : 'knowledge-local'), STEX_KNOWLEDGE_ENGINES: 'frige', ...(hosted ? { STEX_KNOWLEDGE_HOSTED: '1', STEX_PLATFORM_ACTOR_SECRET: ACTOR_SECRET, STEX_KNOWLEDGE_IGOR_SECRET: IGOR_SECRET } : {}) });
const startPlatform = (hosted) => start(python, ['-m', 'stex'], { cwd: root, env: platformEnv(hosted) }, /Uvicorn running/, 'platform API');
const extraction = (id) => path.join(data, 'books', BOOK, '.texgraph', 'extractions', `${id}.txt`);

try {
  // Synthetic book, Frige with the actor secret (state changes need a verified actor).
  await mkdir(path.join(data, 'books', BOOK, 'manuscript'), { recursive: true });
  await writeFile(path.join(data, 'books', BOOK, 'manuscript', 'Programme.md'), '# Programme\n\n- [Morning](Morning.md)\n');
  await writeFile(path.join(data, 'books', BOOK, 'manuscript', 'Morning.md'), '# Morning\n\nThe kettle sings.\n');
  await start(process.execPath, ['server.mjs'], { cwd: path.join(root, 'apps', 'frige'), env: { STEX_FRIGE_PORT: String(PORTS.frige), STEX_FRIGE_BASE_PATH: '/frige', STEX_FRIGE_BOOKS_DIR: path.join(data, 'books'), STEX_FRIGE_PROJECT_DIR: path.join(data, 'local'), STEX_FRIGE_PROJECTS_DIR: path.join(data, 'projects'), STEX_FRIGE_INFERENCE_MODE: 'fake', STEX_PLATFORM_ACTOR_SECRET: ACTOR_SECRET } }, /ready/, 'Frige');
  const approvedText = `Ledger of the orchard.\n\n${PASSAGE}\n\nNothing else here.\n`;
  assert.equal((await call(frige(`/api/project/attachments?book=${BOOK}`), { method: 'POST', headers: as('alice'), body: { attachments: [{ name: 'orchard.txt', contentBase64: Buffer.from(approvedText).toString('base64') }] } })).status, 201);
  const [record] = (await call(frige(`/api/project/attachments?book=${BOOK}`))).value;
  const preview = (await call(frige(`/api/project/attachments/${record.id}/excerpt?book=${BOOK}`))).value;
  assert.equal((await call(frige(`/api/project/attachments/${record.id}/approve?book=${BOOK}`), { method: 'POST', headers: as('alice'), body: { hash: preview.hash } })).status, 200);
  pass('synthetic document uploaded and its excerpt approved in Frige');

  // ---- Part A: hosted platform, two accounts ----
  let platform = await startPlatform(true);
  const search = await call(knowledge(`/passages/search?project=${encodeURIComponent(PROJECT)}&q=orchard%20rows`), { headers: as('alice') });
  assert.equal(search.status, 200, search.text); const [hit] = search.value.passages;
  assert.equal(hit.contribution, null); assert.equal(hit.passageSha256, createHash('sha256').update(PASSAGE).digest('hex'));
  const read = await call(knowledge(`/passages/read?${new URLSearchParams({ project: PROJECT, attachment: hit.attachmentId, excerpt: hit.excerptHash, start: String(hit.start), end: String(hit.end), passage: hit.passageSha256 })}`), { headers: as('alice') });
  assert.equal(read.value.passage.text, PASSAGE); pass('alice finds the passage and opens its exact citation');
  const citation = { project: PROJECT, attachmentId: hit.attachmentId, excerptHash: hit.excerptHash, start: hit.start, end: hit.end, passageSha256: hit.passageSha256 };
  const empty = (await call(knowledge('/contributions'), { headers: as('alice') })).value;
  const contributeBody = { idempotencyKey: 'alice-contribute-1', expectedVersion: empty.version, citation };
  const contributed = await call(knowledge('/contributions'), { method: 'POST', headers: as('alice'), body: contributeBody });
  assert.equal(contributed.status, 200, contributed.text);
  const reference = contributed.value.contributions[0].reference; const contributionId = contributed.value.contributions[0].id;
  assert.equal((await call(knowledge('/contributions'), { method: 'POST', headers: as('alice'), body: { ...contributeBody, idempotencyKey: 'alice-contribute-2', expectedVersion: contributed.value.version } })).value.code, 'ALREADY_CONTRIBUTED');
  pass('alice approves that passage revision for Igor (privately); a duplicate approval is refused');

  // Bob: the shared Frige source stays findable (Frige's rule), but nothing of alice's approval leaks.
  const bobSearch = await call(knowledge(`/passages/search?project=${encodeURIComponent(PROJECT)}&q=orchard%20rows`), { headers: as('bob') });
  assert.equal(bobSearch.value.passages.length, 1); assert.equal(bobSearch.value.passages[0].contribution, null);
  const bobList = (await call(knowledge('/contributions'), { headers: as('bob') })).value; assert.equal(bobList.contributions.length, 0);
  const bobView = await call(knowledge(''), { headers: as('bob') }); const bobExport = await call(knowledge('/export'), { headers: as('bob') });
  for (const response of [bobSearch, bobView, bobExport, await call(knowledge('/contributions'), { headers: as('bob') })]) assert.ok(!response.text.includes(contributionId), 'no response to bob names alice\'s contribution');
  assert.equal(bobView.value.knowledge.sources.length, 0); assert.equal(bobView.value.graph.relations.length, 0);
  const bobResolve = await call(knowledge('/contributions/resolve'), { method: 'POST', headers: { ...as('bob') }, body: { reference } });
  assert.equal(bobResolve.status, 404); assert.ok(!bobResolve.text.includes(PASSAGE));
  const bobWithdraw = await call(knowledge('/contributions/withdraw'), { method: 'POST', headers: as('bob'), body: { idempotencyKey: 'bob-withdraw-1', expectedVersion: bobList.version, id: contributionId } });
  assert.equal(bobWithdraw.status, 404);
  pass('bob: search marks, counts, listing, knowledge view, export, resolve and withdraw reveal nothing of alice\'s approval');

  // Igor's resolver (real stex-igor code) against the real platform.
  const resolver = createKnowledgeResolver({ url: `http://127.0.0.1:${PORTS.platform}`, secret: IGOR_SECRET });
  const [aliceUse] = await resolver.resolve('alice', [reference]);
  assert.equal(aliceUse.status, 'current'); assert.equal(aliceUse.contribution.text, PASSAGE); assert.equal(aliceUse.contribution.trust, 'untrusted-source');
  assert.equal((await resolver.resolve('bob', [reference]))[0].status, 'unavailable');
  const igorOnOther = await call(knowledge('/contributions'), { headers: { 'x-stex-actor': 'alice', 'x-stex-actor-role': 'member', 'x-stex-knowledge-token': IGOR_SECRET, 'x-stex-actor-journal': personDirectoryName('alice') } });
  assert.equal(igorOnOther.status, 401, 'Igor\'s secret is accepted on the resolve route only');
  pass('Igor resolves alice\'s contribution for alice only; its secret opens no other route');

  // Stale: the excerpt changes in Frige; the approval no longer matches.
  const original = await readFile(extraction(record.id), 'utf8');
  await writeFile(extraction(record.id), original.replace('counted', 'uncounted'));
  assert.equal((await call(knowledge('/contributions'), { headers: as('alice') })).value.contributions[0].state, 'stale');
  assert.equal((await resolver.resolve('alice', [reference]))[0].status, 'stale');
  assert.equal((await call(knowledge(`/passages/search?project=${encodeURIComponent(PROJECT)}&q=orchard`), { headers: as('alice') })).value.passages.length, 0);
  await writeFile(extraction(record.id), original);
  assert.equal((await resolver.resolve('alice', [reference]))[0].status, 'current');
  pass('a changed excerpt makes the contribution stale and unusable; the original bytes make it current again');

  // Withdrawal stops future use.
  const before = (await call(knowledge('/contributions'), { headers: as('alice') })).value;
  const withdrawBody = { idempotencyKey: 'alice-withdraw-1', expectedVersion: before.version, id: contributionId };
  assert.equal((await call(knowledge('/contributions/withdraw'), { method: 'POST', headers: as('alice'), body: withdrawBody })).status, 200);
  assert.equal((await resolver.resolve('alice', [reference]))[0].status, 'withdrawn');
  assert.equal((await call(knowledge(`/passages/search?project=${encodeURIComponent(PROJECT)}&q=orchard%20rows`), { headers: as('alice') })).value.passages[0].contribution, null);
  pass('withdrawal: resolve refuses (withdrawn) and search no longer marks it');

  // Restart and replay.
  await stop(platform); platform = await startPlatform(true);
  const afterRestart = (await call(knowledge('/contributions'), { headers: as('alice') })).value;
  assert.equal(afterRestart.contributions[0].state, 'withdrawn');
  const replayContribute = await call(knowledge('/contributions'), { method: 'POST', headers: as('alice'), body: contributeBody });
  assert.equal(replayContribute.value.replayed, true); assert.equal(replayContribute.value.contributions[0].status, 'withdrawn', 'replaying the original approval does not revive it');
  assert.equal((await call(knowledge('/contributions/withdraw'), { method: 'POST', headers: as('alice'), body: withdrawBody })).value.replayed, true);
  assert.equal((await resolver.resolve('alice', [reference]))[0].status, 'withdrawn');
  pass('after restart: withdrawal persists; replays are idempotent and cannot revive a withdrawn approval');

  // Storage: metadata only, and the projections journal is still the Node library's format.
  await stop(platform);
  const aliceDir = path.join(data, 'knowledge-hosted', 'people', personDirectoryName('alice'));
  const ledger = await readFile(path.join(aliceDir, 'contributions.v1.json'), 'utf8');
  assert.ok(!ledger.includes('frost-bound') && !ledger.includes('orchard keeps'), 'no passage text is stored');
  const bobLedger = await readFile(path.join(data, 'knowledge-hosted', 'people', personDirectoryName('bob'), 'contributions.v1.json'), 'utf8').catch(() => null);
  assert.ok(bobLedger === null || JSON.parse(bobLedger).events.length === 0, 'bob has no contributions on disk');
  const node = await openKnowledge({ directory: aliceDir }); assert.equal(node.view().enabled, true); await node.close();
  pass('the ledger holds metadata only; the Node library still opens the journal (native rollback)');

  // ---- Part B: Igor turns ----
  const seen = [];
  const inference = http.createServer(async (request, response) => {
    let body = ''; for await (const chunk of request) body += chunk;
    if (request.url === '/v1/hermes/health') { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ ok: true, configured: true, transport: 'fake' })); return; }
    const turn = JSON.parse(body); seen.push(turn);
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ contract: 'stex.hermes.turn.v1', requestId: turn.requestId, status: 'complete', events: [{ type: 'message', payload: { text: `Recorded turn ${seen.length}.` } }], usage: { transport: 'fake' } }));
  });
  await new Promise((resolve) => inference.listen(PORTS.inference, '127.0.0.1', resolve));
  try {
    platform = await startPlatform(false);
    const local = (await call(knowledge('/contributions'))).value;
    const localContribution = await call(knowledge('/contributions'), { method: 'POST', body: { idempotencyKey: 'local-contribute-1', expectedVersion: local.version, citation } });
    assert.equal(localContribution.status, 200, localContribution.text);
    const localReference = localContribution.value.contributions[0].reference;
    const igorData = path.join(data, 'igor');
    await start(process.execPath, ['server.mjs'], { cwd: path.join(root, 'stex-igor', 'apps', 'igor'), env: { STEX_IGOR_PORT: String(PORTS.igor), STEX_IGOR_DATA_DIR: igorData, STEX_INFERENCE_URL: `http://127.0.0.1:${PORTS.inference}`, STEX_INFERENCE_SHARED_SECRET: 'verification-only', STEX_KNOWLEDGE_URL: `http://127.0.0.1:${PORTS.platform}` } }, /Igor is ready/, 'Igor');
    const igorBase = `http://127.0.0.1:${PORTS.igor}`;
    const igor = (route, options = {}) => call(`${igorBase}/igor/api${route}`, { ...options, headers: { origin: igorBase, ...(options.headers || {}) } });
    const created = await igor('/conversations', { method: 'POST', body: { idempotencyKey: 'igor-knowledge-1', message: 'What does the passage say about the rows?', knowledge: [localReference] } });
    assert.ok([201, 202].includes(created.status), created.text);
    const id = created.value.conversation.id;
    /** Waits until the latest reply settles. */
    const settled = async () => { for (let i = 0; i < 100; i++) { const value = (await igor(`/conversations/${id}`)).value.conversation; if (value.messages.at(-1).status !== 'pending') return value; await new Promise((r) => setTimeout(r, 100)); } throw new Error('Igor reply did not settle'); };
    let conversation = await settled();
    assert.equal(seen.length, 1); assert.equal(seen[0].context.knowledgeContributions[0].text, PASSAGE);
    assert.equal(seen[0].context.knowledgeContributions[0].trust, 'untrusted-source');
    assert.ok(!seen[0].conversation.messages.some((message) => message.content.includes(PASSAGE)), 'the excerpt is context, not a pasted message');
    assert.deepEqual(conversation.messages.at(-1).knowledge, [{ reference: localReference, status: 'current' }]);
    assert.ok(!JSON.stringify(conversation).includes(PASSAGE), 'the stored conversation holds the reference only');
    const firstReply = conversation.messages.at(-1).content;
    pass('Igor resolved the contribution before the turn; the text reached only that request, labelled untrusted');

    const current = (await call(knowledge('/contributions'))).value;
    assert.equal((await call(knowledge('/contributions/withdraw'), { method: 'POST', body: { idempotencyKey: 'local-withdraw-1', expectedVersion: current.version, id: current.contributions[0].id } })).status, 200);
    assert.equal((await igor(`/conversations/${id}/messages`, { method: 'POST', body: { idempotencyKey: 'igor-knowledge-2', content: 'And now?' } })).status, 202);
    conversation = await settled();
    assert.equal(seen.length, 2); assert.equal(seen[1].context.knowledgeContributions, undefined, 'a withdrawn passage is not sent');
    assert.deepEqual(conversation.messages.at(-1).knowledge, [{ reference: localReference, status: 'withdrawn' }]);
    assert.equal(conversation.messages.find((message) => message.role === 'assistant').content, firstReply, 'the earlier turn is unchanged');
    const stored = await readFile(path.join(igorData, 'conversations.json'), 'utf8');
    assert.ok(!stored.includes(PASSAGE) && !stored.includes('frost-bound'), 'Igor\'s storage never held the passage');
    pass('after withdrawal the next turn excludes the passage; the earlier turn and its reply are unchanged (not erased)');
  } finally { inference.close(); }
  report.result = 'PASS';
} finally {
  await Promise.all([...children].map(stop));
  await rm(data, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
console.log(JSON.stringify(report, null, 2));
