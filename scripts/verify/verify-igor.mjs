/** Suite acceptance source that exercises conversation, context consent and retry with stub inference. */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import http from 'node:http';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { repositoryRoot } from '../assets/manifest.mjs';
import { launchBrowser, outDirectoryFromArgs, page, started } from './browser/devtools.mjs';

// Browser acceptance for Igor (milestone I1). Runs an isolated stack on spare
// ports with disposable data: Pantheon, the Igor server (built interface), and
// a counting stub in place of stex-igor/services/inference, so "exactly once" and
// session continuity are measured rather than assumed. The stub answers like
// the fake transport (labelled simulated); it is not evidence of live Hermes.
//   corepack pnpm build:igor && corepack pnpm verify:igor [--out <directory>]

const ports = { pantheon: 4435, igor: 4436, inference: 4437, frige: 4440 };
const outDirectory = outDirectoryFromArgs('stex-igor-verification');
const secret = 'verify-igor-shared-secret';
const replyDelayMs = 1500;
const viewports = [[1440, 900], [1280, 800], [1024, 768], [768, 1024], [390, 844]];

// Stub inference: records every turn, answers after a delay, fails on demand.
/** Serves deterministic turn replies and counts requests for retry assertions. */
function inferenceStub(state) {
  return http.createServer(async (request, response) => {
    /** Sends a JSON response from the stub inference server. */
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

/** Verifies the composed conversation, context and retry workflow using stub inference. */
async function main() {
  const dist = path.join(repositoryRoot, 'stex-igor', 'apps', 'igor', 'dist', 'index.html');
  if (!existsSync(dist)) throw new Error('Igor is not built: run corepack pnpm build:igor first.');
  await mkdir(outDirectory, { recursive: true });
  const data = await mkdtemp(path.join(os.tmpdir(), 'stex-verify-igor-'));
  const manuscript = path.join(data, 'books', 'context-book', 'manuscript');
  await mkdir(manuscript, { recursive: true });
  const contextText = '# Selected source\n\n  Exact project context — Unicode.\n';
  await writeFile(path.join(manuscript, 'Programme.md'), '# Programme\n\n- [Selected](Selected.md)\n');
  await writeFile(path.join(manuscript, 'Selected.md'), contextText);
  const state = { turns: [], failedOnce: new Set() };
  const stub = inferenceStub(state);
  await new Promise((resolve) => stub.listen(ports.inference, '127.0.0.1', resolve));
  /** Reads the current source and metadata for a selected graph node. */
  const node = (directory, env) => spawn(process.execPath, ['server.mjs'], { cwd: path.join(repositoryRoot, directory), env: { ...process.env, ...env } });
  const children = [
    node('stex-igor/apps/igor', { STEX_IGOR_PORT: String(ports.igor), STEX_IGOR_DATA_DIR: path.join(data, 'igor'), STEX_INFERENCE_URL: `http://127.0.0.1:${ports.inference}`, STEX_INFERENCE_SHARED_SECRET: secret, STEX_FRIGE_URL: `http://127.0.0.1:${ports.frige}` }),
    node('apps/frige', { STEX_FRIGE_PORT: String(ports.frige), STEX_FRIGE_BASE_PATH: '/frige', STEX_FRIGE_BOOKS_DIR: path.join(data, 'books'), STEX_FRIGE_PROJECT_DIR: path.join(data, 'default'), STEX_PANTHEON_URL: `http://127.0.0.1:${ports.pantheon}` }),
    node('apps/pantheon', { STEX_PANTHEON_PORT: String(ports.pantheon), STEX_IGOR_URL: `http://127.0.0.1:${ports.igor}`, STEX_FRIGE_URL: `http://127.0.0.1:${ports.frige}`, STEX_SEAXNEAT_URL: 'http://127.0.0.1:4499', STEX_KNOWLEDGE_DATA_DIR: path.join(data, 'knowledge') }),
  ];
  const failures = []; const report = { flows: {}, viewports: [] };
  /** Records a named acceptance assertion and fails the run if it fails. */
  const check = (condition, message) => { if (!condition) failures.push(message); return condition; };
  let browser;
  try {
    await Promise.all(children.map((child) => started(child, /ready/i, 'Igor stack')));
    browser = await launchBrowser();
    const { devtools } = browser; report.browser = browser.browserPath;
    const base = `http://127.0.0.1:${ports.pantheon}`;
    const tab = await page(devtools);
    await tab.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    // Polls from Node, so a cross-document navigation (the handoff) only loses one probe.
    /** Waits for the expected conversation condition in the browser. */
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
    /** Enters a message into the browser composer. */
    const type = async (selector, text) => { await tab.evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`); await tab.send('Input.insertText', { text }); };
    /** Sends the current composer message by keyboard. */
    const enter = (modifiers = 0) => tab.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, modifiers, text: '\r' }).then(() => tab.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, modifiers }));
    /** Reads the conversation stream as visible text. */
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
    await waitFor(`[...document.querySelectorAll('.igor-message--assistant .igor-prose')].at(-1)?.querySelector('pre code')`);
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
    // Delete asks through the in-page ConfirmDialog (not window.confirm); Cancel keeps it, Delete removes it.
    // A scripted click does not focus the button as a real one does, so focus it first.
    await tab.evaluate(`(() => { const button = [...document.querySelectorAll('.igor-action')].find((node) => /delete/i.test(node.textContent)); button.focus(); button.click(); })()`);
    check(await waitFor(`document.querySelector('dialog.igor-confirm[open]')`), 'Delete did not open the confirmation dialog.');
    check(await waitFor(`document.activeElement?.textContent === 'Cancel'`, 2000), 'The confirmation dialog did not focus the safe choice first.');
    await tab.evaluate(`[...document.querySelectorAll('dialog.igor-confirm[open] button')].find((button) => button.textContent === 'Cancel').click()`);
    check(await waitFor(`!document.querySelector('dialog.igor-confirm[open]') && location.pathname === ${JSON.stringify(second)} && /delete/i.test(document.activeElement?.textContent || '')`, 2000), 'Cancel did not keep the conversation and return focus to Delete.');
    await tab.evaluate(`[...document.querySelectorAll('.igor-action')].find((button) => /delete/i.test(button.textContent)).click()`);
    await waitFor(`document.querySelector('dialog.igor-confirm[open]')`);
    await tab.evaluate(`[...document.querySelectorAll('dialog.igor-confirm[open] button')].find((button) => button.textContent === 'Delete').click()`);
    const deleted = await waitFor(`location.pathname !== ${JSON.stringify(second)} && ![...document.querySelectorAll('.igor-conversation__title')].some((node) => node.textContent === 'Renamed conversation')`);
    check(deleted, 'Delete did not remove the conversation.');


    // 6b. Working sessions (D-027): make, complete with a summary, continue, search and filter, at 1440 and 390.
    {
      const click = (selector, text) => tab.evaluate(`[...document.querySelectorAll(${JSON.stringify(selector)})].find((node) => ${text instanceof RegExp ? text.toString() + '.test(node.textContent)' : `node.textContent.trim() === ${JSON.stringify(text)}`})?.click()`);
      const sheetOpen = `document.querySelector('dialog.igor-summary[open]')`;
      await tab.go(`${base}/igor/new`);
      await waitFor(`document.querySelector('.igor-composer__input')`);
      await type('.igor-composer__input', 'EARLIER-TRANSCRIPT-MARKER plan the launch');
      await enter();
      const sessionRoute = await waitFor(`/^\\/igor\\/c\\/[a-z0-9]{12}$/.test(location.pathname) && location.pathname`);
      await waitFor(`document.querySelector('.igor-message--assistant[data-status="complete"]')`);
      check(await waitFor(`!document.querySelector('.igor-session__state') && [...document.querySelectorAll('.igor-session .igor-action')].some((node) => node.textContent === 'Make this a working session')`), 'A chat showed lifecycle controls or lacked "Make this a working session".');
      await click('.igor-session .igor-action', 'Make this a working session');
      check(await waitFor(`document.querySelector('dialog.igor-confirm[open] textarea')`), 'Make a working session did not ask for an objective.');
      check(await waitFor(`[...document.querySelectorAll('dialog.igor-confirm[open] button')].find((b) => b.textContent === 'Make working session')?.disabled === true`, 1000), 'An empty objective could be confirmed.');
      await type('dialog.igor-confirm[open] textarea', 'Plan the launch of the spring list');
      await click('dialog.igor-confirm[open] button', 'Make working session');
      check(await waitFor(`document.querySelector('.igor-session__state')?.textContent === 'Active' && document.querySelector('.igor-session__objective')?.textContent.includes('Plan the launch of the spring list')`), 'The chat did not become a working session with its objective.');
      check(await waitFor(`[...document.querySelectorAll('.igor-conversation')].some((node) => node.getAttribute('aria-current') && node.querySelector('.igor-conversation__badge')?.textContent === 'Session · Active')`), 'The sidebar did not mark the session.');
      // Pause, then sending resumes.
      await click('.igor-session__actions .igor-action', 'Pause');
      check(await waitFor(`document.querySelector('.igor-session__state')?.textContent === 'Paused'`), 'Pause did not show Paused.');
      await type('.igor-composer__input', 'back to work');
      await enter();
      check(await waitFor(`document.querySelector('.igor-session__state')?.textContent === 'Active' && document.querySelectorAll('.igor-message--assistant[data-status="complete"]').length === 2`), 'Sending did not resume the paused session.');
      // Complete with a summary: the sheet is prefilled with a draft, labelled, editable.
      await click('.igor-session__actions .igor-action', 'Complete');
      check(await waitFor(sheetOpen), 'Complete did not open the summary sheet.');
      check(await waitFor(`document.querySelector('.igor-summary textarea')?.value.includes('Objective: Plan the launch') && /Draft from Igor/.test(document.querySelector('.igor-summary__provenance')?.textContent || '')`), 'The sheet was not prefilled with the labelled draft.');
      check(await waitFor(`document.activeElement === document.querySelector('.igor-summary textarea')`, 2000), 'The summary sheet did not focus its text.');
      await tab.evaluate(`document.querySelector('.igor-summary textarea').select()`);
      await tab.send('Input.insertText', { text: 'We planned the launch and agreed the order of work.' });
      await tab.evaluate(`document.querySelectorAll('.igor-summary textarea')[1].focus()`);
      await tab.send('Input.insertText', { text: 'Ship on Friday' });
      check(await waitFor(`/Edited by you/.test(document.querySelector('.igor-summary__provenance')?.textContent || '')`), 'Editing the draft did not mark it as the user\'s own text.');
      report.flows.sessionSheet1440 = await tab.evaluate(`(() => { const r = document.querySelector('.igor-summary').getBoundingClientRect(); return { width: r.width, height: r.height, scrollWidth: document.documentElement.scrollWidth }; })()`);
      { const { data: shot } = await tab.send('Page.captureScreenshot', { format: 'png' }); await writeFile(path.join(outDirectory, 'igor-session-sheet-1440.png'), Buffer.from(shot, 'base64')); }
      await click('.igor-summary button', 'Save and complete');
      check(await waitFor(`!document.querySelector('dialog.igor-summary[open]') && document.querySelector('.igor-session__state')?.textContent === 'Completed'`), 'Save and complete did not complete the session.');
      check(await waitFor(`!document.querySelector('.igor-composer') && /takes no new messages/.test(document.querySelector('.igor-session__note')?.textContent || '')`), 'A completed session still offered the composer or did not say why.');
      check(await waitFor(`/Summary \\(r1\\)/.test(document.querySelector('.igor-session__actions')?.textContent || '') && [...document.querySelectorAll('.igor-session__actions .igor-action')].some((b) => b.textContent === 'Continue from summary')`), 'The saved summary and Continue were not offered.');
      // Layout at 390 with the sheet open.
      await tab.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
      await tab.evaluate(`new Promise((resolve) => setTimeout(resolve, 300))`);
      await click('.igor-session__actions .igor-action', /Summary/);
      check(await waitFor(sheetOpen), 'The summary sheet did not reopen at 390 px.');
      report.flows.sessionSheet390 = await tab.evaluate(`(() => { const r = document.querySelector('.igor-summary').getBoundingClientRect(); return { left: r.left, right: r.right, width: r.width, scrollWidth: document.documentElement.scrollWidth }; })()`);
      check(report.flows.sessionSheet390.left >= 0 && report.flows.sessionSheet390.right <= 390 && report.flows.sessionSheet390.scrollWidth <= 390, `The summary sheet overflows at 390 px: ${JSON.stringify(report.flows.sessionSheet390)}.`);
      { const { data: shot } = await tab.send('Page.captureScreenshot', { format: 'png' }); await writeFile(path.join(outDirectory, 'igor-session-sheet-390.png'), Buffer.from(shot, 'base64')); }
      await tab.key('Escape', 'Escape', 27);
      check(await waitFor(`!document.querySelector('dialog.igor-summary[open]') && /Summary/.test(document.activeElement?.textContent || '')`, 2000), 'Escape did not close the sheet and restore focus to its button.');
      report.flows.sessionBar390 = await tab.evaluate(`(() => { const buttons = [...document.querySelectorAll('.igor-session__actions .igor-action')].map((b) => { const r = b.getBoundingClientRect(); return { text: b.textContent, left: r.left, right: r.right, height: r.height }; }); return { buttons, scrollWidth: document.documentElement.scrollWidth }; })()`);
      check(report.flows.sessionBar390.scrollWidth <= 390 && report.flows.sessionBar390.buttons.every((b) => b.left >= 0 && b.right <= 390 && b.height >= 40), `The session bar is not usable at 390 px: ${JSON.stringify(report.flows.sessionBar390)}.`);
      { const { data: shot } = await tab.send('Page.captureScreenshot', { format: 'png' }); await writeFile(path.join(outDirectory, 'igor-session-bar-390.png'), Buffer.from(shot, 'base64')); }
      await tab.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
      // Continue: a new session, same objective, the summary offered to the model, never the transcript.
      const turnsBefore = state.turns.length;
      await click('.igor-session__actions .igor-action', 'Continue from summary');
      const continuedRoute = await waitFor(`/^\\/igor\\/c\\/[a-z0-9]{12}$/.test(location.pathname) && location.pathname !== ${JSON.stringify(sessionRoute)} && location.pathname`);
      check(continuedRoute, 'Continue did not open a new session.');
      check(await waitFor(`document.querySelector('.igor-session__state')?.textContent === 'Active' && document.querySelectorAll('.igor-message').length === 0 && /Continued from/.test(document.querySelector('.igor-session__note')?.textContent || '')`), 'The continued session was not fresh and labelled.');
      await type('.igor-composer__input', 'Where did we land?');
      await enter();
      await waitFor(`document.querySelector('.igor-message--assistant[data-status="complete"]')`);
      const continued = state.turns.at(-1)?.turn;
      const summaryBlock = continued?.context?.priorSessionSummary;
      check(state.turns.length === turnsBefore + 1 && summaryBlock?.kind === 'prior-session-summary' && summaryBlock.text.includes('agreed the order of work') && summaryBlock.decisions?.[0] === 'Ship on Friday', `The continued turn lacked the saved summary: ${JSON.stringify(continued?.context).slice(0, 200)}.`);
      check(!JSON.stringify(continued).includes('EARLIER-TRANSCRIPT-MARKER') && continued.conversation.messages.length === 1 && continued.conversation.id !== firstConversation, 'The continued turn carried the earlier transcript.');
      report.flows.sessionContinue = { route: continuedRoute, summaryRevision: summaryBlock?.summaryRevision, messagesSent: continued?.conversation.messages.length };
      // Search and filter.
      await tab.evaluate(`document.querySelector('#igor-search').focus()`);
      await tab.send('Input.insertText', { text: 'zzz-no-such-title' });
      check(await waitFor(`!document.querySelector('.igor-conversations') && document.querySelector('.igor-empty-note')?.textContent === 'Nothing matches.'`), 'Search did not narrow the list.');
      await tab.evaluate(`document.querySelector('#igor-search').select()`);
      await tab.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
      await tab.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
      await click('.igor-filter > summary', /Show:/);
      await click('.igor-filter__options .igor-action', 'Sessions');
      check(await waitFor(`document.querySelectorAll('.igor-conversation').length >= 2 && [...document.querySelectorAll('.igor-conversation')].every((node) => node.querySelector('.igor-conversation__badge'))`), 'The Sessions filter showed non-sessions or no sessions.');
      check(await waitFor(`/Show: Sessions/.test(document.querySelector('.igor-filter > summary')?.textContent || '') && document.activeElement?.tagName === 'SUMMARY'`, 2000), 'Choosing a filter did not return focus to its summary.');
      await click('.igor-filter > summary', /Show:/);
      await click('.igor-filter__options .igor-action', 'All');
      await waitFor(`/Show: All/.test(document.querySelector('.igor-filter > summary')?.textContent || '')`);
      // The closed original refuses messages server-side too (409 SESSION_CLOSED).
      const closedId = sessionRoute.split('/').pop();
      const refused = await tab.evaluate(`fetch('/igor/api/conversations/${closedId}/messages', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idempotencyKey: 'verify-closed-0001', content: 'still there?' }) }).then(async (r) => ({ status: r.status, code: (await r.json()).code }))`);
      check(refused.status === 409 && refused.code === 'SESSION_CLOSED', `A closed session accepted a message: ${JSON.stringify(refused)}.`);
      report.flows.sessionClosedRefusal = refused;
    }

    // 7. Keyboard reachability and no credentials in the interface.
    report.flows.assets = await tab.evaluate(`Promise.all([...document.scripts].filter((script) => script.src).map((script) => fetch(script.src).then((response) => response.text()))).then((texts) => texts.some((text) => text.includes(${JSON.stringify(secret)})))`);
    check(report.flows.assets === false, 'The shared secret appears in a browser asset.');
    const order = [];
    await tab.go(`${base}${arrived}`); await waitFor(`document.querySelector('.igor-message')`);
    for (let index = 0; index < 20; index += 1) { await tab.key('Tab', 'Tab', 9); order.push(await tab.evaluate(`(document.activeElement.getAttribute('aria-label') || document.activeElement.textContent || document.activeElement.className).trim().replace(/\\s+/g, ' ').slice(0, 40)`)); }
    report.flows.keyboard = order;
    check(order.some((label) => /new conversation/i.test(label)) && order.some((label) => /rename/i.test(label)), `Keyboard order missed key controls: ${order.join(' → ')}.`);
    // Follow Frige's actual handoff. Its link and catalog load must not send inference.
    const beforeContext = state.turns.length;
    await tab.go(`${base}/frige/?book=context-book`);
    const discuss = '.publishing-toolbar a[href^="/igor/new?project="]';
    check(await waitFor(`document.querySelector(${JSON.stringify(discuss)})?.textContent === 'Discuss with Igor'`), 'Frige did not render the Discuss with Igor link.');
    await tab.evaluate(`document.querySelector(${JSON.stringify(discuss)}).click(); true`);
    check(await waitFor(`document.querySelectorAll('.igor-context input[type="checkbox"]').length >= 2`), 'Context catalog did not load.');
    check(await waitFor(`location.pathname === '/igor/new' && document.querySelector('[aria-label="Context project"]')?.value === 'stex://frige/project/context-book' && document.querySelector('.igor-context')?.open`), 'Frige did not open Igor with the selected book.');
    await type('.igor-composer__input', 'Discuss only the approved source');
    check(await tab.evaluate(`document.querySelector('.igor-send').disabled`), 'Context handoff allowed sending before source approval.');
    await enter();
    check(state.turns.length === beforeContext, 'Reading source metadata started inference.');
    await tab.evaluate(`[...document.querySelectorAll('.igor-context li')].find(node => node.textContent.includes('Selected source')).querySelector('input').click()`);
    await tab.evaluate(`[...document.querySelectorAll('.igor-context button')].find(node => node.textContent === 'Preview selected context').click()`);
    check(await waitFor(`document.querySelector('[aria-label="Exact context preview"] pre')?.textContent === ${JSON.stringify(contextText)}`), 'Exact source preview differs from canonical text.');
    check(state.turns.length === beforeContext, 'Preview sent inference before approval.');
    await tab.evaluate(`[...document.querySelectorAll('.igor-context button')].find(node => node.textContent === 'Use this context').click()`);
    check(await waitFor(`!document.querySelector('.igor-send').disabled`), 'Approving the context did not enable sending.');
    await tab.evaluate(`document.querySelector('.igor-composer__input').focus()`); await enter();
    check(await waitFor(`document.querySelector('.igor-message--assistant[data-status="complete"]')`), 'Context turn did not complete.');
    const offered = state.turns.at(-1).turn;
    check(offered.context?.projectContext?.sources?.length === 1 && offered.context.projectContext.sources[0].source === contextText, 'Inference did not receive exactly the approved source.');
    await tab.evaluate(`document.querySelector('.igor-context').open = true; [...document.querySelectorAll('.igor-context button')].find(node => node.textContent === 'Withdraw context').click()`);
    await waitFor(`document.querySelector('.igor-context summary')?.textContent.includes('0 sources offered') && !document.querySelector('.igor-composer__input').disabled`);
    await type('.igor-composer__input', 'New question after withdrawal'); await enter();
    await waitFor(`document.querySelectorAll('.igor-message--assistant[data-status="complete"]').length === 2`);
    const withdrawn = state.turns.at(-1).turn;
    check(JSON.stringify(withdrawn.context) === '{}' && withdrawn.conversation.id !== offered.conversation.id && withdrawn.conversation.messages.length === 1, 'Withdrawal reused old source context, history or runtime session.');
    report.flows.projectContext = { approvedSources: offered.context?.projectContext?.sources?.length, withdrawnSources: Object.keys(withdrawn.context || {}).length, freshSession: withdrawn.conversation.id !== offered.conversation.id };
    /** Reads the composed knowledge handoff from the page. */
    const knowledge = async (route = '', body) => { const response = await fetch(base + '/api/knowledge/v1' + route, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }); const value = await response.json(); if (!response.ok) throw Error(value.error); return value; };
    let projection = await knowledge();
    const approvedSource = offered.context.projectContext.sources[0];
    projection = await knowledge('/accept', { expectedVersion: projection.version, idempotencyKey: 'igor-knowledge-source', project: 'stex://frige/project/context-book', sources: [{ id: approvedSource.id, revision: approvedSource.revision }] });
    await knowledge('/relation', { expectedVersion: projection.version, idempotencyKey: 'igor-knowledge-assertion', relation: { id: 'synthetic-assertion', kind: 'assertion', subject: 'stex://frige/project/context-book', predicate: 'explores', object: 'Synthetic continuity', evidence: [{ reference: approvedSource.reference, revision: approvedSource.revision }] } });
    const beforeKnowledge = state.turns.length;
    await tab.go(base + '/graph/');
    check(await waitFor(`[...document.querySelectorAll('button')].some(node => node.textContent === 'Send approved knowledge to Igor')`), 'Accepted knowledge could not be offered to Igor.');
    check(state.turns.length === beforeKnowledge, 'Rendering knowledge started inference.');
    const knowledgeText = await tab.evaluate(`document.querySelector('#knowledge-content details pre').textContent`);
    await tab.evaluate(`document.querySelector('#knowledge-content details').open = true; [...document.querySelectorAll('button')].find(node => node.textContent === 'Send approved knowledge to Igor').click()`);
    check(await waitFor(`document.querySelector('.igor-message--assistant[data-status="complete"]')`), 'Knowledge handoff did not complete.');
    const knowledgeTurn = state.turns.at(-1).turn;
    check(knowledgeTurn.conversation.messages.length === 1 && knowledgeTurn.conversation.messages[0].content === knowledgeText && knowledgeTurn.conversation.id !== withdrawn.conversation.id, 'Knowledge handoff differs from the visible preview or reused a conversation.');
    report.flows.knowledgeHandoff = { explicit: true, exactPreview: knowledgeTurn.conversation.messages[0].content === knowledgeText, freshConversation: knowledgeTurn.conversation.id !== withdrawn.conversation.id };
    await tab.close();

    // 8. Masthead motion: plays when welcome, never under reduced motion, and always has a pause control.
    for (const reduce of [false, true]) {
      const view = await page(devtools);
      await view.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
      await view.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: reduce ? 'reduce' : 'no-preference' }] });
      await view.go(`http://127.0.0.1:${ports.igor}${arrived}`);
      await view.evaluate('new Promise((resolve) => setTimeout(resolve, 2500))');
      const state = await view.evaluate(`(() => { const video = document.querySelector('.igor-masthead__motion'); return { paused: video.paused, time: video.currentTime, motion: document.querySelector('.igor-header').dataset.motion, toggle: document.querySelector('.igor-motion-toggle')?.getAttribute('aria-label') }; })()`);
      (report.flows.motion ??= {})[reduce ? 'reduced' : 'default'] = state;
      if (reduce) check(state.paused && state.motion === 'still' && state.toggle === 'Play motion', `Reduced motion still played the masthead: ${JSON.stringify(state)}.`);
      else check(!state.paused && state.time > 0 && state.motion === 'playing' && state.toggle === 'Pause motion', `The masthead did not play: ${JSON.stringify(state)}.`);
      if (!reduce) {
        await view.evaluate(`document.querySelector('.igor-motion-toggle').click()`);
        const paused = await view.evaluate(`new Promise((resolve) => setTimeout(() => resolve({ paused: document.querySelector('.igor-masthead__motion').paused, toggle: document.querySelector('.igor-motion-toggle').getAttribute('aria-label') }), 300))`);
        check(paused.paused && paused.toggle === 'Play motion', `Pause motion did not pause: ${JSON.stringify(paused)}.`);
        await view.evaluate(`document.querySelector('.igor-motion-toggle').click()`); // leave motion on for the captures below
      }
      await view.close();
    }

    // 9. Layout at each width, with captures for comparison against R03.
    for (const [width, height] of viewports) {
      const view = await page(devtools);
      await view.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 768 });
      await view.go(`${base}${arrived}`);
      await view.evaluate(`new Promise((resolve) => { const poll = () => document.querySelector('.igor-message') ? resolve(true) : setTimeout(poll, 50); poll(); setTimeout(() => resolve(false), 6000); })`);
      await view.evaluate('document.fonts.ready.then(() => true)');
      const geometry = await view.evaluate(`(() => { const box = (selector) => { const node = document.querySelector(selector); if (!node) return null; const rect = node.getBoundingClientRect(); return { left: rect.left, top: rect.top, width: rect.width, height: rect.height, bottom: rect.bottom, right: rect.right, visible: getComputedStyle(node).visibility !== 'hidden' && getComputedStyle(node).display !== 'none' && rect.width > 0 }; }; return { scrollWidth: document.documentElement.scrollWidth, header: box('.igor-composed-header'), sidebar: box('.igor-sidebar'), composer: box('.igor-composer'), messages: box('.igor-messages'), title: getComputedStyle(document.querySelector('.igor-thread-title')).fontSize, body: getComputedStyle(document.querySelector('.igor-message__content')).fontSize }; })()`);
      const label = `${width}x${height}`;
      check(geometry.scrollWidth <= width, `${label}: horizontal overflow (${geometry.scrollWidth}px).`);
      check(geometry.composer && geometry.composer.bottom <= height + 0.5 && geometry.composer.top > 0, `${label}: the composer is not fully visible.`);
      check(geometry.header && geometry.header.height >= 44 && geometry.header.height <= 64, `${label}: composed toolbar height ${geometry.header?.height}.`);
      check(await view.evaluate(`!document.querySelector('.igor-masthead') && document.querySelectorAll('.site-header').length <= 1`), `${label}: duplicate masthead.`);
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
