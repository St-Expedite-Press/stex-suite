/**
 * Seaxneat regression tests for the preview lifecycle and restore safety.
 *
 * Ownership: the Seaxneat engine. They use a fake runner and a fake preview
 * starter/stopper (no Next, no ports), so they prove the store's state machine
 * and byte handling only; the real process and CSP behaviour is proven by
 * `corepack pnpm run verify:platform`.
 */
import assert from 'node:assert/strict';
import net from 'node:net';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { SeaxneatStore, defaultRunner } from '../src/project-store.mjs';
import { candidatePorts, firstFreePort, portInUse, PREVIEW_PORT_BASE, PREVIEW_PORT_SPAN } from '../src/preview-port.mjs';
import { PREVIEW_CONTENT_SECURITY_POLICY } from '../src/preview-proxy.mjs';

/**
 * Builds a store whose package commands succeed unless `control.fail` is set
 * and whose preview starter/stopper only record calls.
 * @param {import('node:test').TestContext} context
 */
async function fixture(context) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'stex-seaxneat-preview-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const control = { fail: false, calls: [], startFails: false };
  /** Simulates package commands; Git runs for real. */
  const runner = async (command, args, cwd, options) => (command === 'pnpm' || args?.includes('pnpm'))
    ? { ok: !control.fail, stdout: '', stderr: control.fail ? 'Fixture build failure' : '' }
    : defaultRunner(command, args, cwd, options);
  /** Records a start request. */
  const previewStarter = async () => { control.calls.push('start'); if (control.startFails) throw new Error('boom: EADDRINUSE'); return { state: 'running', target: 'http://127.0.0.1:9999' }; };
  /** Records a stop request. */
  const previewStopper = async () => { control.calls.push('stop'); };
  const store = await new SeaxneatStore({ root, runner, previewStarter, previewStopper }).initialize();
  return { store, control };
}

test('a failed restore build returns the draft to its pre-restore bytes and does not advance validation', async (context) => {
  const { store, control } = await fixture(context);
  const project = await store.create({ title: 'Origin' }); const seed = store.get(project.id).revisions[0];
  const proposal = await store.proposal(project.id, { message: 'Changed heading' }); await store.apply(project.id, proposal.id);
  const before = await readFile(store.pagePath(project.id), 'utf8'); const validated = store.get(project.id).lastValidatedRevision; const revisions = store.get(project.id).revisions.length;
  control.fail = true;
  await assert.rejects(() => store.restore(project.id, seed.id), (error) => error.code === 'BUILD_FAILED' && /returned to its source before the restore/.test(error.message));
  assert.equal(await readFile(store.pagePath(project.id), 'utf8'), before, 'restored source must not stay behind');
  assert.equal(store.get(project.id).lastValidatedRevision, validated); assert.equal(store.get(project.id).revisions.length, revisions);
  assert.equal(store.get(project.id).operation.state, 'failed');
});

test('a successful build restarts a live preview; a failed one leaves it stopped', async (context) => {
  const { store, control } = await fixture(context);
  const project = await store.create({ title: 'Live' }); await store.startPreview(project.id); control.calls.length = 0;
  const proposal = await store.proposal(project.id, { message: 'New' }); await store.apply(project.id, proposal.id);
  assert.deepEqual(control.calls, ['stop', 'start'], 'stopped before the build, started after it');
  assert.equal(store.get(project.id).preview.state, 'running');
  control.calls.length = 0; control.fail = true;
  const next = await store.proposal(project.id, { message: 'Bad' });
  await assert.rejects(() => store.apply(project.id, next.id), /Build failed/);
  assert.deepEqual(control.calls, ['stop']); assert.equal(store.get(project.id).preview.state, 'stopped'); assert.equal(store.get(project.id).preview.target, null);
});

test('a build with no live preview does not start one', async (context) => {
  const { store, control } = await fixture(context);
  const project = await store.create({ title: 'Quiet' }); await store.build(store.get(project.id));
  assert.deepEqual(control.calls, []);
});

test('stopPreview stops the process, records stopped without a target, and is idempotent', async (context) => {
  const { store, control } = await fixture(context);
  const project = await store.create({ title: 'Stop' }); await store.startPreview(project.id);
  assert.equal((await store.stopPreview(project.id)).state, 'stopped'); assert.equal((await store.stopPreview(project.id)).target, null);
  assert.deepEqual(control.calls, ['start', 'stop', 'stop']);
});

test('a failed start is recorded as failed with no target and rethrown', async (context) => {
  const { store, control } = await fixture(context);
  const project = await store.create({ title: 'Fail' }); control.startFails = true;
  await assert.rejects(() => store.startPreview(project.id), /boom/);
  assert.equal(store.get(project.id).preview.state, 'failed'); assert.equal(store.get(project.id).preview.target, null);
});

test('a persisted live preview is stopped on restart because its process is gone', async (context) => {
  const { store } = await fixture(context);
  const project = await store.create({ title: 'Restart' }); await store.startPreview(project.id);
  const reopened = await new SeaxneatStore({ root: store.root, runner: store.runner }).initialize();
  assert.equal(reopened.get(project.id).preview.state, 'stopped'); assert.equal(reopened.get(project.id).preview.target, null);
});

test('candidate preview ports are stable, bounded and wrap inside the range', () => {
  const ports = candidatePorts('some-project-abc123', 25);
  assert.deepEqual(ports, candidatePorts('some-project-abc123', 25)); assert.equal(new Set(ports).size, 25);
  for (const port of ports) assert.ok(port >= PREVIEW_PORT_BASE && port < PREVIEW_PORT_BASE + PREVIEW_PORT_SPAN);
});

test('firstFreePort skips taken ports and fails after the bounded range', async () => {
  const taken = new Set([4400, 4401]);
  assert.equal(await firstFreePort([4400, 4401, 4402], async (port) => taken.has(port)), 4402);
  assert.equal(await firstFreePort([4400, 4402], async () => false, new Set([4400])), 4402);
  await assert.rejects(() => firstFreePort([4400, 4401], async () => true), (error) => error.code === 'NO_PREVIEW_PORT');
});

test('portInUse detects a real foreign listener and a free port', async () => {
  const server = net.createServer(); await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  assert.equal(await portInUse(port), true);
  await new Promise((resolve) => server.close(resolve));
  assert.equal(await portInUse(port), false);
});

test('the preview CSP confines connections and navigation vectors', () => {
  const directives = PREVIEW_CONTENT_SECURITY_POLICY.split('; ');
  for (const required of ['sandbox allow-scripts', "frame-ancestors 'self'", "default-src 'self'", "connect-src 'self'", "form-action 'none'", "base-uri 'none'", "object-src 'none'"]) assert.ok(directives.includes(required), required);
  assert.doesNotMatch(PREVIEW_CONTENT_SECURITY_POLICY, /allow-same-origin|https?:|\*/);
});
