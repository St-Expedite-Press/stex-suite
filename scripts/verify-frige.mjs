import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { repositoryRoot } from './assets/manifest.mjs';
import { launchBrowser, outDirectoryFromArgs, page, started } from './browser/devtools.mjs';

// Browser verification of Frige's design-system adoption: the project library
// and the workstation at phone, tablet, and desktop widths, standalone and
// through Pantheon's /frige/ mount. Starts its own servers on spare ports with
// a disposable synthetic book (never a real manuscript) and an inference
// address nothing listens on, so no turn can reach a model. Checks page
// overflow, the masthead (still, motion control, reduced motion, brand clear of
// the art), the library list, the workstation panes and their view/drawer
// controls, keyboard focus, and target sizes; saves screenshots.
//   corepack pnpm verify:frige [--out <directory>]

const viewports = [[390, 844], [768, 1024], [1024, 768], [1280, 800], [1440, 900]];
const ports = { frige: 4436, mountedFrige: 4437, pantheon: 4438, inference: 4439 };
const outDirectory = outDirectoryFromArgs('stex-frige-verification');
const dustyGarnet = 'rgb(197, 143, 150)';

// A small synthetic book: front matter and two cycles, one with a long title.
async function syntheticBook(root) {
  const book = path.join(root, 'books', 'fixture-book');
  const pieces = {
    '00_Front_Matter/Title Page.md': '# Fixture Book\n\nVerification Author\n',
    '01_First_Cycle/Morning.md': '# Morning\n\nA synthetic line for verification,\n  indented, kept as written.\n',
    '01_First_Cycle/A Considerably Longer Title That Should Never Widen The Page.md': '# A Considerably Longer Title That Should Never Widen The Page\n\nSecond synthetic piece.\n',
    '02_Second_Cycle/Weather.md': '# Weather\n\nThird synthetic piece.\n',
  };
  for (const [file, text] of Object.entries(pieces)) {
    await mkdir(path.dirname(path.join(book, 'manuscript', file)), { recursive: true });
    await writeFile(path.join(book, 'manuscript', file), text);
  }
  const links = Object.keys(pieces).map((file) => `- [${path.posix.basename(file, '.md')}](${encodeURI(file)})`).join('\n');
  await writeFile(path.join(book, 'manuscript', 'Programme.md'), `# Programme\n\n${links}\n`);
  await writeFile(path.join(book, 'README.md'), '# Fixture Book (verification)\n');
}

