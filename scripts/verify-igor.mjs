import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import http from 'node:http';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { repositoryRoot } from './assets/manifest.mjs';
import { launchBrowser, outDirectoryFromArgs, page, started } from './browser/devtools.mjs';

// Browser acceptance for Igor (milestone I1). Runs an isolated stack on spare
// ports with disposable data: Pantheon, the Igor server (built interface), and
// a counting stub in place of services/inference, so "exactly once" and
// session continuity are measured rather than assumed. The stub answers like
// the fake transport (labelled simulated); it is not evidence of live Hermes.
//   corepack pnpm build:igor && corepack pnpm verify:igor [--out <directory>]

const ports = { pantheon: 4435, igor: 4436, inference: 4437 };
const outDirectory = outDirectoryFromArgs('stex-igor-verification');
const secret = 'verify-igor-shared-secret';
const replyDelayMs = 1500;
const viewports = [[1440, 900], [1280, 800], [1024, 768], [768, 1024], [390, 844]];

// Stub inference: records every turn, answers after a delay, fails on demand.
function inferenceStub(state) {
  return http.createServer(async (request, response) => {
    const json = (status, value) => { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(value)); };
    if (request.url.startsWith('/v1/hermes/health')) return json(200, { ok: true, contract: 'stex.hermes.turn.v1', transport: 'fake', configured: true });
    if (request.url !== '/v1/hermes/turn' || request.method !== 'POST') return json(404, { error: 'not found' });
    let raw = ''; for await (const part of request) raw += part;
    const turn = JSON.parse(raw);
    state.turns.push({ token: request.headers['x-stex-inference-token'], turn, at: Date.now() });
    const latest = turn.conversation.messages.at(-1).content;
    await new Promise((resolve) => setTimeout(resolve, replyDelayMs));
    if (latest.includes('please fail') && !state.failedOnce.has(turn.requestId)) { state.failedOnce.add(turn.requestId); return json(503, { code: 'HERMES_UNAVAILABLE', error: 'stub outage' }); }
    const text = latest.includes('markdown test')
      ? 'Here is **bold** text.\n\n<script>window.__igorXss = 1</script>\n\n[bad link](javascript:window.__igorXss=2) and [good link](https://example.com)\n\n![tracker](https://example.com/pixel.png)\n\n```js\nconst x = 1;\n```'
      : `Simulated reply ${state.turns.length}: ${latest.slice(0, 80)}`;
    json(200, { contract: 'stex.hermes.turn.v1', requestId: turn.requestId, status: 'completed', events: [{ sequence: 1, type: 'message', payload: { text } }], usage: { transport: 'fake' } });
  });
}

