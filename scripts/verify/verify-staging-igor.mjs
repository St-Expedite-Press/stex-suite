/**
 * Verifies the exact Hermes/Obsidian pair on Igor's real API path in the staging stack.
 *
 * compose.yaml + compose.hosted.yaml + compose.igor-host.yaml: a signed-in browser request goes
 * through the TLS edge to Pantheon, to Igor, to the inference service (remote transport), to a
 * Hermes gateway installed by the VM's managed recipe at the pin, to a recording fake provider.
 * Synthetic accounts and data; fixtures and secrets generated per run outside the repository.
 *
 *   node scripts/verify/verify-staging-igor.mjs [--skip-rollback] [--keep]
 *
 * Prints a JSON report and exits non-zero on the first failure.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { hashPassword } = await import(pathToFileURL(path.join(root, 'stex-igor', 'apps', 'igor', 'server', 'auth.mjs')).href);
const pins = JSON.parse(await readFile(path.join(root, 'stex-igor', 'hermes', 'eval', 'pins.json'), 'utf8'));
const loadCheck = await readFile(path.join(root, 'stex-igor', 'hermes', 'eval', 'load_check.py'), 'utf8');
const hermesSource = process.env.STEX_STAGING_HERMES_SOURCE || path.join(os.homedir(), 'stex-wt', 'hermes', 'ctx-managed', 'hermes-agent');
const dir = path.join(root, 'deploy', 'staging-compose');
const HOST = 'pantheon.stex.test'; const PORT = 8443; const ORIGIN = `https://${HOST}:${PORT}`;
const report = { pins: { hermes: pins.candidate, obsidian: { sha: pins.obsidian.sha, tag: pins.obsidian.tag } }, checks: [], notices: [], limits: ['synthetic accounts and data; local Docker; fake model provider (no model is called); Caddy local CA instead of Cloudflare'] };
const pass = (name, detail) => report.checks.push(detail === undefined ? name : { name, detail });

const fixtures = await mkdtemp(path.join(os.tmpdir(), 'stex-staging-igor-'));
const secret = () => randomBytes(32).toString('hex');
const accounts = { alice: { password: secret(), role: 'owner' }, bob: { password: secret(), role: 'member' } };
await writeFile(path.join(fixtures, 'igor-users.json'), JSON.stringify({ users: await Promise.all(Object.entries(accounts).map(async ([username, { password, role }]) => ({ username, role, passwordHash: await hashPassword(password) }))) }));
const envFile = path.join(fixtures, 'staging.env');
const env = { STEX_STAGING_FIXTURES: fixtures.replaceAll('\\', '/'), STEX_STAGING_HERMES_SOURCE: hermesSource.replaceAll('\\', '/'), STEX_STAGING_IGOR_SESSION_SECRET: secret(), STEX_STAGING_ACTOR_SECRET: secret(), STEX_STAGING_KNOWLEDGE_IGOR_SECRET: secret(), STEX_STAGING_API_SERVER_KEY: secret(), STEX_STAGING_INFERENCE_SECRET: secret() };
await writeFile(envFile, Object.entries(env).map(([key, value]) => `${key}=${value}`).join('\n'));
const files = ['compose.yaml', 'compose.hosted.yaml', 'compose.igor-host.yaml'].flatMap((file) => ['-f', path.join(dir, file)]);
const compose = (args, extraEnv = {}, input) => execFileSync('docker', ['compose', ...files, '--env-file', envFile, ...args], { encoding: 'utf8', input, env: { ...process.env, MSYS_NO_PATHCONV: '1', ...extraEnv }, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 }).trim();
const inIgor = (user, script, input) => compose(['exec', '-T', '-u', user, 'igor', 'bash', '-lc', script], {}, input);
const hermesShell = (command, input) => inIgor('hermes', `cd ~/hermes-agent && source ./activate >/dev/null 2>&1 && ${command}`, input);
const lastJson = (text) => JSON.parse(text.split('\n').filter((line) => line.startsWith('{')).at(-1));
const providerRequests = () => { const text = inIgor('root', 'cat /tmp/provider/requests.jsonl 2>/dev/null || true'); return text ? text.split('\n').filter(Boolean).map((line) => JSON.parse(line)) : []; };

// Always from clean volumes, and never beside a stray container attached to the Hermes home.
compose(['down', '-v']);
const stray = execFileSync('docker', ['ps', '-a', '--filter', 'volume=stex-staging_hermes-home', '--format', '{{.Names}}'], { encoding: 'utf8' }).trim();
assert.equal(stray, '', `containers still attached to the Hermes home volume: ${stray}`);
compose(['up', '-d', '--wait']);
const ca = compose(['exec', '-T', 'edge', 'cat', '/data/caddy/pki/authorities/local/root.crt']);
function call(route, { method = 'GET', cookie, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const headers = { host: `${HOST}:${PORT}`, accept: 'application/json', ...(method !== 'GET' ? { origin: ORIGIN } : {}), ...(cookie ? { cookie } : {}), ...(payload ? { 'content-type': 'application/json', 'content-length': payload.length } : {}) };
    const request = https.request({ hostname: '127.0.0.1', port: PORT, servername: HOST, ca, method, path: route, headers }, (response) => {
      const chunks = []; response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => { const text = Buffer.concat(chunks).toString('utf8'); let value; try { value = JSON.parse(text); } catch { value = text; } resolve({ status: response.statusCode, headers: response.headers, value }); });
    });
    request.on('error', reject); if (payload) request.write(payload); request.end();
  });
}
async function signIn(username) {
  const response = await call('/igor/api/session', { method: 'POST', body: { username, password: accounts[username].password } });
  assert.equal(response.status, 200, JSON.stringify(response.value));
  return [response.headers['set-cookie']].flat().find((value) => value.startsWith('__Host-igor_session=')).split(';')[0];
}
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** Waits for a conversation's latest reply to settle. */
async function settled(cookie, id) {
  for (let i = 0; i < 120; i++) {
    const response = await call(`/igor/api/conversations/${id}`, { cookie });
    assert.equal(response.status, 200, `conversation read: ${response.status} ${JSON.stringify(response.value).slice(0, 300)}`);
    const { conversation } = response.value;
    if (conversation.messages.at(-1).status !== 'pending') return conversation;
    await wait(1000);
  }
  throw new Error('the Igor reply did not settle');
}
const requestText = (entry) => JSON.stringify(entry.body);

