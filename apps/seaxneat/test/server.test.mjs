import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('engine refuses foreign/opaque browser origins and rebinding, redirects presentation, and sandboxes preview responses', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'stex-seaxneat-server-'));
  let escape = false;
  const preview = http.createServer((request, response) => {
    if (escape) { response.writeHead(302, { location: '/igor/' }); response.end(); return; }
    if (request.url.endsWith('/')) { response.writeHead(308, { location: request.url.slice(0, -1) }); response.end(); return; }
    response.writeHead(200, { 'content-type': 'text/html' }); response.end('<h1>Generated fixture</h1>');
  });
  await new Promise((resolve) => preview.listen(0, '127.0.0.1', resolve));
  await writeFile(path.join(root, 'state.json'), JSON.stringify({ schemaVersion: 1, projects: [{ id: 'fixture', title: 'Fixture', revisions: [], messages: [], operation: { state: 'idle' }, preview: { target: `http://127.0.0.1:${preview.address().port}` } }] }));
  const child = spawn(process.execPath, ['server.mjs'], { cwd: new URL('../', import.meta.url), env: { ...process.env, STEX_SEAXNEAT_DATA_DIR: root, SEAXNEAT_PORT: '4495', STEX_PANTHEON_URL: 'http://127.0.0.1:4496' }, windowsHide: true });
  context.after(async () => { const exited = new Promise((resolve) => child.once('exit', resolve)); child.kill(); await exited; await new Promise((resolve) => preview.close(resolve)); await rm(root, { recursive: true, force: true }); });
  await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Seaxneat did not start')), 5000); child.stdout.on('data', (data) => { if (data.toString().includes('ready')) { clearTimeout(timer); resolve(); } }); child.once('error', reject); });
  const base = 'http://127.0.0.1:4495';
  for (const origin of ['null', 'https://foreign.invalid', 'http://127.0.0.1:9999']) {
    const response = await fetch(base + '/seaxneat/api/stex/workspace/v1/projects', { method: 'POST', headers: { origin, 'content-type': 'text/plain', 'x-forwarded-host': origin.replace('http://', '') }, body: '{"title":"Forbidden"}' });
    assert.equal(response.status, 403);
  }
  const allowed = await fetch(base + '/seaxneat/api/stex/workspace/v1/projects', { headers: { origin: 'http://127.0.0.1:4496' } });
  assert.equal(allowed.status, 200);
  const rebound = await new Promise((resolve, reject) => { http.get(base + '/api/health', { headers: { host: 'foreign.invalid' } }, (response) => { response.resume(); resolve(response.statusCode); }).on('error', reject); });
  assert.equal(rebound, 403);
  const redirect = await fetch(base + '/seaxneat/?project=fixture', { redirect: 'manual' });
  assert.equal(redirect.headers.get('location'), 'http://127.0.0.1:4496/workspaces/seaxneat/?project=fixture');
  const generated = await fetch(base + '/seaxneat/api/projects/fixture/preview/');
  assert.equal(generated.headers.get('content-security-policy'), "sandbox allow-scripts; frame-ancestors 'self'");
  assert.equal(generated.headers.get('x-content-type-options'), 'nosniff');
  assert.match(await generated.text(), /Generated fixture/);
  const opaqueAsset = await fetch(base + '/seaxneat/api/projects/fixture/preview/_next/static/fixture.js', { headers: { origin: 'null', 'sec-fetch-site': 'cross-site' } });
  assert.equal(opaqueAsset.status, 200); assert.equal(opaqueAsset.headers.get('access-control-allow-origin'), 'null');
  const opaqueApi = await fetch(base + '/seaxneat/api/stex/workspace/v1/projects', { headers: { origin: 'null', 'sec-fetch-site': 'cross-site' } });
  assert.equal(opaqueApi.status, 403);
  escape = true;
  const blocked = await fetch(base + '/seaxneat/api/projects/fixture/preview/');
  assert.equal(blocked.status, 502); assert.equal(blocked.headers.get('location'), null);
});
