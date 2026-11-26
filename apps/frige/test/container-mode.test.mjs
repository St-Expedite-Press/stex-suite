/**
 * Frige container mode (separation milestone M1): STEX_INTERNAL_HOSTS admits
 * exactly `<name>:<this port>` as a Host; everything else stays refused, and
 * native runs keep loopback Host names only. Synthetic empty books directory.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const appDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** A free loopback port. */
async function freePort() {
  const server = http.createServer(); await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address(); await new Promise((resolve) => server.close(resolve)); return port;
}

/** Starts Frige; resolves when ready or with its refusal. */
function startFrige(root, port, environment = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['server.mjs'], { cwd: appDirectory, env: { ...process.env, STEX_FRIGE_PORT: String(port), STEX_FRIGE_BOOKS_DIR: path.join(root, 'books'), STEX_FRIGE_PROJECT_DIR: path.join(root, 'local'), STEX_FRIGE_PROJECTS_DIR: path.join(root, 'projects'), STEX_FRIGE_BASE_PATH: '/frige', STEX_FRIGE_INFERENCE_MODE: 'fake', ...environment } });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; if (output.includes('Frige Studio is ready')) resolve({ child, output }); });
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.on('exit', (code) => resolve({ child: null, code, output }));
  });
}

/** GETs a Frige route with an explicit Host header. */
function get(port, host) {
  return new Promise((resolve, reject) => {
    const request = http.request({ hostname: '127.0.0.1', port, path: '/frige/api/books', headers: { host } }, (response) => { response.resume(); resolve(response.statusCode); });
    request.once('error', reject); request.end();
  });
}

test('container Host names are accepted only when named and only on Frige\'s own port', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'stex-frige-container-'));
  const port = await freePort();
  const native = await startFrige(root, port);
  assert.ok(native.child, native.output);
  try {
    assert.equal(await get(port, `127.0.0.1:${port}`), 200);
    assert.equal(await get(port, `frige:${port}`), 403, 'native runs refuse container names');
  } finally { native.child.kill(); await new Promise((resolve) => native.child.once('exit', resolve)); }
  const container = await startFrige(root, port, { STEX_INTERNAL_HOSTS: 'frige' });
  assert.ok(container.child, container.output);
  try {
    assert.equal(await get(port, `frige:${port}`), 200);
    assert.equal(await get(port, `localhost:${port}`), 200);
    assert.equal(await get(port, 'frige:1'), 403, 'another port is refused');
    assert.equal(await get(port, `platform:${port}`), 403, 'an unnamed peer is refused');
    assert.equal(await get(port, `frige.example.com:${port}`), 403);
  } finally { container.child.kill(); await new Promise((resolve) => container.child.once('exit', resolve)); await rm(root, { recursive: true, force: true }); }
  const refused = await startFrige(root, port, { STEX_INTERNAL_HOSTS: 'Frige.example' });
  assert.equal(refused.child, null); assert.match(refused.output, /invalid service name/);
  const badBind = await startFrige(root, port, { STEX_BIND_ALL: 'true' });
  assert.equal(badBind.child, null); assert.match(badBind.output, /STEX_BIND_ALL must be 1 or unset/);
});
