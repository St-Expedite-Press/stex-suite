import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readManifest, repositoryRoot } from './assets/manifest.mjs';
import { launchBrowser, outDirectoryFromArgs, page, started } from './browser/devtools.mjs';

// Browser verification of the Pantheon splash. Drives an installed Chrome or
// Edge over the DevTools protocol (no npm dependencies), measures the entrance
// panel against the focal regions recorded for P10 in assets/manifest.json,
// checks motion preferences, keyboard order, and the no-JavaScript fallback,
// and saves screenshots.
//   corepack pnpm verify:splash [--out <directory>]

// Full-screen sizes plus real browser viewports (screen minus browser chrome and taskbar),
// which are wider than 16:9 and leave the least room under the artwork.
const viewports = [[1920, 1080], [1920, 969], [1536, 730], [1440, 789], [1366, 657], [1280, 689], [1280, 600], [1920, 640], [900, 720],
  [2560, 1080], [1024, 768], [768, 1024], [390, 844], [844, 390], [320, 568]];
const port = Number(process.env.STEX_VERIFY_PORT || 4419);
const outDirectory = outDirectoryFromArgs('stex-splash-verification');

const measure = `(async () => {
  await document.fonts.ready;
  const image = document.querySelector('.splash-still');
  if (!image.complete) await new Promise((resolve) => image.addEventListener('load', resolve, { once: true }));
  const panel = document.querySelector('.splash-panel').getBoundingClientRect();
  const box = image.getBoundingClientRect();
  const [px, py] = getComputedStyle(image).objectPosition.split(' ').map((value) => parseFloat(value) / 100);
  const scale = Math.max(box.width / 1920, box.height / 1080), width = 1920 * scale, height = 1080 * scale;
  const ox = box.left + (box.width - width) * px, oy = box.top + (box.height - height) * py;
  const toVideo = (x, y) => [(x - ox) / width, (y - oy) / height];
  return {
    overlay: getComputedStyle(document.querySelector('.splash-entrance')).position === 'absolute',
    panel: [panel.left, panel.top, panel.right, panel.bottom].map(Math.round),
    panelVideo: [...toVideo(panel.left, panel.top), ...toVideo(panel.right, panel.bottom)],
    visible: [...toVideo(box.left, box.top), ...toVideo(box.right, box.bottom)],
    artBottom: box.bottom, artRight: box.right, viewport: [innerWidth, innerHeight], scrollWidth: document.documentElement.scrollWidth,
    actionHeight: document.querySelector('.splash-action').getBoundingClientRect().height,
    actionBottom: document.querySelector('.splash-action').getBoundingClientRect().bottom,
    wordmarkFont: getComputedStyle(document.querySelector('.stex-wordmark__name')).fontFamily,
    fontsLoaded: [...document.fonts].filter((face) => face.status === 'loaded').map((face) => face.family + ' ' + face.style),
  };
})()`;

