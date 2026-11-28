/** Suite acceptance source that exercises opt-in consent, provenance and lifecycle in the browser. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { repositoryRoot } from '../assets/manifest.mjs';
import { launchBrowser, outDirectoryFromArgs, page, started } from './browser/devtools.mjs';

const out = outDirectoryFromArgs('stex-knowledge-verification');
const data = await mkdtemp(path.join(os.tmpdir(), 'stex-knowledge-browser-'));
const manuscript = path.join(data, 'books', 'fixture-book', 'manuscript');
await mkdir(manuscript, { recursive: true }); await mkdir(out, { recursive: true });
const source = '# Knowledge fixture\n\n  A synthetic source — exact Unicode.\n';
await writeFile(path.join(manuscript, 'Source.md'), source);
await writeFile(path.join(manuscript, 'Programme.md'), '# Programme\n\n- [Source](Source.md)\n');
const base = 'http://127.0.0.1:4442'; const reference = 'stex://frige/project/fixture-book';
/** Reads the current source and metadata for a selected graph node. */
const node = (dir, env) => spawn(process.execPath, ['server.mjs'], { cwd: path.join(repositoryRoot, dir), windowsHide: true, env: { ...process.env, ...env } });
const children = [];
// --platform: the Python platform API owns the journal (STEX_KNOWLEDGE_SERVICE=platform)
// and Pantheon only relays; otherwise Pantheon's in-process library, exactly as before.
const viaPlatform = process.argv.includes('--platform');
/** Starts the Python platform API that owns the journal in --platform mode. */
// The virtual environment's interpreter directly, so stopping it stops the journal writer (uv would leave a child).
const platformPython = path.join(repositoryRoot, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const startPlatform = () => spawn(platformPython, ['-m', 'stex'], { cwd: repositoryRoot, windowsHide: true, env: { ...process.env, STEX_PLATFORM_PORT: '4443', STEX_FRIGE_URL: 'http://127.0.0.1:4441', STEX_KNOWLEDGE_DATA_DIR: path.join(data, 'knowledge') } });
/** Starts Pantheon with disposable roots and waits for readiness. */
const startPantheon = () => node('apps/pantheon', viaPlatform
  ? { STEX_PANTHEON_PORT: '4442', STEX_FRIGE_URL: 'http://127.0.0.1:4441', STEX_PLATFORM_URL: 'http://127.0.0.1:4443', STEX_KNOWLEDGE_SERVICE: 'platform', STEX_KNOWLEDGE_DATA_DIR: '' }
  : { STEX_PANTHEON_PORT: '4442', STEX_FRIGE_URL: 'http://127.0.0.1:4441', STEX_KNOWLEDGE_DATA_DIR: path.join(data, 'knowledge') });
/** Starts whichever process owns the journal (restarted to prove rebuild from disk). */
const startOwner = () => (viaPlatform ? startPlatform() : startPantheon());
const ownerReady = viaPlatform ? /Uvicorn running/ : /ready/i;
children.push(node('apps/frige', { STEX_FRIGE_PORT: '4441', STEX_FRIGE_BASE_PATH: '/frige', STEX_FRIGE_BOOKS_DIR: path.join(data, 'books'), STEX_FRIGE_PROJECT_DIR: path.join(data, 'default'), STEX_PANTHEON_URL: base }));
if (viaPlatform) children.push(startPantheon());
children.push(startOwner());
const report = { mode: viaPlatform ? 'platform API owns the journal; Pantheon relays' : 'Pantheon in-process journal', workflow: [], viewports: [], limits: ['Chrome only; synthetic local sources; no inference or provider calls'] };
let browser;
/** Sends a request to the owning HTTP API and returns its decoded result. */
async function api(route = '', body) { const response = await fetch(base + '/api/knowledge/v1' + route, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: response.status, value: await response.json() }; }
try {
  await Promise.all(children.map((child, index) => started(child, index === children.length - 1 ? ownerReady : /ready/i, 'Knowledge stack')));
  browser = await launchBrowser(); const tab = await page(browser.devtools);
  /** Waits for the named UI or HTTP observation before asserting it. */
  const wait = async (expression) => { for (let i = 0; i < 150; i++) { if (await tab.evaluate(`Boolean(${expression})`).catch(() => false)) return; await new Promise((r) => setTimeout(r, 50)); } throw Error('Timed out: ' + expression); };
  /** Activates a visible control by its label. */
  const clickText = (text) => tab.evaluate(`[...document.querySelectorAll('button')].find(node => node.textContent === ${JSON.stringify(text)}).click()`);
  await tab.go(base + '/graph/'); await wait(`document.querySelector('[name="project"]')`);
  await tab.evaluate(`document.querySelector('[name="project"]').value = ${JSON.stringify(reference)}; document.querySelector('[name="project"]').form.requestSubmit()`);
  await wait(`document.querySelector('[name="source"]')`);
  await tab.evaluate(`[...document.querySelectorAll('[name="source"]')].at(-1).click()`);
  await clickText('Accept selected revisions'); await wait(`document.querySelector('#knowledge-notice').textContent.includes('updated')`);
  let view = (await api()).value;
  assert.equal(view.knowledge.sources.length, 1); assert.equal(view.graph.projects.length, 1); assert.equal(view.knowledge.sources[0].access, 'current');
  report.workflow.push('browser selection updates both source and project projections');
  const metadata = view.knowledge.sources[0];
  await tab.evaluate(`document.querySelector('[name="subject"]').value = ${JSON.stringify(reference)}; document.querySelector('[name="predicate"]').value = 'explores'; document.querySelector('[name="object"]').value = 'Synthetic concept'; document.querySelector('[name="kind"]').value = 'inference'; document.querySelector('[name="subject"]').form.requestSubmit()`);
  await wait(`document.querySelector('#knowledge-content').textContent.includes('inference · proposed')`);
  await clickText('Reject relationship'); await wait(`document.querySelector('#knowledge-content').textContent.includes('inference · rejected')`);
  report.workflow.push('evidenced inference stays proposed until review and can be rejected');
  view = (await api()).value;
  const revoked = await api('/revoke', { expectedVersion: view.version, idempotencyKey: 'browser-revoke-consent', project: reference }); assert.equal(revoked.status, 200);
  const renewed = await api('/accept', { expectedVersion: revoked.value.version, idempotencyKey: 'browser-renew-consent', project: reference, sources: [{ id: metadata.id, revision: metadata.revision }] }); assert.equal(renewed.status, 200); assert.equal(renewed.value.knowledge.sources.length, 1);
  report.workflow.push('withdrawal and explicit renewed consent work for unchanged source revisions');
  view = renewed.value;
  const stale = await api('/accept', { expectedVersion: view.version, idempotencyKey: 'browser-stale-event', project: reference, sources: [{ id: metadata.id, revision: '0'.repeat(64) }] });
  assert.equal(stale.status, 409);
  await writeFile(path.join(manuscript, 'Source.md'), source + '\nAccepted local revision.\n');
  const inaccessible = (await api()).value; assert.equal(inaccessible.knowledge.sources[0].access, 'unavailable'); assert.equal(inaccessible.graph.relations[0].evidenceState, 'unavailable');
  const catalog = (await api('/sources?project=' + encodeURIComponent(reference))).value;
  const entry = catalog.sources.find((s) => s.id === metadata.id);
  const payload = { expectedVersion: inaccessible.version, idempotencyKey: 'browser-new-revision', project: reference, sources: [{ id: entry.id, revision: entry.revision }] };
  const accepted = await api('/accept', payload); assert.equal(accepted.status, 200);
  const replay = await api('/accept', payload); assert.equal(replay.status, 200); assert.equal(replay.value.version, accepted.value.version);
  report.workflow.push('changed revisions become unavailable, stale imports fail, explicit refresh advances once and replay is idempotent');
  const exported = (await api('/export')).value; assert.ok(!JSON.stringify(exported).includes('A synthetic source')); assert.ok(!JSON.stringify(exported).includes('Accepted local revision'));
  const old = children.pop(); const exited = new Promise((r) => old.once('exit', r)); old.kill(); await exited;
  children.push(startOwner()); await started(children.at(-1), ownerReady, 'Restarted knowledge stack');
  assert.equal((await api()).value.version, accepted.value.version);
  report.workflow.push('restart rebuild preserves accepted state; export contains provenance without source text');
  await tab.go(base + '/graph/'); await wait(`document.querySelector('[name="project"]')`);
  for (const [width, height] of [[1440, 900], [1024, 768], [768, 1024], [390, 844]]) {
    await tab.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 768 });
    assert.ok(await tab.evaluate(`document.documentElement.scrollWidth <= ${width}`));
    const { data: shot } = await tab.send('Page.captureScreenshot', { format: 'png' }); await writeFile(path.join(out, `knowledge-${width}.png`), Buffer.from(shot, 'base64')); report.viewports.push({ width, height, overflow: false });
  }
  await tab.evaluate('window.confirm = () => true'); await clickText('Delete all knowledge');
  await wait(`document.querySelector('#knowledge-content').textContent.includes('No project knowledge has been accepted.')`);
  assert.equal((await api()).value.knowledge.sources.length, 0);
  assert.equal(await readFile(path.join(manuscript, 'Source.md'), 'utf8'), source + '\nAccepted local revision.\n');
  report.workflow.push('explicit deletion clears knowledge while canonical source stays byte-for-byte intact');
  const denied = await fetch(base + '/api/knowledge/v1', { headers: { origin: 'null' } }); assert.equal(denied.status, 403);
  if (viaPlatform) {
    // The platform's configured directory holds the journal Pantheon never opened (Pantheon had no directory).
    assert.ok((await readFile(path.join(data, 'knowledge', 'knowledge.v1.json'), 'utf8')).includes('stex.knowledge.projections.v1'));
    report.workflow.push('Pantheon relayed every knowledge request; the platform API owned and rebuilt the journal');
  }
  await tab.close(); report.result = 'PASS';
} finally {
  await browser?.close();
  await Promise.all(children.map((child) => new Promise((resolve) => { if (child.exitCode !== null) return resolve(); child.once('exit', resolve); child.kill(); })));
  await rm(data, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2)); console.log(out);
