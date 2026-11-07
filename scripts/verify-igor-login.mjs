import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readManifest, repositoryRoot } from './assets/manifest.mjs';
import { launchBrowser, outDirectoryFromArgs, page, started } from './browser/devtools.mjs';

// Browser verification of hosted Igor's sign-in page: the Pantheon splash with
// a real email-and-password form. Starts the built Igor (stex-igor/apps/igor,
// run `corepack pnpm build:igor` first) in password mode with a disposable
// user, checks that the panel keeps the splash's focal limits at every
// viewport with Sign in above the fold, then signs in for real: a wrong
// password is refused in the panel, and the right one lands in Igor.
//   corepack pnpm verify:igor-login [--out <directory>]

const viewports = [[1920, 1080], [1920, 969], [1536, 730], [1440, 789], [1366, 657], [1280, 689], [1280, 600], [1920, 640], [900, 720],
  [2560, 1080], [1024, 768], [768, 1024], [390, 844], [844, 390], [320, 568]];
const port = Number(process.env.STEX_VERIFY_PORT || 4427);
const outDirectory = outDirectoryFromArgs('stex-igor-login-verification');
const igorDirectory = path.join(repositoryRoot, 'stex-igor', 'apps', 'igor');

const measure = `(async () => {
  await document.fonts.ready;
  const image = document.querySelector('.splash-still');
  if (!image.complete) await new Promise((resolve) => image.addEventListener('load', resolve, { once: true }));
  const rect = (selector) => { const r = document.querySelector(selector).getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom].map(Math.round); };
  const panel = document.querySelector('.splash-panel').getBoundingClientRect();
  const box = image.getBoundingClientRect();
  const [px, py] = getComputedStyle(image).objectPosition.split(' ').map((value) => parseFloat(value) / 100);
  const scale = Math.max(box.width / 1920, box.height / 1080), width = 1920 * scale, height = 1080 * scale;
  const ox = box.left + (box.width - width) * px, oy = box.top + (box.height - height) * py;
  const toVideo = (x, y) => [(x - ox) / width, (y - oy) / height];
  const shown = (selector) => getComputedStyle(document.querySelector(selector)).display !== 'none';
  return {
    overlay: getComputedStyle(document.querySelector('.splash-entrance')).position === 'absolute',
    panel: [panel.left, panel.top, panel.right, panel.bottom].map(Math.round),
    panelVideo: [...toVideo(panel.left, panel.top), ...toVideo(panel.right, panel.bottom)],
    artBottom: box.bottom, artRight: box.right, scrollWidth: document.documentElement.scrollWidth,
    button: rect('.splash-action'), email: rect('#username'), password: rect('#password'),
    shown: { emblem: shown('.splash-emblem'), rule: shown('.splash-rule'), tagline: shown('.splash-tagline') },
    wordmarkFont: getComputedStyle(document.querySelector('.stex-wordmark__name')).fontFamily,
  };
})()`;

