import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { workspaceApi, workspaceVersion } from '../src/workspace-api.mjs';
import { SeaxneatStore, defaultRunner } from '../src/project-store.mjs';

async function fixture(context) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'stex-workspace-api-'));
  const control = { fail: false, hold: null };
  const runner = async (command, args, cwd, options) => {
    if (command === 'pnpm' || args.includes('pnpm')) {
      if (control.hold) await control.hold;
      return { ok: !control.fail, stdout: '', stderr: control.fail ? 'Fixture build failure' : '' };
    }
    return defaultRunner(command, args, cwd, options);
  };
  const store = await new SeaxneatStore({ root, runner, previewStarter: async () => ({ state: 'starting', target: 'http://127.0.0.1:9999' }) }).initialize();
  const handler = workspaceApi(store, {
    body: async (request) => { let raw = ''; for await (const part of request) raw += part; return JSON.parse(raw); },
    send: (response, status, value) => { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(value)); },
  });
  const server = http.createServer((request, response) => handler(request, response, new URL(request.url, 'http://localhost')));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(async () => { await new Promise((resolve) => server.close(resolve)); await rm(root, { recursive: true, force: true }); });
  const api = async (route, payload, method) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/stex/workspace/v1${route}`, { method: method || (payload === undefined ? 'GET' : 'POST'), headers: { 'content-type': 'application/json' }, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) });
    const value = await response.json(); assert.equal(value.schemaVersion, workspaceVersion);
    return { status: response.status, ...value };
  };
  return { store, api, control };
}

test('versioned engine workflow preserves proposals, validated history, diff and preview references', async (context) => {
  const { store, api } = await fixture(context);
  const created = await api('/projects', { title: 'Platform fixture' }); assert.equal(created.status, 201);
  const project = created.result; const route = '/projects/' + project.id;
  assert.equal((await api('/projects')).result.length, 1);
  const proposed = await api(route + '/proposal', { message: 'Revised heading' });
  assert.equal((await api(route + '/proposal')).result.id, proposed.result.id);
  assert.equal((await api(route + '/apply', { proposalId: proposed.result.id })).result.revisionCount, 2);
  assert.match((await api(route + '/diff?revision=' + project.revisions[0].id)).result.diff, /Revised heading/);
  assert.equal((await api(route + '/restore', { revision: project.revisions[0].id })).result.revisionCount, 3);
  assert.match(await readFile(store.pagePath(project.id), 'utf8'), /Platform fixture/);
  const preview = await api(route + '/preview', {});
  assert.deepEqual(preview.result, { state: 'starting', path: `/seaxneat/api/projects/${project.id}/preview/` });
  assert.equal(JSON.stringify(preview).includes('9999'), false);
  assert.equal(JSON.stringify(await api('/projects')).includes('9999'), false);
  assert.equal(JSON.stringify(await api(route)).includes('9999'), false);
  const next = await api(route + '/proposal', { message: 'Dismiss this' });
  await api(route + '/dismiss', { proposalId: next.result.id });
  assert.equal((await api(route + '/proposal')).result, null);
});

test('stale and failed edits never advance the validated revision; failed setup returns visible null revision', async (context) => {
  const { store, api, control } = await fixture(context);
  const project = (await api('/projects', { title: 'Origin' })).result;
  const route = '/projects/' + project.id;
  const proposal = (await api(route + '/proposal', { message: 'Proposed' })).result;
  const before = await readFile(store.pagePath(project.id), 'utf8');
  await writeFile(store.pagePath(project.id), '// changed externally\n');
  const stale = await api(route + '/apply', { proposalId: proposal.id }); assert.equal(stale.status, 409); assert.equal(stale.code, 'STALE_PROPOSAL');
  await writeFile(store.pagePath(project.id), before);
  control.fail = true;
  const failed = await api(route + '/apply', { proposalId: proposal.id }); assert.equal(failed.status, 422);
  assert.equal((await api(route)).result.lastValidatedRevision, project.lastValidatedRevision);
  assert.equal(await readFile(store.pagePath(project.id), 'utf8'), before);
  const setup = await api('/projects', { title: 'Failed setup' });
  assert.equal(setup.result.lastValidatedRevision, null); assert.equal(setup.result.operation.state, 'failed');
});

test('rejects malformed input, unsupported methods, unknown projects, and concurrent mutations', async (context) => {
  const { api, control } = await fixture(context);
  for (const payload of [null, [], { title: 12 }, { title: 'x'.repeat(121) }]) assert.equal((await api('/projects', payload)).status, 400);
  assert.equal((await api('/projects', undefined, 'DELETE')).status, 405);
  assert.equal((await api('/projects/absent')).status, 404);
  assert.equal((await api('/projects/absent/unknown')).status, 404);
  let release;
  control.hold = new Promise((resolve) => { release = resolve; });
  const first = api('/projects', { title: 'One at a time' });
  // The first handler reaches the held runner before the second request.
  await new Promise((resolve) => setTimeout(resolve, 50));
  const second = await api('/projects', { title: 'Concurrent' });
  release(); assert.equal(second.status, 409); assert.equal((await first).status, 201);
});
