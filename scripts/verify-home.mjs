import { spawn } from 'node:child_process';
import http from 'node:http';
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readManifest, repositoryRoot } from './assets/manifest.mjs';
import { launchBrowser, outDirectoryFromArgs, page, started } from './browser/devtools.mjs';

// Browser verification of the Pantheon command center (/home/ and its tabs).
// Starts an isolated stack on spare ports with disposable data: the real
// inference service (fake transport), real Frige with a synthetic book, and a
// labelled Seaxneat stub serving stex.projects.summary.v1 (a real Seaxneat
// project needs a Next.js build per run, and the stub can show states a fresh
// install cannot). Then checks layout, the masthead against P11's focal
// regions, real-data rendering, an unavailable studio, Igor, motion, and the
// keyboard, and saves screenshots.
//   corepack pnpm verify:home [--out <directory>]

const viewports = [[1920, 1080], [1440, 789], [1366, 657], [1280, 689], [1100, 700], [1024, 768], [768, 1024], [390, 844], [320, 568]];
const ports = { pantheon: 4426, seaxneat: 4427, frige: 4428, inference: 4429 };
const outDirectory = outDirectoryFromArgs('stex-home-verification');
const secret = 'verify-home-secret';
const minutesAgo = (minutes) => new Date(Date.now() - minutes * 60_000).toISOString();

// Seaxneat stub: two fixture websites, or a failure when `failing` is set.
function seaxneatStub(state) {
  return http.createServer((request, response) => {
    if (request.url !== '/seaxneat/api/stex/projects') { response.writeHead(404); response.end(); return; }
    if (state.failing) { response.writeHead(500, { 'content-type': 'application/json' }); response.end('{"error":"stub failure"}'); return; }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ schemaVersion: 'stex.projects.summary.v1', application: 'seaxneat', projects: [
      { reference: 'stex://seaxneat/project/fixture-site', id: 'fixture-site', title: 'Fixture Site (verification stub)', kind: 'website', updatedAt: minutesAgo(10), status: { state: 'working', label: 'Building' }, openPath: '/?project=fixture-site' },
      { reference: 'stex://seaxneat/project/old-site', id: 'old-site', title: 'Old Site (verification stub)', kind: 'website', updatedAt: minutesAgo(3 * 24 * 60), status: { state: 'failed', label: 'Build failed' }, openPath: '/?project=old-site' },
    ] }));
  });
}

const measure = `(async () => {
  await document.fonts.ready;
  const still = document.querySelector('.masthead-still');
  if (!still.complete) await new Promise((resolve) => still.addEventListener('load', resolve, { once: true }));
  const art = document.querySelector('.masthead-art').getBoundingClientRect();
  const brand = document.querySelector('.masthead-brand').getBoundingClientRect();
  const [px, py] = getComputedStyle(still).objectPosition.split(' ').map((value) => parseFloat(value) / 100);
  const style = getComputedStyle(document.querySelector('.masthead-art'));
  const mask = style.maskImage || style.webkitMaskImage;
  // Resolve the CSS custom properties to pixels by letting layout evaluate them.
  const resolve = (property) => { const probe = document.createElement('div'); probe.style.cssText = 'position:absolute;visibility:hidden;width:var(' + property + ', 0px)'; document.querySelector('.masthead').append(probe); const width = probe.getBoundingClientRect().width; probe.remove(); return width; };
  const inset = resolve('--brand-inset'); const clear = resolve('--clear');
  return {
    inset, clear,
    art: [art.left, art.top, art.right, art.bottom], brand: [brand.left, brand.top, brand.right, brand.bottom],
    natural: [still.naturalWidth, still.naturalHeight], source: still.currentSrc.split('/').pop(), position: [px, py],
    masked: Boolean(mask && mask !== 'none'),
    viewport: [innerWidth, innerHeight], scrollWidth: document.documentElement.scrollWidth,
    current: [...document.querySelectorAll('.tabs [aria-current="page"]')].map((link) => link.textContent),
  };
})()`;