// Geometry and state of one page, measured in the browser.
const measure = `(async () => {
  await document.fonts.ready;
  const still = document.querySelector('.masthead-still');
  if (!still.complete) await new Promise((resolve) => { still.addEventListener('load', resolve, { once: true }); setTimeout(resolve, 4000); });
  const rect = (element) => { if (!element) return null; const box = element.getBoundingClientRect(); return [box.left, box.top, box.right, box.bottom]; };
  const visible = (element) => Boolean(element) && getComputedStyle(element).display !== 'none' && getComputedStyle(element).visibility !== 'hidden' && element.getBoundingClientRect().width > 0;
  const resolve = (property) => { const probe = document.createElement('div'); probe.style.cssText = 'position:absolute;visibility:hidden;width:var(' + property + ', 0px)'; document.querySelector('.masthead').append(probe); const width = probe.getBoundingClientRect().width; probe.remove(); return width; };
  const art = document.querySelector('.masthead-art'); const style = getComputedStyle(art);
  const toggle = document.querySelector('.motion-toggle');
  const back = document.querySelector('.back-link');
  // Every visible control a finger or pointer can hit.
  const targets = [...document.querySelectorAll('button, summary, select, input:not([type="checkbox"]):not([type="radio"]):not([type="file"]), textarea, .masthead-brand, .back-link, .project')]
    .filter(visible).filter((element) => !element.closest('.hidden, [hidden]'))
    .map((element) => ({ name: (element.id ? '#' + element.id : element.className || element.tagName) + ' ' + (element.textContent || element.getAttribute('aria-label') || '').trim().slice(0, 24), height: element.getBoundingClientRect().height, width: element.getBoundingClientRect().width }));
  return {
    viewport: [innerWidth, innerHeight], scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight,
    accent: getComputedStyle(document.documentElement).getPropertyValue('--stex-accent').trim(),
    accentColor: (() => { const probe = document.createElement('span'); probe.style.color = 'var(--stex-accent)'; document.body.append(probe); const value = getComputedStyle(probe).color; probe.remove(); return value; })(),
    displayFont: getComputedStyle(document.querySelector('h1, .page-title')).fontFamily,
    masthead: rect(document.querySelector('.masthead')), art: rect(art), brand: rect(document.querySelector('.masthead-brand')),
    // The clusters' content, not their grid cells (the start cell fills its 1fr column).
    ...Object.fromEntries(['start', 'end'].map((name) => { const boxes = [...(document.querySelector('.masthead-' + name)?.children || [])].filter(visible).map(rect); return [name, boxes.length ? [Math.min(...boxes.map((box) => box[0])), Math.min(...boxes.map((box) => box[1])), Math.max(...boxes.map((box) => box[2])), Math.max(...boxes.map((box) => box[3]))] : null]; })),
    clear: resolve('--clear'), inset: resolve('--brand-inset'), clearStart: resolve('--clear-start'), clearEnd: resolve('--clear-end'),
    masked: Boolean((style.maskImage || style.webkitMaskImage) && (style.maskImage || style.webkitMaskImage) !== 'none'),
    still: { loaded: still.complete && still.naturalWidth > 0, source: still.currentSrc.split('/').pop() },
    video: { paused: document.querySelector('.masthead-motion').paused, loopRequests: performance.getEntriesByType('resource').filter((entry) => entry.name.includes('masthead-loop')).length },
    toggle: { visible: visible(toggle), text: toggle?.textContent.trim() },
    back: { visible: visible(back), href: back?.getAttribute('href') },
    targets: targets.filter((target) => target.height < 40 - 0.5),
    panes: Object.fromEntries(['#navigator', '#conversation', '#preview', '#production-status', '.workspace-views'].map((selector) => [selector, visible(document.querySelector(selector)) ? rect(document.querySelector(selector)) : null])),
    view: document.querySelector('.studio-shell')?.dataset.view || null,
    projects: [...document.querySelectorAll('.project-list li a.project')].map((link) => [link.querySelector('strong').textContent, link.getAttribute('href')]),
    tree: document.querySelectorAll('#book-tree button').length,
  };
})()`;

// Tab through the page and record whether each focused control shows a ring.
const focusState = `(() => {
  const element = document.activeElement; if (!element || element === document.body) return null;
  const style = getComputedStyle(element); const box = element.closest('.composer-box');
  const ring = style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) >= 2;
  const boxRing = Boolean(box) && getComputedStyle(box).boxShadow !== 'none';
  const shown = element.getBoundingClientRect(); const onScreen = shown.bottom > 0 && shown.right > 0 && shown.top < innerHeight && shown.left < innerWidth;
  return { name: (element.id ? '#' + element.id : element.className || element.tagName) + ' ' + (element.textContent || element.getAttribute('aria-label') || '').trim().replace(/\\s+/g, ' ').slice(0, 30), visible: ring || boxRing, onScreen };
})()`;

