/**
 * Browser check of Pantheon's passage reader against the running staging stack
 * (deploy/staging-compose, http://127.0.0.1:4300 unless STEX_VERIFY_BASE is set).
 *
 * Uploads and approves one synthetic document through Pantheon's Frige proxy,
 * then in headless Chrome: searches, opens the exact citation, approves it for
 * Igor, sees it listed as current, withdraws it, and checks four widths for
 * horizontal overflow. Screenshots go to --out. Synthetic data only.
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { launchBrowser, outDirectoryFromArgs, page } from './browser/devtools.mjs';

const base = process.env.STEX_VERIFY_BASE || 'http://127.0.0.1:4300';
const book = 'staging-fixture'; const project = `stex://frige/project/${book}`;
const out = outDirectoryFromArgs('stex-passages-browser'); await mkdir(out, { recursive: true });
const marker = `quince${Date.now().toString(36)}`;
const passage = `The ${marker} orchard keeps its counted rows under frost.`;
const report = { workflow: [], viewports: [] };
/** Calls Pantheon as the page would. */
async function call(route, body) {
  const response = await fetch(base + route, { method: body ? 'POST' : 'GET', headers: { origin: base, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, value: await response.json() };
}
const upload = await call(`/frige/api/project/attachments?book=${book}`, { attachments: [{ name: `${marker}.txt`, contentBase64: Buffer.from(`Notes.\n\n${passage}\n`).toString('base64') }] });
assert.equal(upload.status, 201);
const record = (await call(`/frige/api/project/attachments?book=${book}`)).value.find((entry) => entry.name === `${marker}.txt`);
const preview = (await call(`/frige/api/project/attachments/${record.id}/excerpt?book=${book}`)).value;
assert.equal((await call(`/frige/api/project/attachments/${record.id}/approve?book=${book}`, { hash: preview.hash })).status, 200);
report.workflow.push('synthetic document approved in Frige through Pantheon');

const browser = await launchBrowser();
try {
  const tab = await page(browser.devtools);
  /** Waits for an expression to become truthy. */
  const wait = async (expression, label = expression) => { for (let i = 0; i < 200; i++) { if (await tab.evaluate(`Boolean(${expression})`).catch(() => false)) return; await new Promise((r) => setTimeout(r, 50)); } throw Error('Timed out: ' + label); };
  /** Clicks the first button with exactly this text inside a scope. */
  const click = (scope, text) => tab.evaluate(`[...document.querySelectorAll(${JSON.stringify(scope + ' button')})].find((b) => b.textContent === ${JSON.stringify(text)}).click()`);
  await tab.go(base + '/graph/');
  await wait(`document.querySelector('#passages-content form.passage-search select option[value="${project}"]')`, 'passage search form');
  await tab.evaluate(`(() => { const form = document.querySelector('#passages-content form.passage-search'); form.project.value = ${JSON.stringify(project)}; form.q.value = ${JSON.stringify(`${marker} rows`)}; form.requestSubmit(); })()`);
  await wait(`document.querySelectorAll('.passage-results li').length === 1`, 'one search result');
  assert.match(await tab.evaluate(`document.querySelector('.passage-results li p').textContent`), new RegExp(marker));
  report.workflow.push('search finds exactly the approved passage, with a snippet');
  await click('.passage-results', 'Open citation');
  await wait(`document.querySelector('.passage-reader blockquote')?.textContent === ${JSON.stringify(passage)}`, 'citation text');
  const fields = await tab.evaluate(`[...document.querySelectorAll('.passage-citation dt')].map((n) => n.textContent)`);
  assert.deepEqual(fields, ['Document', 'Project', 'Original file SHA-256', 'Approved excerpt', 'Bytes', 'Passage SHA-256']);
  assert.equal(await tab.evaluate(`document.activeElement === document.querySelector('.passage-reader h3')`), true, 'focus moves to the citation');
  report.workflow.push('citation view shows the exact text and every citation field; focus moves to it');
  await click('.passage-reader', 'Approve this passage for Igor');
  await wait(`document.querySelector('.passage-contributions')?.textContent.includes('Current: the approved source still matches.')`, 'current contribution');
  assert.match(await tab.evaluate(`document.querySelector('.passages-status').textContent`), /Only you can see/);
  report.workflow.push('approval for Igor is listed as current and stated as private');
  for (const [width, height] of [[1440, 900], [1024, 768], [768, 1024], [390, 844]]) {
    await tab.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 768 });
    const overflow = await tab.evaluate(`document.documentElement.scrollWidth > ${width}`);
    assert.equal(overflow, false, `no horizontal overflow at ${width}px`);
    await tab.evaluate(`document.querySelector('.passage-reader')?.scrollIntoView()`);
    const { data } = await tab.send('Page.captureScreenshot', { format: 'png' }); await writeFile(path.join(out, `passages-${width}.png`), Buffer.from(data, 'base64'));
    report.viewports.push({ width, overflow });
  }
  await tab.send('Emulation.clearDeviceMetricsOverride', {});
  await tab.evaluate(`[...document.querySelectorAll('.passage-contributions article')].find((a) => a.textContent.includes(${JSON.stringify(marker)})).querySelector('button:last-of-type').click()`);
  await wait(`[...document.querySelectorAll('.passage-contributions article')].some((a) => a.textContent.includes(${JSON.stringify(marker)}) && a.textContent.includes('Withdrawn.'))`, 'withdrawn contribution');
  assert.match(await tab.evaluate(`document.querySelector('.passages-status').textContent`), /Earlier conversations are not changed/);
  report.workflow.push('withdrawal is shown and explains it does not erase earlier conversations');
  await tab.close(); report.result = 'PASS';
} finally { await browser.close(); }
await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2)); console.log(out);