async function main() {
  const manifest = await readManifest();
  const p11 = manifest.assets.find((asset) => asset.id === 'P11');
  const stills = manifest.assets.find((asset) => asset.id === 'P02').derivatives;
  const focal = { face: p11.focal.face, fingertips: p11.focal.fingertips, sun: [(p11.focal.sun[0] + p11.focal.sun[2]) / 2, (p11.focal.sun[1] + p11.focal.sun[3]) / 2] };
  await mkdir(outDirectory, { recursive: true });

  const data = await mkdtemp(path.join(os.tmpdir(), 'stex-verify-home-'));
  const book = path.join(data, 'books', 'fixture-book');
  await mkdir(path.join(book, 'manuscript'), { recursive: true });
  await writeFile(path.join(book, 'README.md'), '# Fixture Book (verification)\n');
  await writeFile(path.join(book, 'manuscript', 'Programme.md'), '# Programme\n');
  const anHourAgo = new Date(Date.now() - 60 * 60_000);
  for (const file of ['README.md', 'manuscript/Programme.md']) await utimes(path.join(book, file), anHourAgo, anHourAgo);

  const stubState = { failing: false };
  const stub = seaxneatStub(stubState);
  await new Promise((resolve) => stub.listen(ports.seaxneat, '127.0.0.1', resolve));
  const node = (directory, env) => spawn(process.execPath, ['server.mjs'], { cwd: path.join(repositoryRoot, directory), env: { ...process.env, ...env } });
  const children = [
    node('services/inference', { STEX_INFERENCE_PORT: String(ports.inference), STEX_INFERENCE_SHARED_SECRET: secret, STEX_HERMES_TRANSPORT: 'fake' }),
    node('apps/frige', { STEX_FRIGE_PORT: String(ports.frige), STEX_FRIGE_BOOKS_DIR: path.join(data, 'books'), STEX_FRIGE_PROJECT_DIR: data, STEX_FRIGE_BASE_PATH: '/frige', STEX_FRIGE_SHELL_URL: '/home/' }),
    node('apps/pantheon', { STEX_PANTHEON_PORT: String(ports.pantheon), STEX_FRIGE_URL: `http://127.0.0.1:${ports.frige}`, STEX_SEAXNEAT_URL: `http://127.0.0.1:${ports.seaxneat}`, STEX_FRIGE_BOOKS_DIR: path.join(data, 'books'), STEX_INFERENCE_URL: `http://127.0.0.1:${ports.inference}`, STEX_INFERENCE_SHARED_SECRET: secret }),
  ];
  const failures = []; const report = { viewports: [], data: {}, igor: {}, motion: {} };
  const check = (condition, message) => { if (!condition) failures.push(message); return condition; };
  let browser;
  try {
    await Promise.all(children.map((child, index) => started(child, /ready|listening|running/i, ['Inference', 'Frige', 'Pantheon'][index])));
    browser = await launchBrowser();
    const { devtools } = browser; report.browser = browser.browserPath;
    const base = `http://127.0.0.1:${ports.pantheon}`;
    const settle = (tab) => tab.evaluate(`new Promise((resolve) => { const done = () => !document.querySelector('[data-projects-status]'); const poll = () => done() ? resolve(true) : setTimeout(poll, 50); setTimeout(() => resolve(false), 6000); poll(); })`);

    for (const [width, height] of viewports) {
      const tab = await page(devtools);
      const label = `${width}x${height}`;
      await tab.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 });
      await tab.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
      await tab.go(`${base}/home/`);
      check(await settle(tab), `${label}: project data did not render.`);
      const stray = await tab.evaluate(`(document.querySelector('main').innerText.match(/\\b(null|undefined|NaN)\\b/g) || []).join(',')`);
      check(!stray, `${label}: stray "${stray}" text on the page.`);
      const result = await tab.evaluate(measure);
      const [left, top, right, bottom] = result.art;
      const artHeight = bottom - top;
      check(result.scrollWidth <= width, `${label}: horizontal overflow (${result.scrollWidth}px).`);
      check(artHeight <= height * 0.2 + 0.5, `${label}: masthead art is ${(100 * artHeight / height).toFixed(1)}% of the viewport (limit 20%).`);
      check(JSON.stringify(result.current) === '["Home"]', `${label}: tab state ${JSON.stringify(result.current)}.`);
      // Map P11 frame coordinates into the crop the build recorded for this
      // still (manifest "crop" = w:h:x:y of the 1920x1080 master), then through
      // object-fit: cover.
      const derivative = stills.find((entry) => entry.path.endsWith(`/${result.source}`));
      const visible = {};
      if (check(derivative?.crop, `${label}: no manifest crop for ${result.source}.`)) {
        const [, cropHeight, , cropY] = derivative.crop.split(':').map(Number);
        const scale = Math.max((right - left) / result.natural[0], artHeight / result.natural[1]);
        const shownWidth = result.natural[0] * scale; const shownHeight = result.natural[1] * scale;
        const offsetX = left + ((right - left) - shownWidth) * result.position[0]; const offsetY = top + (artHeight - shownHeight) * result.position[1];
        for (const [name, [fx, fy]] of Object.entries(focal)) {
          const x = offsetX + fx * shownWidth; const y = offsetY + ((fy * p11.master.height - cropY) / cropHeight) * shownHeight;
          visible[name] = x >= left && x <= right && y >= top && y <= bottom;
          check(visible[name], `${label}: the ${name} is cropped out of the masthead.`);
        }
      }
      // The brand never sits on visible art: either on its own row above the art,
      // or wholly inside the mask's transparent zone [inset, --clear] measured
      // from the art's left edge (both resolved to pixels in the page).
      const brandOnOwnRow = result.brand[3] <= top + 0.5;
      const brandInClearZone = result.masked && result.clear > 0 && result.brand[0] >= left + result.inset - 0.5 && result.brand[2] <= left + result.clear + 0.5;
      check(brandOnOwnRow || brandInClearZone, `${label}: the brand overlaps visible masthead art.`);
      const { data: shot } = await tab.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
      await writeFile(path.join(outDirectory, `home-${label}.png`), Buffer.from(shot, 'base64'));
      report.viewports.push({ viewport: label, artHeightShare: Number((artHeight / height).toFixed(3)), source: result.source, brand: brandOnOwnRow ? 'own row' : 'clear zone', visible });
      await tab.close();
    }

    // Real data: the newest project leads, rows are ordered, counts and links are real.
    const tab = await page(devtools);
    await tab.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await tab.go(`${base}/home/`); await settle(tab);
    report.data.home = await tab.evaluate(`({
      continueTitle: document.querySelector('.continue-title')?.textContent, continueHref: document.querySelector('.continue .stex-button')?.getAttribute('href'), continueApp: document.querySelector('.continue')?.dataset.stexApp,
      rows: [...document.querySelectorAll('.project-row')].map((row) => [row.querySelector('.project-title').textContent, row.querySelector('.status').textContent, row.getAttribute('href')]),
    })`);
    const home = report.data.home;
    check(home.continueTitle === 'Fixture Site (verification stub)' && home.continueHref === '/seaxneat/?project=fixture-site' && home.continueApp === 'seaxneat', `Continue working shows ${home.continueTitle} → ${home.continueHref}.`);
    check(home.rows.map((row) => row[0]).join('|') === 'Fixture Site (verification stub)|Fixture Book (verification)|Old Site (verification stub)', `Recent projects order: ${home.rows.map((row) => row[0]).join(', ')}.`);
    check(/^Building · 10 minutes ago$/.test(home.rows[0]?.[1]) && /^Edited 1 hour ago$/.test(home.rows[1]?.[1]) && /^Build failed · 3 days ago$/.test(home.rows[2]?.[1]), `Status text: ${home.rows.map((row) => row[1]).join(' / ')}.`);
    check(home.rows[1]?.[2] === '/frige/?book=fixture-book', `Frige row links to ${home.rows[1]?.[2]}.`);
    await tab.go(`${base}/studios/`); await tab.evaluate(`new Promise((resolve) => setTimeout(resolve, 1500))`);
    report.data.counts = await tab.evaluate(`Object.fromEntries([...document.querySelectorAll('[data-project-count]')].map((slot) => [slot.dataset.projectCount, slot.textContent]))`);
    check(report.data.counts.frige === '1 project' && report.data.counts.seaxneat === '2 projects', `Studio counts: ${JSON.stringify(report.data.counts)}.`);
    await tab.go(`${base}/projects/`); await settle(tab);
    report.data.table = await tab.evaluate(`[...document.querySelectorAll('.project-table tbody tr')].length`);
    check(report.data.table === 3, `Projects table has ${report.data.table} rows.`);
    for (const name of ['projects', 'studios']) {
      await tab.go(`${base}/${name}/`); await settle(tab); await tab.evaluate(`new Promise((resolve) => setTimeout(resolve, 600))`);
      const { data: shot } = await tab.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
      await writeFile(path.join(outDirectory, `${name}-1440x900.png`), Buffer.from(shot, 'base64'));
    }

    // An unavailable studio is named, and the other studio's projects remain.
    stubState.failing = true;
    await tab.go(`${base}/home/`); await settle(tab);
    report.data.unavailable = await tab.evaluate(`({ notes: [...document.querySelectorAll('.notice')].map((note) => note.textContent), rows: document.querySelectorAll('.project-row').length })`);
    check(report.data.unavailable.notes.length === 1 && report.data.unavailable.notes[0].startsWith('Seaxneat is not responding') && report.data.unavailable.rows === 1, `Unavailable studio: ${JSON.stringify(report.data.unavailable)}.`);
    stubState.failing = false;

    // Igor: a real round trip through Pantheon and the inference service, labelled as simulated.
    await tab.go(`${base}/home/`); await settle(tab);
    report.igor = await tab.evaluate(`new Promise((resolve) => {
      const input = document.querySelector('.igor-input'); input.value = 'What should I work on?';
      document.querySelector('.igor-form').requestSubmit();
      const poll = () => { const reply = document.querySelector('.igor-entry--assistant, .igor-entry--status'); if (reply) resolve({ role: reply.className, text: reply.querySelector('p').textContent, note: reply.querySelector('.stex-meta')?.textContent || null }); else setTimeout(poll, 50); };
      setTimeout(() => resolve({ timeout: true }), 8000); poll();
    })`);
    check(report.igor.role?.includes('assistant') && report.igor.note === 'Simulated reply · fake transport' && report.igor.text?.includes('What should I work on?'), `Igor: ${JSON.stringify(report.igor)}.`);
    const { data: igorShot } = await tab.send('Page.captureScreenshot', { format: 'png' });
    await writeFile(path.join(outDirectory, 'home-igor-1440x900.png'), Buffer.from(igorShot, 'base64'));

    // Keyboard: skip link first, then the brand, then the tabs in order.
    await tab.go(`${base}/home/`); await settle(tab);
    const order = [];
    for (let index = 0; index < 7; index += 1) { await tab.key('Tab', 'Tab', 9); order.push(await tab.evaluate(`(document.activeElement.textContent || '').trim().replace(/\\s+/g, ' ')`)); }
    report.keyboard = order;
    check(order[0] === 'Skip to content' && order[1].includes('Pantheon') && order.slice(2).join('|') === 'Home|Projects|Studios|Graph|Activity', `Keyboard order: ${order.join(' → ')}.`);
    await tab.close();

    // Motion: plays by default; reduced motion fetches no masthead video at all.
    const moving = await page(devtools);
    await moving.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await moving.go(`${base}/home/`);
    report.motion.default = await moving.evaluate(`new Promise((resolve) => { const video = document.querySelector('.masthead-motion'); const done = () => resolve({ playing: !video.paused, source: video.currentSrc.split('/').pop(), toggle: document.querySelector('.motion-toggle').textContent }); if (!video.paused && document.body.classList.contains('has-motion')) done(); else { video.addEventListener('playing', () => setTimeout(done, 100), { once: true }); setTimeout(done, 8000); } })`);
    check(report.motion.default.playing && report.motion.default.source === 'pantheon-masthead-loop-1920w.webm' && report.motion.default.toggle === 'Pause motion', `Masthead motion: ${JSON.stringify(report.motion.default)}.`);
    await moving.close();
    const still = await page(devtools);
    await still.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await still.go(`${base}/home/`);
    report.motion.reduced = await still.evaluate(`new Promise((resolve) => setTimeout(() => resolve({ paused: document.querySelector('.masthead-motion').paused, loopRequests: performance.getEntriesByType('resource').filter((entry) => entry.name.includes('masthead-loop')).length, toggle: document.querySelector('.motion-toggle').textContent }), 2500))`);
    check(report.motion.reduced.paused && report.motion.reduced.loopRequests === 0 && report.motion.reduced.toggle === 'Play motion', `Reduced motion: ${JSON.stringify(report.motion.reduced)}.`);
    await still.close();
  } finally {
    await browser?.close();
    for (const child of children) child.kill();
    stub.close();
    await rm(data, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
  }
  report.failures = failures;
  await writeFile(path.join(outDirectory, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  console.log(`\nScreenshots and report.json: ${outDirectory}`);
  if (failures.length) { for (const failure of failures) console.error(`FAIL  ${failure}`); process.exit(1); }
  console.log('Command-center verification passed.');
}

await main();