const intersects = (a, b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
const contains = (rect, [x, y]) => x >= rect[0] && x <= rect[2] && y >= rect[1] && y <= rect[3];
const crossesSegment = (rect, [x1, y1, x2, y2]) => Array.from({ length: 201 }, (_, i) => [x1 + (x2 - x1) * i / 200, y1 + (y2 - y1) * i / 200]).some((point) => contains(rect, point));

async function main() {
  const focal = (await readManifest()).assets.find((asset) => asset.id === 'P10').focal;
  const { hashPassword } = await import(new URL(`file:///${path.join(igorDirectory, 'server', 'auth.mjs').replace(/\\/g, '/')}`).href);
  await mkdir(outDirectory, { recursive: true });
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'stex-igor-login-'));
  const usersFile = path.join(scratch, 'users.json');
  await writeFile(usersFile, JSON.stringify({ users: [{ username: 'reader@example.test', passwordHash: await hashPassword('a verification password', 100_000), role: 'owner', active: true }] }));
  const server = spawn(process.execPath, ['server.mjs'], { cwd: igorDirectory, env: { ...process.env,
    STEX_IGOR_PORT: String(port), STEX_IGOR_DATA_DIR: path.join(scratch, 'data'), STEX_INFERENCE_URL: 'http://127.0.0.1:9', STEX_INFERENCE_SHARED_SECRET: 'verify-secret',
    STEX_IGOR_PUBLIC_ORIGIN: 'https://igor.example.test', STEX_IGOR_AUTH: 'password', STEX_IGOR_USERS_FILE: usersFile, STEX_IGOR_SESSION_SECRET: randomBytes(32).toString('hex') } });
  const failures = []; const report = { viewports: [] };
  const check = (condition, message) => { if (!condition) failures.push(message); return condition; };
  let browser;
  try {
    await started(server, /listening|ready/i, 'Igor');
    browser = await launchBrowser();
    const { devtools } = browser; report.browser = browser.browserPath;
    const base = `http://127.0.0.1:${port}`;

    for (const [width, height] of viewports) {
      const tab = await page(devtools);
      await tab.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 });
      await tab.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
      await tab.go(`${base}/igor/login`);
      const result = await tab.evaluate(measure);
      const label = `${width}x${height}`;
      check(result.scrollWidth <= width, `${label}: horizontal overflow (${result.scrollWidth}px).`);
      check(result.button[3] - result.button[1] >= 44, `${label}: Sign in is ${result.button[3] - result.button[1]}px tall.`);
      check(result.email[3] - result.email[1] >= 38 && result.password[3] - result.password[1] >= 38, `${label}: a field is under 38px tall.`);
      check(result.button[3] <= height, `${label}: Sign in is below the fold (bottom ${result.button[3]}px).`);
      check(result.wordmarkFont.includes('Cormorant Garamond'), `${label}: display font did not load.`);
      if (result.overlay) {
        const [left, top, right, bottom] = result.panel;
        check(left >= 0 && top >= 0 && right <= width && bottom <= height, `${label}: panel leaves the viewport.`);
        const tolerance = 0.5 / Math.min(width, height);
        check(result.panelVideo[0] >= focal.panelLimit[0] - tolerance && result.panelVideo[1] >= focal.panelLimit[1] - tolerance, `${label}: panel crosses the panel limit (${result.panelVideo.slice(0, 2).map((value) => value.toFixed(3))}).`);
        check(!intersects(result.panelVideo, focal.celestialFigure), `${label}: panel covers the celestial figure.`);
        check(!intersects(result.panelVideo, focal.seatedFigure), `${label}: panel covers the seated figure.`);
        check(!crossesSegment(result.panelVideo, focal.gaze), `${label}: panel crosses the gaze line.`);
      } else {
        const split = result.panel[0] >= Math.floor(result.artRight);
        check(split || result.panel[1] >= Math.floor(result.artBottom), `${label}: panel overlaps the artwork.`);
      }
      const { data } = await tab.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: !result.overlay });
      await writeFile(path.join(outDirectory, `login-${label}.png`), Buffer.from(data, 'base64'));
      report.viewports.push({ viewport: label, mode: result.overlay ? 'overlay' : 'stacked/split', panel: result.panel, shown: result.shown });
      await tab.close();
    }

    // A real sign-in: the wrong password is refused in the panel; the right one lands in Igor.
    const tab = await page(devtools);
    await tab.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await tab.go(`${base}/igor/c/abcdefabcdef`);
    const redirected = await tab.evaluate('location.pathname + location.search');
    check(redirected === '/igor/login?next=%2Figor%2Fc%2Fabcdefabcdef', `Signed-out visit was not sent to sign-in (${redirected}).`);
    const fill = (password) => `(() => { const set = (id, value) => { const input = document.getElementById(id); input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); }; set('username', 'Reader@example.test'); set('password', ${JSON.stringify(password)}); document.querySelector('.splash-action').click(); })()`;
    await tab.evaluate(fill('not the password'));
    const refused = await tab.evaluate(`new Promise((resolve) => { const started = Date.now(); const poll = () => { const text = document.getElementById('login-error').textContent; if (text || Date.now() - started > 8000) resolve(text); else setTimeout(poll, 100); }; poll(); })`);
    check(/do not match/.test(refused), `Wrong password showed "${refused}".`);
    await tab.evaluate(fill('a verification password'));
    let after = '';
    for (let tries = 0; tries < 40 && after !== '/igor/c/abcdefabcdef'; tries += 1) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      after = await tab.evaluate('location.pathname').catch(() => '');
    }
    check(after === '/igor/c/abcdefabcdef', `Sign-in did not return to the requested page (${after}).`);
    const session = await tab.evaluate(`fetch('/igor/api/session').then((response) => response.json())`);
    check(session.username === 'reader@example.test', 'The session endpoint does not report the signed-in user.');
    const { data } = await tab.send('Page.captureScreenshot', { format: 'png' });
    await writeFile(path.join(outDirectory, 'signed-in-1440x900.png'), Buffer.from(data, 'base64'));
    await tab.close();
  } finally {
    await browser?.close();
    server.kill();
    await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
  await writeFile(path.join(outDirectory, 'report.json'), JSON.stringify({ ...report, failures }, null, 2));
  console.log(JSON.stringify(report.viewports.map(({ viewport, mode, shown }) => `${viewport} ${mode} ${Object.entries(shown).filter(([, on]) => on).map(([name]) => name).join('+') || 'compact'}`), null, 1));
  console.log(`\nScreenshots and report.json: ${outDirectory}`);
  if (failures.length) { for (const failure of failures) console.error(`FAIL ${failure}`); process.exitCode = 1; }
  else console.log('Igor sign-in verification passed.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