const intersects = (a, b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
const contains = (rect, [x, y]) => x >= rect[0] && x <= rect[2] && y >= rect[1] && y <= rect[3];
const crossesSegment = (rect, [x1, y1, x2, y2]) => Array.from({ length: 201 }, (_, i) => [x1 + (x2 - x1) * i / 200, y1 + (y2 - y1) * i / 200]).some((point) => contains(rect, point));
const overlapShare = (rect, zone) => { const w = Math.max(0, Math.min(rect[2], zone[2]) - Math.max(rect[0], zone[0])); const h = Math.max(0, Math.min(rect[3], zone[3]) - Math.max(rect[1], zone[1])); return (w * h) / ((rect[2] - rect[0]) * (rect[3] - rect[1])); };

async function main() {
  const focal = (await readManifest()).assets.find((asset) => asset.id === 'P10').focal;
  const heads = { seatedHead: focal.gaze.slice(0, 2), celestialFace: focal.gaze.slice(2), reachingHand: focal.reachingHand };
  await mkdir(outDirectory, { recursive: true });
  const books = await mkdtemp(path.join(os.tmpdir(), 'stex-verify-books-'));
  const server = spawn(process.execPath, ['server.mjs'], { cwd: path.join(repositoryRoot, 'apps', 'pantheon'), env: { ...process.env, STEX_PANTHEON_PORT: String(port), STEX_FRIGE_BOOKS_DIR: books } });
  const failures = []; const report = { viewports: [], motion: {} };
  let browser;
  const check = (condition, message) => { if (!condition) failures.push(message); return condition; };
  try {
    await started(server, /ready/, 'Pantheon');
    browser = await launchBrowser();
    const { devtools } = browser; report.browser = browser.browserPath;
    const base = `http://127.0.0.1:${port}`;

    for (const [width, height] of viewports) {
      const tab = await page(devtools);
      await tab.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 });
      await tab.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
      await tab.go(`${base}/`);
      const result = await tab.evaluate(measure);
      const label = `${width}x${height}`;
      check(result.scrollWidth <= width, `${label}: horizontal overflow (${result.scrollWidth}px).`);
      check(result.actionHeight >= 44, `${label}: Sign in target is ${result.actionHeight}px tall.`);
      check(result.actionBottom <= height, `${label}: Sign in is below the fold (bottom ${Math.round(result.actionBottom)}px).`);
      check(result.wordmarkFont.includes('Cormorant Garamond') && result.fontsLoaded.some((face) => face.startsWith('Cormorant Garamond')), `${label}: display font did not load.`);
      for (const [name, point] of Object.entries(heads)) check(contains(result.visible, point), `${label}: ${name} is cropped out of the artwork.`);
      if (result.overlay) {
        const [left, top, right, bottom] = result.panel;
        check(left >= 0 && top >= 0 && right <= width && bottom <= height, `${label}: panel leaves the viewport.`);
        // Allow half a pixel of rounding against the hard limit recorded in the manifest.
        const tolerance = 0.5 / Math.min(width, height);
        check(result.panelVideo[0] >= focal.panelLimit[0] - tolerance && result.panelVideo[1] >= focal.panelLimit[1] - tolerance, `${label}: panel crosses the panel limit (${result.panelVideo.slice(0, 2).map((value) => value.toFixed(3))}).`);
        check(!intersects(result.panelVideo, focal.celestialFigure), `${label}: panel covers the celestial figure.`);
        check(!intersects(result.panelVideo, focal.seatedFigure), `${label}: panel covers the seated figure.`);
        check(!crossesSegment(result.panelVideo, focal.gaze), `${label}: panel crosses the gaze line.`);
        result.panelZoneShare = Number(overlapShare(result.panelVideo, focal.panelZone).toFixed(2));
      } else {
        result.split = result.panel[0] >= Math.floor(result.artRight);
        check(result.split || result.panel[1] >= Math.floor(result.artBottom), `${label}: panel overlaps the artwork.`);
      }
      result.panelVideo = result.panelVideo.map((value) => Number(value.toFixed(3)));
      result.visible = result.visible.map((value) => Number(value.toFixed(3)));
      const { data } = await tab.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: !result.overlay });
      await writeFile(path.join(outDirectory, `splash-${label}.png`), Buffer.from(data, 'base64'));
      report.viewports.push({ viewport: label, mode: result.overlay ? 'overlay' : result.split ? 'split' : 'stacked', panel: result.panel, panelVideo: result.panelVideo, panelZoneShare: result.panelZoneShare, visible: result.visible });
      await tab.close();
    }

    // Motion: plays when welcome, the toggle stops it and is remembered.
    const motion = await page(devtools);
    await motion.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await motion.go(`${base}/`);
    const playing = await motion.evaluate(`new Promise((resolve) => { const video = document.querySelector('.splash-motion'); const done = () => resolve({ playing: !video.paused, revealed: document.body.classList.contains('has-motion'), source: video.currentSrc.split('/').pop(), toggle: document.querySelector('.splash-motion-toggle').textContent }); if (document.body.classList.contains('has-motion')) done(); else { video.addEventListener('playing', () => setTimeout(done, 100), { once: true }); setTimeout(done, 8000); } })`);
    report.motion.default = playing;
    check(playing.playing && playing.revealed && playing.toggle === 'Pause motion', 'Motion did not start for a visitor without a reduced-motion preference.');
    // The 1440px-wide screen should load the 1920w source; this browser picks AV1 when it can decode it.
    check(/pantheon-splash-loop-1920w\.(webm|mp4)$/.test(playing.source), `Unexpected motion source ${playing.source}.`);
    const loops = await motion.evaluate(`new Promise((resolve) => { const video = document.querySelector('.splash-motion'); let wrapped = false; let last = video.currentTime; const tick = () => { if (video.currentTime < last) wrapped = true; last = video.currentTime; }; video.addEventListener('timeupdate', tick); setTimeout(() => resolve({ duration: video.duration, wrapped }), Math.max(0, (video.duration - video.currentTime) * 1000) + 1500); })`);
    report.motion.loop = loops;
    check(loops.wrapped && Math.abs(loops.duration - 265 / 24) < 0.1, `Loop did not wrap or has the wrong duration (${loops.duration}s).`);
    const keyboard = [];
    for (let index = 0; index < 2; index += 1) {
      await motion.key('Tab', 'Tab', 9);
      keyboard.push(await motion.evaluate(`({ name: document.activeElement.textContent.trim(), outline: getComputedStyle(document.activeElement).outlineStyle })`));
    }
    report.motion.keyboard = keyboard;
    check(keyboard[0].name === 'Sign in' && keyboard[1].name === 'Pause motion' && keyboard.every((entry) => entry.outline === 'solid'), 'Keyboard order or focus ring is wrong.');
    await motion.key('Enter', 'Enter', 13, '\r');
    const paused = await motion.evaluate(`new Promise((resolve) => setTimeout(() => resolve({ paused: document.querySelector('.splash-motion').paused, toggle: document.querySelector('.splash-motion-toggle').textContent, stored: localStorage.getItem('stex.pantheon.motion') }), 300))`);
    await motion.go(`${base}/`);
    const remembered = await motion.evaluate(`new Promise((resolve) => setTimeout(() => resolve({ paused: document.querySelector('.splash-motion').paused, toggle: document.querySelector('.splash-motion-toggle').textContent }), 1500))`);
    report.motion.pause = { paused, remembered };
    check(paused.paused && paused.toggle === 'Play motion' && paused.stored === 'off' && remembered.paused, 'Pausing motion did not stop the video or was not remembered.');
    await motion.close();

    // Reduced motion: nothing downloads or plays until the visitor asks.
    const reduced = await page(devtools);
    await reduced.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await reduced.go(`${base}/`);
    // Source selection may name a currentSrc under preload="none"; what matters is that no loop bytes are fetched.
    report.motion.reduced = await reduced.evaluate(`new Promise((resolve) => setTimeout(() => { const video = document.querySelector('.splash-motion'); resolve({ paused: video.paused, readyState: video.readyState, buffered: video.buffered.length, loopRequests: performance.getEntriesByType('resource').filter((entry) => entry.name.includes('splash-loop')).length, toggle: document.querySelector('.splash-motion-toggle').textContent }); }, 2500))`);
    check(report.motion.reduced.paused && report.motion.reduced.readyState === 0 && report.motion.reduced.loopRequests === 0 && report.motion.reduced.toggle === 'Play motion', 'Reduced motion still loaded or played the video.');
    await reduced.close();

    // No JavaScript: the still and the Sign in link work; no dead toggle appears.
    const plain = await page(devtools);
    await plain.send('Emulation.setScriptExecutionDisabled', { value: true });
    await plain.go(`${base}/`);
    await plain.send('Emulation.setScriptExecutionDisabled', { value: false });
    report.motion.noScript = await plain.evaluate(`({ still: document.querySelector('.splash-still').naturalWidth > 0, toggleHidden: document.querySelector('.splash-motion-toggle').hidden, href: document.querySelector('.splash-action').getAttribute('href') })`);
    check(report.motion.noScript.still && report.motion.noScript.toggleHidden && report.motion.noScript.href === '/home/', 'The no-JavaScript fallback is incomplete.');
    await plain.close();

  } finally {
    await browser?.close(); server.kill();
    await rm(books, { recursive: true, force: true });
  }
  report.failures = failures;
  await writeFile(path.join(outDirectory, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  console.log(`\nScreenshots and report.json: ${outDirectory}`);
  if (failures.length) { for (const failure of failures) console.error(`FAIL  ${failure}`); process.exit(1); }
  console.log('Splash verification passed.');
}

await main();