async function main() {
  await mkdir(outDirectory, { recursive: true });
  const standaloneData = await mkdtemp(path.join(os.tmpdir(), 'stex-verify-frige-'));
  const mountedData = await mkdtemp(path.join(os.tmpdir(), 'stex-verify-frige-mounted-'));
  await syntheticBook(standaloneData); await syntheticBook(mountedData);
  const inference = { STEX_INFERENCE_URL: `http://127.0.0.1:${ports.inference}`, STEX_INFERENCE_SHARED_SECRET: 'verification-only' };
  const node = (directory, env) => spawn(process.execPath, ['server.mjs'], { cwd: path.join(repositoryRoot, directory), env: { ...process.env, ...inference, ...env } });
  const frige = (port, data, mount) => node('apps/frige', { STEX_FRIGE_PORT: String(port), STEX_FRIGE_BOOKS_DIR: path.join(data, 'books'), STEX_FRIGE_PROJECT_DIR: data, STEX_FRIGE_PROJECTS_DIR: path.join(data, 'projects'), STEX_FRIGE_BASE_PATH: mount, TEXGRAPH_BASE_PATH: mount, STEX_FRIGE_SHELL_URL: mount ? '/home/' : '', TEXGRAPH_SHELL_URL: '' });
  const children = [
    frige(ports.frige, standaloneData, ''),
    frige(ports.mountedFrige, mountedData, '/frige'),
    node('apps/pantheon', { STEX_PANTHEON_PORT: String(ports.pantheon), STEX_FRIGE_URL: `http://127.0.0.1:${ports.mountedFrige}`, STEX_FRIGE_BOOKS_DIR: path.join(mountedData, 'books'), STEX_SEAXNEAT_URL: `http://127.0.0.1:${ports.inference}`, STEX_IGOR_URL: `http://127.0.0.1:${ports.inference}` }),
  ];
  const failures = []; const report = { viewports: [], motion: {}, mounted: {} };
  const check = (condition, message) => { if (!condition) failures.push(message); return condition; };
  let browser;
  try {
    await Promise.all(children.map((child, index) => started(child, /ready|listening|running/i, ['Frige', 'Frige (mounted)', 'Pantheon'][index])));
    browser = await launchBrowser();
    const { devtools } = browser; report.browser = browser.browserPath;
    const standalone = `http://127.0.0.1:${ports.frige}`;
    const treeReady = (tab) => tab.evaluate(`new Promise((resolve) => { const poll = () => (document.querySelector('#book-tree .tree-book') && document.querySelector('#conversation-title').textContent !== 'Choose a node') ? resolve(true) : setTimeout(poll, 50); setTimeout(() => resolve(false), 8000); poll(); })`);
    const listReady = (tab) => tab.evaluate(`new Promise((resolve) => { const poll = () => document.querySelector('.project-list, #projects .empty:not(:first-child), #projects .error') ? resolve(true) : setTimeout(poll, 50); setTimeout(() => resolve(false), 6000); poll(); })`);
    const shot = async (tab, name) => { const { data } = await tab.send('Page.captureScreenshot', { format: 'png' }); await writeFile(path.join(outDirectory, `${name}.png`), Buffer.from(data, 'base64')); };
    const tabThrough = async (tab, count) => {
      const seen = [];
      for (let index = 0; index < count; index += 1) { await tab.key('Tab', 'Tab', 9); const state = await tab.evaluate(focusState); if (state) seen.push(state); }
      return seen;
    };

    // The brand and controls never sit on visible art: on their own row above
    // or below it, or inside the mask's transparent zone.
    const clearOfArt = (result, label) => {
      const [artLeft, artTop, artRight, artBottom] = result.art;
      const ownRow = (box) => !box || box[3] <= artTop + 0.5 || box[1] >= artBottom - 0.5;
      if (result.start) { // compact
        if (result.masked) {
          check(result.start[2] <= artLeft + result.clearStart + 0.5, `${label}: the brand cluster (right ${result.start[2]}) runs into visible art (clear to ${result.clearStart}).`);
          check(result.end[0] >= artRight - result.clearEnd - 0.5, `${label}: the controls (left ${result.end[0]}) run into visible art (clear from ${artRight - result.clearEnd}).`);
        } else check(ownRow(result.start) && ownRow(result.end), `${label}: the compact masthead bar overlaps the art strip.`);
      } else if (result.masked) {
        check(result.brand[0] >= artLeft + result.inset - 0.5 && result.brand[2] <= artLeft + result.clear + 0.5, `${label}: the brand overlaps visible masthead art.`);
      } else check(ownRow(result.brand), `${label}: the brand overlaps the masthead art.`);
    };
    const common = (result, label) => {
      check(result.scrollWidth <= result.viewport[0], `${label}: horizontal overflow (${result.scrollWidth}px > ${result.viewport[0]}px).`);
      check(result.still.loaded, `${label}: the masthead still did not load.`);
      check(result.toggle.visible && /^(Pause|Play) motion$/.test(result.toggle.text), `${label}: motion control missing (${JSON.stringify(result.toggle)}).`);
      check(result.accentColor === dustyGarnet, `${label}: accent is ${result.accentColor}, not Dusty Garnet.`);
      check(/Cormorant Garamond/.test(result.displayFont) || /EB Garamond/.test(result.displayFont), `${label}: heading font is ${result.displayFont}.`);
      check(!result.back.visible, `${label}: standalone Frige shows a Pantheon link.`);
      check(result.targets.length === 0, `${label}: targets under 40px: ${JSON.stringify(result.targets)}.`);
      clearOfArt(result, label);
    };

    for (const [width, height] of viewports) {
      const label = `${width}x${height}`;
      const entry = { viewport: label };
      // Reduced motion throughout the layout pass: the loop must stay paused and unfetched.
      const lobby = await page(devtools);
      await lobby.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 });
      await lobby.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
      await lobby.go(`${standalone}/`);
      check(await listReady(lobby), `${label} lobby: the project list did not render.`);
      const library = await lobby.evaluate(measure);
      common(library, `${label} lobby`);
      check(library.video.paused && library.video.loopRequests === 0 && library.toggle.text === 'Play motion', `${label} lobby: reduced motion did not keep the loop still (${JSON.stringify(library.video)}, ${library.toggle.text}).`);
      check(JSON.stringify(library.projects) === JSON.stringify([['Fixture Book (verification)', './?book=fixture-book']]), `${label} lobby: list shows ${JSON.stringify(library.projects)}.`);
      const lobbyFocus = await tabThrough(lobby, 6);
      check(lobbyFocus.length >= 5 && lobbyFocus.every((state) => state.visible), `${label} lobby: focus not visible on ${JSON.stringify(lobbyFocus.filter((state) => !state.visible))}.`);
      check(/Skip to content/.test(lobbyFocus[0]?.name) && /masthead-brand/.test(lobbyFocus[1]?.name) && /motion-toggle/.test(lobbyFocus[2]?.name), `${label} lobby: keyboard order ${lobbyFocus.map((state) => state.name).join(' → ')}.`);
      await shot(lobby, `lobby-${label}`);
      entry.lobby = { still: library.still.source, mastheadHeight: library.masthead[3] - library.masthead[1], focus: lobbyFocus.map((state) => state.name) };
      await lobby.close();

      const tab = await page(devtools);
      await tab.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 });
      await tab.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
      await tab.go(`${standalone}/?book=fixture-book`);
      check(await treeReady(tab), `${label} workstation: the book did not load.`);
      const work = await tab.evaluate(measure);
      common(work, `${label} workstation`);
      check(work.scrollHeight <= height, `${label} workstation: page-level vertical scroll (${work.scrollHeight}px > ${height}px).`);
      const mastheadHeight = work.masthead[3] - work.masthead[1];
      check(mastheadHeight >= 72 && mastheadHeight <= 96, `${label} workstation: compact masthead is ${mastheadHeight}px (72–96).`);
      check(work.video.paused && work.video.loopRequests === 0 && work.toggle.text === 'Play motion', `${label} workstation: reduced motion did not keep the loop still.`);
      const panes = work.panes;
      const inside = (box) => box && box[0] >= -0.5 && box[2] <= width + 0.5;
      entry.workstation = { mastheadHeight, still: work.still.source, view: work.view, panes: Object.fromEntries(Object.entries(panes).map(([key, box]) => [key, box ? `${Math.round(box[0])}-${Math.round(box[2])}` : 'hidden'])) };
      if (width >= 1024) {
        check(panes['#navigator'] && panes['#conversation'] && panes['#preview'] && !panes['.workspace-views'], `${label}: desktop should show three columns (${JSON.stringify(entry.workstation.panes)}).`);
        check(panes['#navigator'][2] <= panes['#conversation'][0] + 0.5 && panes['#conversation'][2] <= panes['#preview'][0] + 0.5 && inside(panes['#preview']), `${label}: columns overlap or overflow.`);
      } else if (width >= 640) {
        check(!panes['#navigator'] && panes['#conversation'] && panes['#preview'] && panes['.workspace-views'], `${label}: tablet should show two regions and a Contents control (${JSON.stringify(entry.workstation.panes)}).`);
        await tab.evaluate(`document.querySelector('.workspace-views [data-view="contents"]').click()`);
        await tab.evaluate(`new Promise((resolve) => setTimeout(resolve, 300))`);
        const drawer = await tab.evaluate(`({ open: getComputedStyle(document.querySelector('#navigator')).visibility === 'visible', expanded: document.querySelector('[data-view="contents"]').getAttribute('aria-expanded'), box: (() => { const b = document.querySelector('#navigator').getBoundingClientRect(); return [b.left, b.right]; })(), focus: document.activeElement?.className })`);
        check(drawer.open && drawer.expanded === 'true' && drawer.box[0] >= -0.5 && drawer.box[1] <= width, `${label}: the Contents drawer did not open in view (${JSON.stringify(drawer)}).`);
        await shot(tab, `workstation-${label}-drawer`);
        await tab.key('Escape', 'Escape', 27);
        await tab.evaluate(`new Promise((resolve) => setTimeout(resolve, 300))`);
        const closed = await tab.evaluate(`({ hidden: getComputedStyle(document.querySelector('#navigator')).visibility === 'hidden', focus: document.activeElement?.dataset.view })`);
        check(closed.hidden && closed.focus === 'contents', `${label}: Escape did not close the drawer and return focus (${JSON.stringify(closed)}).`);
        entry.workstation.drawer = { opened: drawer, closed };
      } else {
        check(work.view === 'editor' && !panes['#navigator'] && panes['#conversation'] && !panes['#preview'] && panes['.workspace-views'], `${label}: phone should open on the editor alone (${JSON.stringify(entry.workstation.panes)}).`);
        const views = {};
        for (const view of ['proof', 'contents']) {
          await tab.evaluate(`document.querySelector('.workspace-views [data-view="${view}"]').click()`);
          views[view] = await tab.evaluate(`({ shown: ['#navigator', '#conversation', '#preview'].filter((selector) => getComputedStyle(document.querySelector(selector)).display !== 'none'), pressed: document.querySelector('[data-view="${view}"]').getAttribute('aria-pressed'), scrollWidth: document.documentElement.scrollWidth })`);
          await shot(tab, `workstation-${label}-${view}`);
        }
        check(JSON.stringify(views.proof.shown) === '["#preview"]' && views.proof.pressed === 'true' && views.proof.scrollWidth <= width, `${label}: Proof view ${JSON.stringify(views.proof)}.`);
        check(JSON.stringify(views.contents.shown) === '["#navigator"]' && views.contents.pressed === 'true' && views.contents.scrollWidth <= width, `${label}: Contents view ${JSON.stringify(views.contents)}.`);
        // Choosing the whole book moves on to the editor.
        await tab.evaluate(`document.querySelector('#book-tree .tree-book').click()`);
        await tab.evaluate(`new Promise((resolve) => setTimeout(resolve, 400))`);
        const after = await tab.evaluate(`document.querySelector('.studio-shell').dataset.view`);
        check(after === 'editor', `${label}: choosing from Contents left the view on ${after}.`);
        await tab.evaluate(`document.querySelector('.workspace-views [data-view="editor"]').click()`);
        entry.workstation.views = views;
      }
      await tab.go(`${standalone}/?book=fixture-book`); await treeReady(tab);
      const workFocus = await tabThrough(tab, 14);
      check(workFocus.length >= 10 && workFocus.every((state) => state.visible), `${label} workstation: focus not visible on ${JSON.stringify(workFocus.filter((state) => !state.visible))}.`);
      const names = workFocus.map((state) => state.name).join(' | ');
      check(/Skip to the workspace/.test(names) && /masthead-brand/.test(names) && /motion-toggle/.test(names) && /Settings/.test(names), `${label} workstation: keyboard did not reach the masthead controls (${names}).`);
      entry.workstation.focus = workFocus.map((state) => state.name);
      await tab.evaluate(`document.activeElement.blur()`);
      await shot(tab, `workstation-${label}`);
      await tab.close();
      report.viewports.push(entry);
    }

    // Motion without reduced motion: plays, pauses on request, and the choice is stored.
    const moving = await page(devtools);
    await moving.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await moving.go(`${standalone}/?book=fixture-book`);
    report.motion.default = await moving.evaluate(`new Promise((resolve) => { const video = document.querySelector('.masthead-motion'); const done = () => resolve({ playing: !video.paused, source: video.currentSrc.split('/').pop(), toggle: document.querySelector('.motion-toggle').textContent.trim(), state: document.querySelector('.masthead').dataset.motion || null }); if (!video.paused) setTimeout(done, 200); else { video.addEventListener('playing', () => setTimeout(done, 200), { once: true }); setTimeout(done, 8000); } })`);
    check(report.motion.default.playing && report.motion.default.source === 'pantheon-masthead-loop-1920w.webm' && report.motion.default.toggle === 'Pause motion' && report.motion.default.state === 'playing', `Masthead motion: ${JSON.stringify(report.motion.default)}.`);
    await moving.evaluate(`document.querySelector('.motion-toggle').click()`);
    report.motion.paused = await moving.evaluate(`new Promise((resolve) => setTimeout(() => resolve({ paused: document.querySelector('.masthead-motion').paused, toggle: document.querySelector('.motion-toggle').textContent.trim(), stored: localStorage.getItem('stex.pantheon.motion') }), 200))`);
    check(report.motion.paused.paused && report.motion.paused.toggle === 'Play motion' && report.motion.paused.stored === 'off', `Pause control: ${JSON.stringify(report.motion.paused)}.`);
    await moving.go(`${standalone}/`);
    report.motion.remembered = await moving.evaluate(`new Promise((resolve) => setTimeout(() => resolve({ paused: document.querySelector('.masthead-motion').paused, toggle: document.querySelector('.motion-toggle').textContent.trim() }), 1500))`);
    check(report.motion.remembered.paused && report.motion.remembered.toggle === 'Play motion', `Stored pause on the library: ${JSON.stringify(report.motion.remembered)}.`);
    await moving.close();

    // The source editor and the publication profile: denser controls, same rules.
    for (const [width, height] of [[1280, 800], [390, 844]]) {
      const tab = await page(devtools);
      await tab.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 });
      await tab.go(`${standalone}/?book=fixture-book`); await treeReady(tab);
      await tab.evaluate(`document.querySelector('#show-source').click()`);
      const source = await tab.evaluate(`({ shown: getComputedStyle(document.querySelector('#source-panel')).display !== 'none', font: getComputedStyle(document.querySelector('#source')).fontFamily, text: document.querySelector('#source').value.length > 0 })`);
      check(source.shown && /IBM Plex Mono/.test(source.font) && source.text, `${width}px source view: ${JSON.stringify(source)}.`);
      if (width < 640) { await shot(tab, `workstation-${width}x${height}-source`); await tab.evaluate(`document.querySelector('.workspace-views [data-view="proof"]').click()`); }
      await tab.evaluate(`document.querySelector('#open-design').click()`);
      await tab.evaluate(`new Promise((resolve) => setTimeout(resolve, 300))`);
      const result = await tab.evaluate(measure);
      check(result.scrollWidth <= width && result.scrollHeight <= height && result.targets.length === 0, `${width}px source and design: ${JSON.stringify({ scrollWidth: result.scrollWidth, scrollHeight: result.scrollHeight, targets: result.targets })}.`);
      await shot(tab, `workstation-${width}x${height}-${width < 640 ? 'design' : 'source-design'}`);
      await tab.close();
    }

    // Through Pantheon's /frige/ mount: same design system, own media, and the way back.
    const shell = `http://127.0.0.1:${ports.pantheon}`;
    for (const [name, url, ready] of [['lobby', `${shell}/frige/`, listReady], ['workstation', `${shell}/frige/?book=fixture-book`, treeReady]]) {
      const tab = await page(devtools);
      await tab.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
      await tab.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
      await tab.go(url);
      check(await ready(tab), `mounted ${name}: did not render.`);
      const result = await tab.evaluate(measure);
      const resources = await tab.evaluate(`performance.getEntriesByType('resource').map((entry) => new URL(entry.name).pathname).filter((pathname) => /design-system|media\\//.test(pathname))`);
      check(result.scrollWidth <= 1280 && result.still.loaded && result.accentColor === dustyGarnet, `mounted ${name}: ${JSON.stringify({ scrollWidth: result.scrollWidth, still: result.still, accent: result.accentColor })}.`);
      check(result.back.visible && result.back.href === '/home/', `mounted ${name}: the Pantheon link is ${JSON.stringify(result.back)}.`);
      check(resources.length > 0 && resources.every((pathname) => pathname.startsWith('/frige/')), `mounted ${name}: assets not served from Frige's mount: ${resources.filter((pathname) => !pathname.startsWith('/frige/')).join(', ')}.`);
      report.mounted[name] = { still: result.still.source, back: result.back, resources: resources.length };
      await shot(tab, `mounted-${name}-1280x800`);
      await tab.close();
    }
  } finally {
    await browser?.close();
    for (const child of children) child.kill();
    for (const data of [standaloneData, mountedData]) await rm(data, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
  }
  report.failures = failures;
  await writeFile(path.join(outDirectory, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  console.log(`\nScreenshots and report.json: ${outDirectory}`);
  if (failures.length) { for (const failure of failures) console.error(`FAIL  ${failure}`); process.exit(1); }
  console.log('Frige verification passed.');
}

await main();