async function main() {
  const dist = path.join(repositoryRoot, 'apps', 'igor', 'dist', 'index.html');
  if (!existsSync(dist)) throw new Error('Igor is not built: run corepack pnpm build:igor first.');
  await mkdir(outDirectory, { recursive: true });
  const data = await mkdtemp(path.join(os.tmpdir(), 'stex-verify-igor-'));
  const state = { turns: [], failedOnce: new Set() };
  const stub = inferenceStub(state);
  await new Promise((resolve) => stub.listen(ports.inference, '127.0.0.1', resolve));
  const node = (directory, env) => spawn(process.execPath, ['server.mjs'], { cwd: path.join(repositoryRoot, directory), env: { ...process.env, ...env } });
  const children = [
    node('apps/igor', { STEX_IGOR_PORT: String(ports.igor), STEX_IGOR_DATA_DIR: path.join(data, 'igor'), STEX_INFERENCE_URL: `http://127.0.0.1:${ports.inference}`, STEX_INFERENCE_SHARED_SECRET: secret }),
    node('apps/pantheon', { STEX_PANTHEON_PORT: String(ports.pantheon), STEX_IGOR_URL: `http://127.0.0.1:${ports.igor}`, STEX_FRIGE_URL: 'http://127.0.0.1:4498', STEX_SEAXNEAT_URL: 'http://127.0.0.1:4499', STEX_FRIGE_BOOKS_DIR: path.join(data, 'books') }),
  ];
  const failures = []; const report = { flows: {}, viewports: [] };
  const check = (condition, message) => { if (!condition) failures.push(message); return condition; };
  let browser;
  try {
    await Promise.all(children.map((child, index) => started(child, /ready/i, ['Igor', 'Pantheon'][index])));
    browser = await launchBrowser();
    const { devtools } = browser; report.browser = browser.browserPath;
    const base = `http://127.0.0.1:${ports.pantheon}`;
    const tab = await page(devtools);
    await tab.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    // Polls from Node, so a cross-document navigation (the handoff) only loses one probe.
    const waitFor = async (expression, timeout = 8000) => {
      const end = Date.now() + timeout;
      for (;;) {
        // A DOM node does not survive CDP's by-value return, so it is reported as true.
        const value = await tab.evaluate(`(() => { try { const value = (${expression}); return value instanceof Node ? true : value; } catch { return false; } })()`).catch(() => false);
        if (value) return value;
        if (Date.now() > end) return false;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    };
    const type = async (selector, text) => { await tab.evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`); await tab.send('Input.insertText', { text }); };
    const enter = (modifiers = 0) => tab.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, modifiers, text: '\r' }).then(() => tab.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, modifiers }));
    const transcript = () => tab.evaluate(`[...document.querySelectorAll('.igor-message')].map((node) => ({ role: node.classList.contains('igor-message--user') ? 'user' : 'assistant', status: node.dataset.status, text: node.querySelector('.igor-message__content')?.textContent.trim() || '', badge: node.querySelector('.igor-message__badge')?.textContent.trim() || null }))`);

    // 1. Handoff from the Pantheon home composer: navigation happens before the reply.
    await tab.go(`${base}/home/`);
    await waitFor(`!document.querySelector('.igor-input').disabled`);
    await type('.igor-input', 'Help me plan a publishing workflow.');
    const submittedAt = Date.now();
    await tab.evaluate(`document.querySelector('.igor-form').requestSubmit()`);
    const arrived = await waitFor(`/^\\/igor\\/c\\/[a-z0-9]{12}$/.test(location.pathname) && document.querySelector('.igor-message--user') && location.pathname`);
    const navigatedAt = Date.now();
    check(arrived, 'The home composer did not open a conversation in Igor.');
    const pendingShown = await waitFor(`document.querySelector('.igor-message--assistant[data-status="pending"]')`, 1000);
    check(pendingShown, `Igor did not show the pending reply after the handoff: ${JSON.stringify(await transcript())}`);
    check(state.turns.length <= 1 && navigatedAt - submittedAt < replyDelayMs + 1000, `Navigation waited for inference (${navigatedAt - submittedAt} ms).`);
    await waitFor(`document.querySelector('.igor-message--assistant[data-status="complete"]')`);
    let messages = await transcript();
    report.flows.handoff = { route: arrived, messages, turns: state.turns.length, navigationMs: navigatedAt - submittedAt };
    check(state.turns.length === 1 && messages.length === 2 && messages[0].role === 'user' && messages[1].badge === 'Simulated', `Handoff transcript: ${JSON.stringify(messages)}, turns ${state.turns.length}.`);
    check(state.turns[0]?.turn.product === 'igor' && state.turns[0]?.token === secret, 'The turn was not sent as product "igor" with the shared secret.');
    const firstConversation = state.turns[0]?.turn.conversation.id;

    // 2. Follow-up with Enter; Shift+Enter makes a newline; context continues in the same conversation.
    await type('.igor-composer__input', 'First line');
    await enter(8);
    const newline = await tab.evaluate(`document.querySelector('.igor-composer__input').value`);
    check(newline.includes('\n'), 'Shift+Enter did not insert a newline.');
    await type('.igor-composer__input', 'second line of the follow-up');
    await enter();
    await waitFor(`document.querySelectorAll('.igor-message--assistant[data-status="complete"]').length === 2`);
    const follow = state.turns.at(-1)?.turn;
    report.flows.followUp = { conversationId: follow?.conversation.id, history: follow?.conversation.messages.map((message) => message.role) };
    check(state.turns.length === 2 && follow?.conversation.id === firstConversation && follow?.conversation.messages.length === 3, `Follow-up context: ${JSON.stringify(report.flows.followUp)}.`);
    check(await tab.evaluate(`document.activeElement === document.querySelector('.igor-composer__input')`), 'The composer lost focus after sending.');

    // 3. Refresh restores the transcript and submits nothing.
    await tab.go(`${base}${arrived}`);
    await waitFor(`document.querySelectorAll('.igor-message').length === 4`);
    check((await transcript()).length === 4 && state.turns.length === 2, `Refresh changed the conversation or resubmitted (turns ${state.turns.length}).`);

    // 4. Failure keeps the message; Retry reuses the same request id.
    await type('.igor-composer__input', 'please fail once');
    await enter();
    const failed = await waitFor(`document.querySelector('.igor-message--assistant[data-status="failed"] .igor-message__error')?.textContent`);
    check(failed, 'A failed turn did not show an error.');
    const failedRequest = state.turns.at(-1)?.turn.requestId;
    await tab.evaluate(`[...document.querySelectorAll('.igor-message--assistant[data-status="failed"] .igor-icon-button')].find((button) => /retry/i.test(button.getAttribute('aria-label') || button.textContent))?.click()`);
    await waitFor(`document.querySelectorAll('.igor-message--assistant[data-status="complete"]').length === 3`);
    report.flows.retry = { failed, requestIds: state.turns.slice(-2).map((entry) => entry.turn.requestId) };
    check(state.turns.at(-1)?.turn.requestId === failedRequest && (await transcript()).filter((message) => message.role === 'user').length === 3, `Retry: ${JSON.stringify(report.flows.retry)}.`);

    // 5. Markdown is rendered safely.
    await type('.igor-composer__input', 'markdown test');
    await enter();
    await waitFor(`document.querySelectorAll('.igor-message--assistant[data-status="complete"]').length === 4`);
    report.flows.markdown = await tab.evaluate(`(() => { const last = [...document.querySelectorAll('.igor-message--assistant .igor-prose')].at(-1); return { xss: window.__igorXss || null, scripts: last.querySelectorAll('script').length, strong: !!last.querySelector('strong'), code: !!last.querySelector('pre code'), images: last.querySelectorAll('img').length, hrefs: [...last.querySelectorAll('a')].map((a) => [a.getAttribute('href'), a.rel]) }; })()`);
    const md = report.flows.markdown;
    check(!md.xss && md.scripts === 0 && md.images === 0 && md.hrefs.some(([href]) => href === 'https://example.com/pixel.png') && md.strong && md.code && md.hrefs.every(([href, rel]) => !/^javascript:/i.test(href || '') && /noopener/.test(rel)), `Markdown rendering: ${JSON.stringify(md)}.`);

    // 6. New conversation, Back/Forward, rename, delete.
    await tab.evaluate(`document.querySelector('.igor-new').click()`);
    await waitFor(`location.pathname === '/igor/new'`);
    await type('.igor-composer__input', 'A second conversation');
    await enter();
    const second = await waitFor(`/^\\/igor\\/c\\/[a-z0-9]{12}$/.test(location.pathname) && location.pathname !== ${JSON.stringify(arrived)} && location.pathname`);
    await waitFor(`document.querySelector('.igor-message--assistant[data-status="complete"]')`);
    check(state.turns.at(-1)?.turn.conversation.id !== firstConversation && state.turns.at(-1)?.turn.conversation.messages.length === 1, 'The second conversation inherited another conversation\'s history.');
    await tab.evaluate('history.back()');
    const back = await waitFor(`location.pathname === ${JSON.stringify(arrived)} && document.querySelectorAll('.igor-message').length >= 8`);
    await tab.evaluate('history.forward()');
    const forward = await waitFor(`location.pathname === ${JSON.stringify(second)} && document.querySelectorAll('.igor-message').length === 2`);
    check(back && forward, 'Back/Forward did not switch conversations.');
    await tab.evaluate(`[...document.querySelectorAll('.igor-action')].find((button) => /rename/i.test(button.textContent)).click()`);
    await waitFor(`document.querySelector('.igor-rename__input')`);
    await tab.evaluate(`document.querySelector('.igor-rename__input').select()`);
    await tab.send('Input.insertText', { text: 'Renamed conversation' });
    await enter();
    const renamed = await waitFor(`document.querySelector('.igor-thread-title')?.textContent === 'Renamed conversation' && [...document.querySelectorAll('.igor-conversation__title')].some((node) => node.textContent === 'Renamed conversation')`);
    check(renamed, 'Rename did not update the header and sidebar.');
    await tab.evaluate(`window.confirm = () => true; [...document.querySelectorAll('.igor-action')].find((button) => /delete/i.test(button.textContent)).click()`);
    const deleted = await waitFor(`location.pathname !== ${JSON.stringify(second)} && ![...document.querySelectorAll('.igor-conversation__title')].some((node) => node.textContent === 'Renamed conversation')`);
    check(deleted, 'Delete did not remove the conversation.');

    // 7. Keyboard reachability and no credentials in the interface.
    report.flows.assets = await tab.evaluate(`Promise.all([...document.scripts].filter((script) => script.src).map((script) => fetch(script.src).then((response) => response.text()))).then((texts) => texts.some((text) => text.includes(${JSON.stringify(secret)})))`);
    check(report.flows.assets === false, 'The shared secret appears in a browser asset.');
    const order = [];
    await tab.go(`${base}${arrived}`); await waitFor(`document.querySelector('.igor-message')`);
    for (let index = 0; index < 12; index += 1) { await tab.key('Tab', 'Tab', 9); order.push(await tab.evaluate(`(document.activeElement.getAttribute('aria-label') || document.activeElement.textContent || document.activeElement.className).trim().replace(/\\s+/g, ' ').slice(0, 40)`)); }
    report.flows.keyboard = order;
    check(order.some((label) => /new conversation/i.test(label)) && order.some((label) => /rename/i.test(label)), `Keyboard order missed key controls: ${order.join(' → ')}.`);
    await tab.close();

    // 8. Layout at each width, with captures for comparison against R03.
    for (const [width, height] of viewports) {
      const view = await page(devtools);
      await view.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 768 });
      await view.go(`${base}${arrived}`);
      await view.evaluate(`new Promise((resolve) => { const poll = () => document.querySelector('.igor-message') ? resolve(true) : setTimeout(poll, 50); poll(); setTimeout(() => resolve(false), 6000); })`);
      await view.evaluate('document.fonts.ready.then(() => true)');
      const geometry = await view.evaluate(`(() => { const box = (selector) => { const node = document.querySelector(selector); if (!node) return null; const rect = node.getBoundingClientRect(); return { left: rect.left, top: rect.top, width: rect.width, height: rect.height, bottom: rect.bottom, right: rect.right, visible: getComputedStyle(node).visibility !== 'hidden' && getComputedStyle(node).display !== 'none' && rect.width > 0 }; }; return { scrollWidth: document.documentElement.scrollWidth, header: box('.igor-header'), sidebar: box('.igor-sidebar'), composer: box('.igor-composer'), messages: box('.igor-messages'), title: getComputedStyle(document.querySelector('.igor-thread-title')).fontSize, body: getComputedStyle(document.querySelector('.igor-message__content')).fontSize }; })()`);
      const label = `${width}x${height}`;
      check(geometry.scrollWidth <= width, `${label}: horizontal overflow (${geometry.scrollWidth}px).`);
      check(geometry.composer && geometry.composer.bottom <= height + 0.5 && geometry.composer.top > 0, `${label}: the composer is not fully visible.`);
      check(geometry.header && geometry.header.height >= 48 && geometry.header.height <= 80, `${label}: header height ${geometry.header?.height}.`);
      if (width >= 1200) check(geometry.sidebar?.visible && geometry.sidebar.width >= 280 && geometry.sidebar.width <= 304, `${label}: sidebar width ${geometry.sidebar?.width}.`);
      if (width < 768) {
        check(!geometry.sidebar?.visible || geometry.sidebar.right <= 0, `${label}: the sidebar should start closed on phones.`);
        await view.evaluate(`document.querySelector('.igor-sidebar-toggle').click()`);
        const drawer = await view.evaluate(`new Promise((resolve) => setTimeout(() => { const rect = document.querySelector('.igor-sidebar').getBoundingClientRect(); resolve({ open: document.querySelector('.igor-app').dataset.sidebar, left: rect.left, locked: document.body.style.overflow }); }, 400))`);
        check(drawer.open === 'open' && drawer.left >= -1 && drawer.locked === 'hidden', `${label}: drawer ${JSON.stringify(drawer)}.`);
        await view.key('Escape', 'Escape', 27);
        const closed = await view.evaluate(`new Promise((resolve) => setTimeout(() => resolve(document.querySelector('.igor-app').dataset.sidebar), 300))`);
        check(closed === 'closed', `${label}: Escape did not close the drawer.`);
      }
      if (geometry.messages && width >= 1024) check(geometry.messages.width <= 850, `${label}: transcript column ${geometry.messages.width}px (limit 850).`);
      const { data: shot } = await view.send('Page.captureScreenshot', { format: 'png' });
      await writeFile(path.join(outDirectory, `igor-${label}.png`), Buffer.from(shot, 'base64'));
      report.viewports.push({ viewport: label, header: geometry.header?.height, sidebar: geometry.sidebar?.visible ? geometry.sidebar.width : 0, transcript: geometry.messages?.width, titleSize: geometry.title, bodySize: geometry.body });
      await view.close();
    }
  } finally {
    await browser?.close();
    for (const child of children) child.kill();
    stub.close();
    await rm(data, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
  }
  report.turns = state.turns.length;
  report.failures = failures;
  await writeFile(path.join(outDirectory, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  console.log(`\nScreenshots and report.json: ${outDirectory}`);
  if (failures.length) { for (const failure of failures) console.error(`FAIL  ${failure}`); process.exit(1); }
  console.log('Igor verification passed.');
}

await main();
