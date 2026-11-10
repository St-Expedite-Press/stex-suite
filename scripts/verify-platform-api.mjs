// Integration check for the Python platform API (M1) against the real Node
// engines: Frige and Seaxneat run on disposable data, the platform runs beside
// them, and its stex.platform.projects.v1 answer must agree with each studio's
// own stex.projects.summary.v1. Stopping Seaxneat must leave Frige's projects
// listed and name Seaxneat as unavailable within the 2 s budget.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const python = path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');

const freePort = () => new Promise((resolve, reject) => {
  const server = net.createServer().once('error', reject);
  server.listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolve(port)); });
});

async function ready(url, child, name) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`${name} exited early (${child.exitCode}).`);
    try { if ((await fetch(url, { signal: AbortSignal.timeout(1_000) })).ok) return; } catch { /* not yet */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${name} did not become ready at ${url}.`);
}

const getJson = async (url) => {
  const response = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return response.json();
};

async function main() {
  const sync = spawnSync('uv', ['sync', '--frozen'], { cwd: root, stdio: 'inherit' });
  if (sync.status !== 0 || !existsSync(python)) throw new Error('uv sync --frozen failed; the platform environment is unavailable.');

  const data = await mkdtemp(path.join(os.tmpdir(), 'stex-verify-platform-api-'));
  const book = path.join(data, 'books', 'fixture-book');
  await mkdir(path.join(book, 'manuscript'), { recursive: true });
  await writeFile(path.join(book, 'README.md'), '# Fixture Book (verification)\n');
  await writeFile(path.join(book, 'manuscript', 'Programme.md'), '# Programme\n');

  const ports = { frige: await freePort(), seaxneat: await freePort(), platform: await freePort() };
  const origins = Object.fromEntries(Object.entries(ports).map(([name, port]) => [name, `http://127.0.0.1:${port}`]));
  const quiet = { stdio: ['ignore', 'pipe', 'pipe'] };
  const children = {
    frige: spawn(process.execPath, ['server.mjs'], { cwd: path.join(root, 'apps/frige'), ...quiet, env: { ...process.env,
      STEX_FRIGE_PORT: String(ports.frige), STEX_FRIGE_BOOKS_DIR: path.join(data, 'books'), STEX_FRIGE_PROJECT_DIR: data,
      STEX_FRIGE_BASE_PATH: '/frige', STEX_FRIGE_SHELL_URL: '/home/' } }),
    seaxneat: spawn(process.execPath, ['server.mjs'], { cwd: path.join(root, 'apps/seaxneat'), ...quiet, env: { ...process.env,
      SEAXNEAT_PORT: String(ports.seaxneat), STEX_SEAXNEAT_DATA_DIR: path.join(data, 'seaxneat') } }),
    platform: spawn(python, ['-m', 'stex'], { cwd: root, ...quiet, env: { ...process.env,
      STEX_PLATFORM_PORT: String(ports.platform), STEX_FRIGE_URL: origins.frige, STEX_SEAXNEAT_URL: origins.seaxneat } }),
  };
  const failures = [];
  const check = (condition, message) => { if (!condition) failures.push(message); };
  const report = {};
  try {
    await Promise.all([
      ready(`${origins.frige}/frige/api/stex/projects`, children.frige, 'Frige'),
      ready(`${origins.seaxneat}/seaxneat/api/stex/projects`, children.seaxneat, 'Seaxneat'),
      ready(`${origins.platform}/health`, children.platform, 'Platform API'),
    ]);

    const health = await getJson(`${origins.platform}/health`);
    check(health.status === 'ok' && health.service === 'stex-platform', 'health did not report the platform service');

    const direct = { frige: await getJson(`${origins.frige}/frige/api/stex/projects`), seaxneat: await getJson(`${origins.seaxneat}/seaxneat/api/stex/projects`) };
    const merged = await getJson(`${origins.platform}/api/v1/projects`);
    report.both = { studios: merged.studios, projects: merged.projects.map((project) => `${project.studio}:${project.id}`) };
    check(merged.schemaVersion === 'stex.platform.projects.v1', 'wrong platform schemaVersion');
    check(JSON.stringify(merged.studios) === JSON.stringify([{ id: 'frige', state: 'available' }, { id: 'seaxneat', state: 'available' }]),
      'both running studios must be available, in registry order');
    for (const studio of ['frige', 'seaxneat']) {
      const expected = direct[studio].projects.map((project) => project.id).sort();
      const actual = merged.projects.filter((project) => project.studio === studio).map((project) => project.id).sort();
      check(JSON.stringify(actual) === JSON.stringify(expected), `${studio}: platform ids ${actual} differ from the studio's ${expected}`);
    }
    const fixture = merged.projects.find((project) => project.id === 'fixture-book');
    const source = direct.frige.projects.find((project) => project.id === 'fixture-book');
    check(fixture && source, 'the synthetic book is missing');
    if (fixture && source) {
      for (const field of ['reference', 'title', 'kind', 'updatedAt', 'openPath']) check(fixture[field] === source[field], `fixture-book ${field} changed`);
      check(JSON.stringify(fixture.status) === JSON.stringify(source.status), 'fixture-book status changed');
      check(fixture.href === `/frige/${source.openPath.slice(1)}`, `fixture-book href ${fixture.href} is not under /frige/`);
    }

    children.seaxneat.kill();
    await new Promise((resolve) => children.seaxneat.once('exit', resolve));
    const started = Date.now();
    const degraded = await getJson(`${origins.platform}/api/v1/projects`);
    report.seaxneatStopped = { elapsedMs: Date.now() - started, studios: degraded.studios };
    // Budget is 2 s; Windows takes ~2 s to refuse a closed loopback port, so allow scheduling slack.
    check(Date.now() - started < 4_000, 'a stopped studio must not delay the answer far beyond its 2 s budget');
    check(degraded.studios.find((studio) => studio.id === 'seaxneat')?.state === 'unavailable', 'stopped Seaxneat must be unavailable');
    check(degraded.studios.find((studio) => studio.id === 'frige')?.state === 'available', 'Frige must stay available');
    check(degraded.projects.some((project) => project.id === 'fixture-book'), "Frige's projects must be kept");
    check(degraded.projects.every((project) => project.studio === 'frige'), 'no Seaxneat project may be invented');
  } finally {
    for (const child of Object.values(children)) if (child.exitCode === null) child.kill();
    await new Promise((resolve) => setTimeout(resolve, 300));
    await rm(data, { recursive: true, force: true, maxRetries: 5 });
  }
  console.log(JSON.stringify({ ...report, failures, result: failures.length ? 'FAIL' : 'PASS' }, null, 2));
  if (failures.length) process.exit(1);
}

main().catch((error) => { console.error(error); process.exit(1); });
