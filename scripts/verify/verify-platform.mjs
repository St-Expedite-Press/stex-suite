/** Suite acceptance source that exercises website revisions and a running Next preview through Pantheon. */
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { repositoryRoot } from '../assets/manifest.mjs';
import { candidatePorts } from '../../apps/seaxneat/src/preview-port.mjs';
import { launchBrowser, outDirectoryFromArgs, page } from './browser/devtools.mjs';

// Real dev:alpha, disposable state, real Next builds, deterministic proposals.
const out = outDirectoryFromArgs('stex-platform-verification');
const root = await mkdtemp(path.join(os.tmpdir(), 'stex-platform-'));
await mkdir(path.join(root, 'books')); await mkdir(out, { recursive: true });
const base = 'http://127.0.0.1:4540';
const stack = spawn(process.execPath, ['scripts/dev/dev-alpha.mjs'], { cwd: repositoryRoot, windowsHide: true, env: { ...process.env,
  STEX_PANTHEON_PORT: '4540', STEX_FRIGE_PORT: '4541', SEAXNEAT_PORT: '4542', STEX_IGOR_PORT: '4543', STEX_PLATFORM_PORT: '4544', STEX_INFERENCE_PORT: '8540',
  STEX_FRIGE_PROJECT_DIR: path.join(root, 'local-book'), STEX_FRIGE_PROJECTS_DIR: path.join(root, 'projects'), STEX_FRIGE_BOOKS_DIR: path.join(root, 'books'), STEX_SEAXNEAT_DATA_DIR: path.join(root, 'websites'), STEX_IGOR_DATA_DIR: path.join(root, 'conversations'),
  NEXT_TELEMETRY_DISABLED: '1', STEX_IGOR_AUTH_MODE: 'local', STEX_KNOWLEDGE_DATA_DIR: '',
} });
let output = ''; stack.stdout.on('data', (data) => { output = (output + data).slice(-16000); }); stack.stderr.on('data', (data) => { output = (output + data).slice(-16000); });
/** Waits for the next polling interval. */
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** Polls for an observable condition until its deadline. */
async function until(check, label, timeout = 240_000) {
  const start = Date.now();
  while (Date.now() - start < timeout) { if (await check()) return; await delay(250); }
  throw new Error('Timed out: ' + label);
}
let browser;
// S0 negative-check fixtures: an "external" origin the preview must not reach, and a foreign listener squatting on the project's first preview port.
let externalHits = 0; let blocker = null;
const external = http.createServer((request, response) => { externalHits += 1; response.writeHead(200, { 'access-control-allow-origin': '*', 'content-type': 'text/plain' }); response.end('reached'); });
await new Promise((resolve) => external.listen(4545, '127.0.0.1', resolve));
const report = { workflow: [], viewports: [], limits: ['Chrome/Edge only; no provider calls or production operations', 'Browser workflow covers the Seaxneat workspace and project discovery'] };
try {
  await until(async () => fetch(base + '/seaxneat/api/stex/workspace/v1/projects').then((r) => r.ok).catch(() => false), 'dev:alpha startup', 60000);
  console.log('dev:alpha ready with disposable data');
  browser = await launchBrowser();
  const tab = await page(browser.devtools);
  /** Waits for the website workspace to display the expected state. */
  const settle = (text) => until(() => tab.evaluate(`document.querySelector('.workspace-notice')?.textContent.includes(${JSON.stringify(text)})`), text);
  /** Activates the matching page control. */
  const click = (text) => tab.evaluate(`(() => { const button = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === ${JSON.stringify(text)}); if (!button) throw new Error('Missing button'); button.click(); })()`);
  /** Focuses a workspace input and enters text through DevTools. */
  const fill = async (selector, value) => { await tab.evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`); await tab.send('Input.insertText', { text: value }); };
  await tab.go(base + '/workspaces/seaxneat/');
  await settle('');
  await fill('#project-title', 'Platform acceptance fixture'); await click('Create project');
  await settle('Project built and ready.'); report.workflow.push('create: real Next.js install/build and validated seed'); console.log('Real Next.js project built');
  const stateFile = path.join(root, 'websites', 'state.json');
  let state = JSON.parse(await readFile(stateFile, 'utf8')); const id = state.projects[0].id; const seed = state.projects[0].revisions[0].id;
  await fill('#heading-request', 'A platform-composed heading'); await click('Prepare edit'); await settle('Simulated proposal ready');
  await tab.go(base + '/workspaces/seaxneat/?project=' + id);
  await until(() => tab.evaluate(`!!document.querySelector('.workspace-proposal')`), 'proposal survives refresh');
  await click('Apply and validate'); await settle('Validated edit applied.');
  state = JSON.parse(await readFile(stateFile, 'utf8')); assert.equal(state.projects[0].revisions.length, 2); report.workflow.push('proposal survives reload; explicit apply builds and commits'); console.log('Explicit edit built and committed');
  await tab.evaluate(`document.querySelector('[aria-label="Diff from ${seed}"]').click()`); await settle('Revision diff loaded.');
  assert.match(await tab.evaluate(`document.querySelector('.workspace-diff').textContent`), /A platform-composed heading/); report.workflow.push('source diff shown');
  await fill('#heading-request', 'Retain this pending proposal'); await click('Prepare edit'); await settle('Simulated proposal ready');
  await tab.evaluate('window.confirm = () => true');
  await tab.evaluate(`document.querySelector('[aria-label="Restore ${seed}"]').click()`); await settle('Restored as a new validated revision.');
  state = JSON.parse(await readFile(stateFile, 'utf8')); assert.equal(state.projects[0].revisions.length, 3); report.workflow.push('restore builds and commits a new revision'); console.log('Restored revision built');
  assert.ok(await tab.evaluate(`!!document.querySelector('.workspace-proposal')`), 'restore preserves the durable pending proposal');
  await click('Dismiss proposal'); await settle('Proposal dismissed.');
  state = JSON.parse(await readFile(stateFile, 'utf8')); assert.equal(state.projects[0].pendingProposal, null); report.workflow.push('restore preserves pending proposal; dismissal is durable');
  blocker = net.createServer(); await new Promise((resolve) => blocker.listen(candidatePorts(id)[0], '127.0.0.1', resolve));
  await click('Build and start local preview'); await settle('Preview is starting');
  await until(() => fetch(base + '/seaxneat/api/projects/' + id + '/preview/').then((r) => r.ok).catch(() => false), 'real preview startup', 30000);
  await tab.evaluate(`document.querySelector('iframe').addEventListener('load', () => { document.querySelector('iframe').dataset.loaded = 'true'; }, { once: true })`);
  await click('Reload preview');
  await until(() => tab.evaluate(`document.querySelector('iframe')?.dataset.loaded === 'true'`), 'preview frame loaded', 15000);
  assert.equal(await tab.evaluate(`document.querySelector('iframe').getAttribute('sandbox')`), 'allow-scripts');
  const preview = await fetch(base + '/seaxneat/api/projects/' + id + '/preview/');
  assert.match(preview.headers.get('content-security-policy'), /sandbox allow-scripts/); assert.match(await preview.text(), /Platform acceptance fixture/);
  // Opaque sandbox frames may run in another browser process. Test the actual
  // DOM access boundary without assuming a DevTools child-frame layout.
  const attempted = await tab.evaluate(`(() => { try { return document.querySelector('iframe').contentWindow.document ? 'ACCESS' : 'EMPTY'; } catch (e) { return e.name; } })()`);
  assert.equal(attempted, 'SecurityError'); report.workflow.push('real mounted preview; browser denies document access across the sandbox');
  const targets = await browser.devtools.send('Target.getTargets');
  const target = targets.targetInfos.find((entry) => entry.type === 'iframe' && entry.url.includes('/api/projects/' + id + '/preview'));
  assert.ok(target, 'opaque preview has a browser target');
  const attached = await browser.devtools.send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
  await until(async () => {
    const result = await browser.devtools.send('Runtime.evaluate', { expression: `JSON.stringify({ runtime: !!window.next?.appDir, background: getComputedStyle(document.documentElement).backgroundColor })`, returnByValue: true }, attached.sessionId);
    report.previewAssets = JSON.parse(result.result.value);
    return report.previewAssets.runtime && report.previewAssets.background === 'rgb(244, 239, 229)';
  }, 'Next runtime executes and generated stylesheet loads inside sandbox', 15000);
  report.workflow.push('Next runtime JS executes and generated CSS loads inside the opaque preview');
  const negative = await browser.devtools.send('Runtime.evaluate', {
    expression: `(async () => { let parentAccess; try { parentAccess = !!parent.document; } catch (e) { parentAccess = e.name; } let mutation; try { await fetch('/seaxneat/api/stex/workspace/v1/projects', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{"title":"Forbidden from preview"}' }); mutation = 'READABLE'; } catch (e) { mutation = 'BLOCKED'; } return { parentAccess, mutation }; })()`,
    awaitPromise: true, returnByValue: true,
  }, attached.sessionId);
  assert.equal(negative.result.value.parentAccess, 'SecurityError');
  assert.equal(negative.result.value.mutation, 'BLOCKED');
  assert.equal(JSON.parse(await readFile(stateFile, 'utf8')).projects.length, 1);
  report.workflow.push('script inside the real preview cannot read parent document or create an engine project');
  for (const engine of ['/seaxneat/api/stex/workspace/v1/projects', '/api/books']) {
    const denied = await fetch(base + engine, { method: 'POST', headers: { origin: 'null', 'content-type': 'text/plain' }, body: '{"title":"forbidden","ticket":{"title":"forbidden"}}' }); assert.equal(denied.status, 403);
  }
  report.workflow.push('opaque preview origins cannot submit engine or legacy mutations');
  // S0: the preview CSP must stop generated script from contacting any other origin, not just from reading the parent.
  assert.match(preview.headers.get('content-security-policy'), /connect-src 'self'/); assert.match(preview.headers.get('content-security-policy'), /form-action 'none'/);
  const exfil = await browser.devtools.send('Runtime.evaluate', {
    expression: `(async () => { const violations = []; document.addEventListener('securitypolicyviolation', (event) => violations.push(event.effectiveDirective)); let fetched; try { await fetch('http://127.0.0.1:4545/exfil', { mode: 'cors' }); fetched = 'REACHED'; } catch (e) { fetched = 'BLOCKED'; } const image = await new Promise((resolve) => { const img = new Image(); img.onload = () => resolve('LOADED'); img.onerror = () => resolve('BLOCKED'); img.src = 'http://127.0.0.1:4545/pixel.png'; }); await new Promise((resolve) => setTimeout(resolve, 300)); return { fetched, image, violations }; })()`,
    awaitPromise: true, returnByValue: true,
  }, attached.sessionId);
  assert.equal(exfil.result.value.fetched, 'BLOCKED'); assert.equal(exfil.result.value.image, 'BLOCKED');
  assert.ok(exfil.result.value.violations.includes('connect-src'), JSON.stringify(exfil.result.value)); assert.ok(exfil.result.value.violations.includes('img-src'), JSON.stringify(exfil.result.value));
  assert.equal(externalHits, 0, 'the external origin must never receive a request from the preview');
  report.workflow.push('CSP blocks preview script fetches and images to an external origin (securitypolicyviolation observed; server received 0 requests)');
  // S0: the project's hashed port is held by a foreign listener, so the preview must have moved to another port.
  const previewPort = Number(new URL(JSON.parse(await readFile(stateFile, 'utf8')).projects[0].preview.target).port);
  assert.notEqual(previewPort, candidatePorts(id)[0], 'preview must not collide with a foreign listener'); report.workflow.push('port collision: preview started on a different free port (' + previewPort + ')');
  // S0: a successful apply restarts the live preview, which must then serve the new build rather than the old one.
  await fill('#heading-request', 'Heading after live rebuild'); await click('Prepare edit'); await settle('Simulated proposal ready'); await click('Apply and validate'); await settle('Validated edit applied');
  await until(() => fetch(base + '/seaxneat/api/projects/' + id + '/preview/').then((r) => r.text()).then((text) => text.includes('Heading after live rebuild')).catch(() => false), 'preview restarted on the new build', 60000);
  report.workflow.push('apply rebuilt and restarted the live preview; it serves the new heading, not the stale build');
  // S0: Stop preview kills the whole process tree, frees the port, and the engine stops proxying.
  const stoppedPort = Number(new URL(JSON.parse(await readFile(stateFile, 'utf8')).projects[0].preview.target).port);
  await click('Stop preview'); await settle('Preview stopped.');
  assert.equal(JSON.parse(await readFile(stateFile, 'utf8')).projects[0].preview.state, 'stopped');
  await until(() => new Promise((resolve) => { const socket = net.connect({ port: stoppedPort, host: '127.0.0.1' }); socket.once('connect', () => { socket.destroy(); resolve(false); }); socket.once('error', () => resolve(true)); }), 'preview port released after stop', 15000);
  assert.equal((await fetch(base + '/seaxneat/api/projects/' + id + '/preview/')).ok, false);
  assert.equal(await tab.evaluate("document.querySelector('iframe') === null"), true);
  report.workflow.push('Stop preview: process tree gone, port ' + stoppedPort + ' released, proxy refuses, frame removed');
  for (const [width, height] of [[1440, 900], [1024, 768], [768, 1024], [390, 844], [320, 568]]) {
    await tab.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 });
    await tab.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    const measure = await tab.evaluate(`(async () => { await document.fonts.ready; return { width: innerWidth, scroll: document.documentElement.scrollWidth, nav: document.querySelector('.tabs').innerText, controls: [...document.querySelectorAll('.development-workspace button')].filter(b => b.getBoundingClientRect().width).every(b => b.getBoundingClientRect().height >= 43) }; })()`);
    assert.ok(measure.scroll <= width + 1, JSON.stringify(measure)); assert.ok(measure.controls, '44px controls'); assert.match(measure.nav, /Home/);
    report.viewports.push({ width, height, ...measure });
    const shot = await tab.send('Page.captureScreenshot', { format: 'png' }); await writeFile(path.join(out, width + '.png'), Buffer.from(shot.data, 'base64'));
  }
  await tab.go(base + '/home/'); await until(() => tab.evaluate(`document.body.innerText.includes('Platform acceptance fixture')`), 'platform project discovery');
  report.workflow.push('project remains discoverable from Pantheon home'); report.result = 'PASS'; report.browser = browser.browserPath;
  console.log('PASS: platform workflow and five viewports');
} catch (error) { report.result = 'FAIL'; report.error = error.stack; report.stackOutput = output; console.error(error); process.exitCode = 1; }
finally {
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  if (browser) await browser.close();
  external.close(); blocker?.close();
  if (process.platform === 'win32') { try { execFileSync('taskkill', ['/PID', String(stack.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); } catch {} }
  else { stack.kill('SIGTERM'); await delay(1000); }
  if (report.result === 'PASS') await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
  else console.log('Disposable fixture retained for diagnosis: ' + root);
  console.log('Report: ' + path.join(out, 'report.json'));
}