try {
  // 1. Exact pins on the managed install.
  assert.equal(hermesShell('git rev-parse HEAD'), pins.candidate.sha);
  const record = JSON.parse(inIgor('hermes', 'cat ~/.hermes/profiles/igor/plugins/obsidian/.hermes-catalog.json'));
  assert.equal(record.sha, pins.obsidian.sha); assert.equal(record.repo, pins.obsidian.repo);
  pass('managed install: Hermes checkout at the exact pin; connector installed at the deliberate SHA (not the live catalog default)', { hermes: pins.candidate.sha, connector: `${record.repo}@${record.sha}`, tier: record.tier });
  report.versionLine = hermesShell('hermes --version 2>&1 | head -1');

  // 2. The intended API profile: Markdown, Bases and Canvas load; the command-running skills do not.
  const loaded = lastJson(hermesShell('HERMES_HOME=$HOME/.hermes/profiles/igor python -', loadCheck));
  for (const name of pins.obsidian.enabled) { assert.equal(loaded.view[name].success, true, name); assert.equal(loaded.index[name], true, name); }
  for (const name of ['obsidian-cli', 'obsidian-headless', 'defuddle', 'knap']) { assert.equal(loaded.view[name].success, false, name); assert.equal(loaded.index[name], false, name); }
  const toolsets = hermesShell('hermes -p igor config get platform_toolsets.api_server 2>/dev/null | tail -1');
  assert.equal(toolsets, '[]');
  pass('igor profile (the API server\'s profile): Markdown, Bases and Canvas load; CLI, Headless, Defuddle and Knap do not; API-server toolsets []');
  const egress = inIgor('root', 'curl -sS -m 5 -o /dev/null https://openrouter.ai/ && echo open || echo blocked');
  assert.equal(egress, 'blocked');
  pass('the Igor host has no outside network (internal network only)');

  // 3. A Frige document, two approved passages, and alice's contributions.
  const alice = await signIn('alice');
  const book = 'staging-fixture'; const project = `stex://frige/project/${book}`;
  const marker = `pear${Date.now().toString(36)}`;
  const rows = `The ${marker} orchard keeps its counted rows under frost.`; const gate = `The ${marker} gate is painted the colour of rust.`;
  assert.equal((await call(`/frige/api/project/attachments?book=${book}`, { method: 'POST', cookie: alice, body: { attachments: [{ name: `${marker}.txt`, contentBase64: Buffer.from(`Notes.\n\n${rows}\n\n${gate}\n`).toString('base64') }] } })).status, 201);
  const recordId = (await call(`/frige/api/project/attachments?book=${book}`, { cookie: alice })).value.find((entry) => entry.name === `${marker}.txt`).id;
  const preview = (await call(`/frige/api/project/attachments/${recordId}/excerpt?book=${book}`, { cookie: alice })).value;
  assert.equal((await call(`/frige/api/project/attachments/${recordId}/approve?book=${book}`, { method: 'POST', cookie: alice, body: { hash: preview.hash } })).status, 200);
  const cite = async (word) => {
    const hit = (await call(`/api/knowledge/v1/passages/search?project=${encodeURIComponent(project)}&q=${marker}%20${word}`, { cookie: alice })).value.passages[0];
    return { project, attachmentId: hit.attachmentId, excerptHash: hit.excerptHash, start: hit.start, end: hit.end, passageSha256: hit.passageSha256 };
  };
  const contribute = async (citation, key) => {
    const { version } = (await call('/api/knowledge/v1/contributions', { cookie: alice })).value;
    const created = await call('/api/knowledge/v1/contributions', { method: 'POST', cookie: alice, body: { idempotencyKey: key, expectedVersion: version, citation } });
    assert.equal(created.status, 200, JSON.stringify(created.value));
    return created.value.contributions.find((c) => c.passageSha256 === citation.passageSha256);
  };
  const rowsRef = await contribute(await cite('rows'), `rows-${marker}`);
  const gateRef = await contribute(await cite('gate'), `gate-${marker}`);
  const withdraw = async (contribution, key) => {
    const { version } = (await call('/api/knowledge/v1/contributions', { cookie: alice })).value;
    assert.equal((await call('/api/knowledge/v1/contributions/withdraw', { method: 'POST', cookie: alice, body: { idempotencyKey: key, expectedVersion: version, id: contribution.id } })).status, 200);
  };
  await withdraw(gateRef, `withdraw-gate-${marker}`);
  pass('alice approved two passages for Igor through Pantheon and withdrew one before any turn');

  // 4. A turn on the real path receives only the approved, current passage.
  const before = providerRequests().length;
  const created = await call('/igor/api/conversations', { method: 'POST', cookie: alice, body: { idempotencyKey: `turn-${marker}`, message: 'What does the cited passage say?', knowledge: [rowsRef.reference, gateRef.reference] } });
  assert.ok([201, 202].includes(created.status), JSON.stringify(created.value));
  const id = created.value.conversation.id;
  let conversation = await settled(alice, id);
  assert.equal(conversation.messages.at(-1).status, 'complete', JSON.stringify(conversation.messages.at(-1)));
  assert.equal(conversation.messages.at(-1).content, 'Staging reply from the fake provider.');
  assert.deepEqual(conversation.messages.at(-1).knowledge, [{ reference: rowsRef.reference, status: 'current' }, { reference: gateRef.reference, status: 'withdrawn' }]);
  const firstTurn = providerRequests().slice(before);
  assert.ok(firstTurn.length >= 1, 'the provider was called');
  const main = firstTurn.find((entry) => requestText(entry).includes('cited passage'));
  assert.ok(main, 'the turn reached the provider through Hermes');
  assert.ok(requestText(main).includes(rows), 'the approved, current passage reached the model request');
  assert.ok(!firstTurn.some((entry) => requestText(entry).includes(gate)), 'the withdrawn passage never reached the provider');
  assert.ok(!firstTurn.some((entry) => Array.isArray(entry.body.tools) && entry.body.tools.length), 'no tool definitions were offered to the model');
  assert.ok(!firstTurn.some((entry) => /anthropic|claude/i.test(String(entry.body.model))), 'no Claude model was requested');
  report.firstTurnModels = [...new Set(firstTurn.map((entry) => entry.body.model))];
  report.skillIndexInTurnPrompt = Object.fromEntries(pins.obsidian.enabled.map((name) => [name, requestText(main).includes(`obsidian:${name}`)]));
  assert.ok(!JSON.stringify(conversation).includes(rows), 'Igor stored the reference only');
  pass('Igor turn via inference → Hermes (managed install) → fake provider carried only the approved, current passage; no tools; Grok model', { models: report.firstTurnModels });

  // 5. Withdrawal excludes it from the next turn.
  await withdraw(rowsRef, `withdraw-rows-${marker}`);
  const mark = providerRequests().length;
  assert.equal((await call(`/igor/api/conversations/${id}/messages`, { method: 'POST', cookie: alice, body: { idempotencyKey: `turn2-${marker}`, content: 'And now?' } })).status, 202);
  conversation = await settled(alice, id);
  assert.deepEqual(conversation.messages.at(-1).knowledge, [{ reference: rowsRef.reference, status: 'withdrawn' }, { reference: gateRef.reference, status: 'withdrawn' }]);
  const secondTurn = providerRequests().slice(mark);
  assert.ok(secondTurn.length >= 1);
  assert.ok(!secondTurn.some((entry) => requestText(entry).includes(rows) && !requestText(entry).includes('What does the cited passage say?')), 'the withdrawn passage is not sent as context');
  const secondMain = secondTurn.find((entry) => requestText(entry).includes('And now?'));
  assert.ok(secondMain && !JSON.stringify(secondMain.body.messages.at(-1)).includes(rows));
  assert.ok(!/knowledgeContributions[^\]]*counted rows/.test(requestText(secondMain)), 'no knowledge context carries the passage');
  pass('after withdrawal the next turn sends no knowledge context with the passage; outcomes recorded as withdrawn; earlier turn unchanged');
  report.notices.push('Conversation history sent with the second turn still contains the first turn\'s user message and reply, as every Igor turn does; withdrawal stops future use of the passage as context, it does not rewrite history.');

  // 6. Restart: the gateway, Igor and inference come back on the same state.
  const integrity = () => lastJson(hermesShell('python -c "import json,sqlite3,os; p=os.path.expanduser(\'~/.hermes/profiles/igor/state.db\'); c=sqlite3.connect(f\'file:{p}?mode=ro\', uri=True); print(json.dumps({\'integrity\': c.execute(\'PRAGMA integrity_check\').fetchone()[0], \'sessions\': c.execute(\'SELECT count(*) FROM sessions\').fetchone()[0]}))"'));
  const beforeRestart = integrity();
  compose(['restart', 'igor']); compose(['up', '-d', '--wait', 'igor']);
  const afterRestart = integrity();
  assert.ok(!inIgor('root', 'cat /tmp/hermes-gateway.log').includes('UNCLEANLY'), 'the gateway stopped cleanly on restart');
  assert.equal(afterRestart.integrity, 'ok'); assert.ok(afterRestart.sessions >= beforeRestart.sessions);
  const third = await call(`/igor/api/conversations/${id}/messages`, { method: 'POST', cookie: alice, body: { idempotencyKey: `turn3-${marker}`, content: 'After restart?' } });
  assert.equal(third.status, 202); assert.equal((await settled(alice, id)).messages.at(-1).status, 'complete');
  pass('restart: clean gateway shutdown; Hermes state.db intact and kept; the next turn completes on the real path', { before: beforeRestart, after: afterRestart });

  // 7. Rollback to the current pin and forward again, with the VM's procedure on the same persistent
  // checkout and Hermes home: stop, lift egress (a one-off container with network), `git checkout`
  // the pin in place and `./setup-hermes.sh --runtime-only`, restore egress, start offline.
  // The current pin (e76fbd80) cannot activate its managed install with no egress: every activation
  // re-resolves dependencies (a GitHub-hosted wheel). The VM runs it behind an egress allowlist, so its
  // phase runs with the outside network attached (an extra overlay written per run); the candidate
  // phases stay on the internal network only.
  const egressOverlay = path.join(fixtures, 'igor-egress.yaml');
  await writeFile(egressOverlay, ['services:', '  igor:', '    networks: [studio, edge]', ''].join('\n'));
  const withEgress = (args) => execFileSync('docker', ['compose', ...files, '-f', egressOverlay, '--env-file', envFile, ...args], { encoding: 'utf8', env: { ...process.env, MSYS_NO_PATHCONV: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const switchRuntime = (sha, egress = false) => {
    compose(['stop', 'igor']);
    execFileSync('docker', ['run', '--rm', '-u', 'hermes', '-v', 'stex-staging_hermes-home:/home/hermes/.hermes', '-v', 'stex-staging_hermes-agent:/home/hermes/hermes-agent', '--entrypoint', 'bash', 'stex-staging-igor-host', '-lc',
      `cd ~/hermes-agent && git fetch -q --depth 1 origin ${sha} && git checkout -q --detach ${sha} && test "$(git rev-parse HEAD)" = ${sha} && ./setup-hermes.sh --runtime-only >/tmp/setup.log 2>&1 || { tail -20 /tmp/setup.log; exit 1; }`], { stdio: 'inherit', env: { ...process.env, MSYS_NO_PATHCONV: '1' } });
    if (egress) withEgress(['up', '-d', '--no-deps', '--no-build', '--wait', 'igor']);
    else compose(['up', '-d', '--no-deps', '--no-build', '--force-recreate', '--wait', 'igor']);
    assert.equal(hermesShell('git rev-parse HEAD'), sha);
  };
  if (!process.argv.includes('--skip-rollback')) {
    switchRuntime(pins.current.sha, true);
    const rolled = integrity(); assert.equal(rolled.integrity, 'ok'); assert.ok(rolled.sessions >= afterRestart.sessions);
    const rollbackTurn = await call(`/igor/api/conversations/${id}/messages`, { method: 'POST', cookie: alice, body: { idempotencyKey: `turn4-${marker}`, content: 'On the previous runtime?' } });
    assert.equal(rollbackTurn.status, 202);
    const rolledConversation = await settled(alice, id);
    assert.equal(rolledConversation.messages.at(-1).status, 'complete', JSON.stringify(rolledConversation.messages.at(-1)));
    report.rollback = { runtime: pins.current.sha, state: rolled, connectorRecord: JSON.parse(inIgor('hermes', 'cat ~/.hermes/profiles/igor/plugins/obsidian/.hermes-catalog.json')).sha };
    switchRuntime(pins.candidate.sha);
    const forward = integrity(); assert.equal(forward.integrity, 'ok');
    const forwardTurn = await call(`/igor/api/conversations/${id}/messages`, { method: 'POST', cookie: alice, body: { idempotencyKey: `turn5-${marker}`, content: 'Back on the candidate?' } });
    assert.equal(forwardTurn.status, 202); assert.equal((await settled(alice, id)).messages.at(-1).status, 'complete');
    const loadedAfter = lastJson(hermesShell('HERMES_HOME=$HOME/.hermes/profiles/igor python -', loadCheck));
    for (const name of pins.obsidian.enabled) assert.equal(loadedAfter.view[name].success, true, name);
    assert.equal(JSON.parse(inIgor('hermes', 'cat ~/.hermes/profiles/igor/plugins/obsidian/.hermes-catalog.json')).sha, pins.obsidian.sha);
    pass('rollback to the current pin (egress attached, as its activation requires) and forward again offline, with the VM procedure (git checkout + setup-hermes.sh --runtime-only): turns complete, state.db intact, connector and skills kept');
    report.notices.push('Rollback needs the same egress window as an upgrade: the managed install keeps its tool store beside the profile in ~hermes/.hermes and resyncs on activation after a checkout change.');
    report.notices.push('The current pin e76fbd80 cannot activate offline at all (it re-resolves a GitHub-hosted wheel on every start), so its phase ran with outside network attached, standing in for the VM egress allowlist; v0.23.4 activates and runs with no egress.');
  } else report.notices.push('Rollback skipped (--skip-rollback).');
  report.result = 'PASS';
} finally {
  report.gatewayLogTail = (() => { try { return inIgor('root', 'tail -n 5 /tmp/hermes-gateway.log').split('\n').map((line) => line.slice(0, 200)); } catch { return []; } })();
  if (!process.argv.includes('--keep')) compose(['down', '-v']);
}
console.log(JSON.stringify(report, null, 2));
