import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { repositoryRoot } from './assets/manifest.mjs';
import { launchBrowser, outDirectoryFromArgs, page, started } from './browser/devtools.mjs';

// P2: the mature publishing workstation rendered by Pantheon. Synthetic data only.
const out = outDirectoryFromArgs('stex-frige-verification');
const root = await mkdtemp(path.join(os.tmpdir(), 'stex-platform-frige-'));
const bookRoot = path.join(root, 'books', 'fixture-book');
await mkdir(path.join(bookRoot, 'manuscript', '01_Cycle'), { recursive: true }); await mkdir(out, { recursive: true });
const poem = '# Morning\n\nA synthetic line for verification,\n  indented and Unicode — kept as written.\n\nAnother stanza.\n';
const poemPath = path.join(bookRoot, 'manuscript', '01_Cycle', 'Morning.md');
await writeFile(poemPath, poem); await writeFile(path.join(bookRoot, 'manuscript', 'Programme.md'), '# Programme\n\n- [Morning](01_Cycle/Morning.md)\n');
await writeFile(path.join(bookRoot, 'README.md'), '# Fixture Book (verification)\n');
const base = 'http://127.0.0.1:4438'; const apiPrefix = base + '/frige/api/stex/publishing/v1';
const stub = http.createServer(async (request, response) => {
  if (request.url.startsWith('/health')) { response.writeHead(200, { 'content-type': 'application/json' }); response.end('{"transport":"fake"}'); return; }
  if (request.url === '/v1/settings/models' && request.method === 'GET') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ builtIn: ['pantheon-director'], usedBy: {}, roles: [{ id: 'pantheon-director', name: 'Igor', description: 'Verification fixture', stack: [], temperature: null, maxOutputTokens: null }] })); return;
  }
  if (request.url === '/v1/models/catalog') { response.writeHead(200, { 'content-type': 'application/json' }); response.end('{"available":false,"models":[]}'); return; }
  if (request.url !== '/v1/texgraph/scope-turn') { response.writeHead(404); response.end(); return; }
  let raw = ''; for await (const chunk of request) raw += chunk;
  const source = JSON.parse(raw).scopeSources[0];
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ commentary: 'Simulated editorial proposal for this synthetic fixture.', changes: [{ nodeId: source.nodeId, source: source.source + '\nA proposed synthetic line.\n', summary: 'Synthetic addition' }], parts: [], meta: { model: 'stex/verification-stub', usage: { transport: 'fake' } } }));
});
await new Promise((resolve) => stub.listen(4439, '127.0.0.1', resolve));
const node = (directory, env) => spawn(process.execPath, ['server.mjs'], { cwd: path.join(repositoryRoot, directory), windowsHide: true, env: { ...process.env, ...env } });
const children = [
  node('apps/frige', { STEX_FRIGE_PORT: '4437', STEX_FRIGE_BASE_PATH: '/frige', STEX_FRIGE_BOOKS_DIR: path.join(root, 'books'), STEX_FRIGE_PROJECT_DIR: path.join(root, 'default'), STEX_PANTHEON_URL: base, STEX_FRIGE_INFERENCE_MODE: 'stub', STEX_INFERENCE_URL: 'http://127.0.0.1:4439', STEX_INFERENCE_SHARED_SECRET: 'verification-only' }),
  node('apps/pantheon', { STEX_PANTHEON_PORT: '4438', STEX_FRIGE_URL: 'http://127.0.0.1:4437' }),
];
const report = { workflow: [], viewports: [], limits: ['Chrome only; synthetic fixtures and local inference stub; no provider or production operations'] };
let browser;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, label, timeout = 45000) { const start = Date.now(); while (Date.now() - start < timeout) { if (await check()) return; await delay(100); } throw new Error('Timed out: ' + label); }
async function api(route, payload, method) {
  const response = await fetch(apiPrefix + route, { method: method || (payload ? 'POST' : 'GET'), headers: { 'content-type': 'application/json' }, ...(payload ? { body: JSON.stringify(payload) } : {}) });
  const result = await response.json(); if (!response.ok) throw new Error(result.error); return result;
}
try {
  await Promise.all(children.map((child) => started(child, /ready/, 'Publishing stack')));
  browser = await launchBrowser(); const tab = await page(browser.devtools);
  const evaluate = tab.evaluate;
  const input = (selector, value) => evaluate(`(() => { const node = document.querySelector(${JSON.stringify(selector)}); node.value = ${JSON.stringify(value)}; node.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  const click = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const ready = () => until(() => evaluate(`!!document.querySelector('#book-tree .tree-book') && document.querySelector('#conversation-title').textContent !== 'Choose a node'`), 'publishing workspace');
  await tab.go(base + '/frige/'); await until(() => evaluate(`!!document.querySelector('.project-list')`), 'library');
  assert.equal(await evaluate(`document.querySelectorAll('.masthead').length`), 1);
  await input('[name="title"]', 'Created through Pantheon'); await input('[name="author"]', 'Synthetic author'); await click('#create-project button');
  await ready(); assert.match(await evaluate('location.search'), /book=created-through-pantheon-/); report.workflow.push('create/open an engine-owned scaffold through the platform library');
  await tab.go(base + '/frige/?book=fixture-book'); await ready();
  const graph = await api('/project/graph?book=fixture-book'); const selected = graph.nodes.find((entry) => entry.relativePath.endsWith('Morning.md'));
  await evaluate(`document.querySelectorAll('.tree-toggle').forEach(button => button.click())`);
  await until(() => evaluate(`!!document.querySelector('.tree-piece')`), 'piece selector'); await click('.tree-piece');
  await until(() => evaluate(`document.querySelector('#conversation-title').textContent.includes('Morning')`), 'selected piece');
  await click('#show-source'); const changed = poem + '\nSaved through the platform.\n'; await input('#source', changed); await click('#save-source');
  await until(async () => (await readFile(poemPath, 'utf8')) === changed, 'source save'); report.workflow.push('save preserves indentation, stanza breaks and Unicode');
  const current = await api(`/nodes/${selected.id}?book=fixture-book`);
  await api(`/nodes/${selected.id}?book=fixture-book`, { source: changed + '\nConcurrent synthetic edit.\n', baseHash: current.hash }, 'PUT');
  await input('#source', changed + '\nStale browser edit.\n'); await click('#save-source');
  await until(() => evaluate(`/changed|stale|reload/i.test(document.querySelector('#save-state').textContent)`), 'visible stale save refusal');
  assert.doesNotMatch(await readFile(poemPath, 'utf8'), /Stale browser/); report.workflow.push('stale save refuses to overwrite concurrent source');
  await click('#refresh'); await until(() => evaluate(`!document.querySelector('#save-state').textContent.includes('Unsaved')`), 'refresh');
  await click('#show-thread'); await input('#message', 'Prepare a synthetic proposal'); await click('#turn-form [type="submit"]');
  await until(() => evaluate(`!!document.querySelector('.changes .accept')`), 'visible proposal diff');
  assert.doesNotMatch(await readFile(poemPath, 'utf8'), /A proposed synthetic line/);
  await click('.changes .accept');
  await until(async () => (await readFile(poemPath, 'utf8')).includes('A proposed synthetic line'), 'explicit acceptance');
  await until(async () => (await api('/project/build?book=fixture-book'))?.ok, 'real LuaLaTeX proof');
  const pageMap = await api('/project/page-map?book=fixture-book'); assert.equal(pageMap.pagination.verified, true); assert.ok(pageMap.nodes.some((entry) => entry.nodeId === selected.id && entry.firstPage));
  await until(() => evaluate(`document.querySelectorAll('#proof-viewer canvas').length > 0`), 'rendered PDF canvas'); report.workflow.push('proposal inert until acceptance; real compiler-mapped PDF renders');
  await click('#open-design'); await input('[name="fontSize"]', '13pt'); await click('#design-panel [type="submit"]');
  await until(() => evaluate(`document.querySelector('#design-state').textContent === 'Saved.'`), 'profile save');
  const preflight = await api('/project/preflight?book=fixture-book'); assert.equal(preflight.checks.find((entry) => entry.id === 'freshness').status, 'warn');
  await click('#design-cancel'); report.workflow.push('profile change marks the proof stale in diagnostic preflight');
  await evaluate(`document.querySelector('#settings-menu').open = true`); await click('#configure-models');
  await until(() => evaluate(`!!document.querySelector('.model-settings input')`), 'model settings');
  const dialogStyle = await evaluate(`(() => { const dialog = document.querySelector('.model-settings'); const input = dialog.querySelector('input'); return { scoped: !!dialog.closest('.frige-workstation'), height: input.getBoundingClientRect().height, background: getComputedStyle(input).backgroundColor, border: getComputedStyle(dialog.querySelector('.role-card')).borderTopStyle }; })()`);
  assert.ok(dialogStyle.scoped && dialogStyle.height >= 40); assert.equal(dialogStyle.border, 'solid');
  await tab.key('Escape', 'Escape', 27); assert.equal(await evaluate(`document.querySelector('.model-settings').open`), false);
  report.workflow.push('model settings remains scoped, styled, keyboard-accessible and closable');
  for (const [width, height] of [[1440, 900], [1024, 768], [768, 1024], [390, 844], [320, 568]]) {
    await tab.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 });
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    if (width < 640) await click('[data-view="proof"]');
    if (width >= 640 && width < 1024) {
      await click('[data-view="contents"]'); assert.equal(await evaluate(`document.querySelector('.tabs').inert && document.querySelector('.publishing-toolbar').inert`), true);
      await evaluate(`const items = [...document.querySelectorAll('#navigator button')].filter(node => node.getClientRects().length); items.at(-1).focus()`);
      await tab.key('Tab', 'Tab', 9); assert.equal(await evaluate(`!!document.activeElement.closest('#navigator')`), true);
      await tab.key('Escape', 'Escape', 27); assert.equal(await evaluate(`document.querySelector('.tabs').inert`), false);
      assert.equal(await evaluate(`document.activeElement.dataset.view`), 'contents');
    }
    const measure = await evaluate(`({ width: innerWidth, scroll: document.documentElement.scrollWidth, header: document.querySelector('.masthead').getBoundingClientRect().height, nav: !!document.querySelector('.tabs a[href="/home/"]'), source: !!document.querySelector('#source'), proof: !!document.querySelector('#proof-viewer') })`);
    assert.ok(measure.scroll <= width + 1, JSON.stringify(measure)); assert.ok(measure.nav && measure.source && measure.proof);
    report.viewports.push({ width, height, ...measure });
    const shot = await tab.send('Page.captureScreenshot', { format: 'png' }); await writeFile(path.join(out, width + '.png'), Buffer.from(shot.data, 'base64'));
  }
  await evaluate(`document.querySelector('.masthead-brand').focus()`); await tab.key('Tab', 'Tab', 9);
  report.keyboard = await evaluate(`({ label: document.activeElement.textContent.trim(), outline: getComputedStyle(document.activeElement).outlineStyle, width: getComputedStyle(document.activeElement).outlineWidth })`);
  assert.equal(report.keyboard.outline, 'solid'); assert.equal(report.keyboard.width, '2px');
  report.workflow.push('platform keyboard focus and tablet drawer Escape/inert behavior');
  assert.equal((await fetch('http://127.0.0.1:4437/frige/?book=fixture-book', { redirect: 'manual' })).headers.get('location'), base + '/frige/?book=fixture-book');
  report.result = 'PASS'; report.browser = browser.browserPath; console.log('PASS: platform publishing workflow, real proof, five viewports');
} catch (error) { report.result = 'FAIL'; report.error = error.stack; console.error(error); process.exitCode = 1; }
finally {
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  if (browser) await browser.close();
  await Promise.all(children.map(async (child) => { if (child.exitCode !== null) return; const done = new Promise((resolve) => child.once('exit', resolve)); child.kill(); await done; }));
  await new Promise((resolve) => stub.close(resolve));
  if (report.result === 'PASS') await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  else console.log('Synthetic fixture retained: ' + root);
  console.log('Report: ' + path.join(out, 'report.json'));
}
