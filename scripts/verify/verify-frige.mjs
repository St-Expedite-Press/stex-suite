/** Suite acceptance source that exercises editing, proposal review and a real compiler proof. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { repositoryRoot } from '../assets/manifest.mjs';
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
// Frige listens on the base port, Pantheon on the next, the inference stub on the one after: STEX_VERIFY_FRIGE_PORT moves all three.
const frigePort = Number(process.env.STEX_VERIFY_FRIGE_PORT || 4437); const pantheonPort = frigePort + 1; const stubPort = frigePort + 2;
const base = `http://127.0.0.1:${pantheonPort}`; const apiPrefix = base + '/frige/api/stex/publishing/v1';
let documentTurn; const sessionRequests = [];
const stub = http.createServer(async (request, response) => {
  if (request.url.startsWith('/health')) { response.writeHead(200, { 'content-type': 'application/json' }); response.end('{"transport":"fake"}'); return; }
  if (request.url !== '/v1/texgraph/scope-turn') { response.writeHead(404); response.end(); return; }
  let raw = ''; for await (const chunk of request) raw += chunk;
  const turn = JSON.parse(raw); const source = turn.scopeSources[0];
  response.writeHead(200, { 'content-type': 'application/json' });
  if (turn.message === 'Inspect reference fixture.') {
    documentTurn = turn.approvedSourceExcerpts;
    response.end(JSON.stringify({ commentary: 'Reference transport checked.', changes: [], parts: [], meta: { usage: { transport: 'stub' } } }));
    return;
  }
  // A turn that only checks what a continued session is sent: recorded whole, no change proposed.
  if (turn.message === 'Session context check.') {
    sessionRequests.push(turn);
    response.end(JSON.stringify({ commentary: 'Session context received.', changes: [], parts: [], meta: { usage: { transport: 'stub' } } }));
    return;
  }
  // A layout request gets the optional `layout` reply field, through the real gateway path.
  // A selected passage to revise gets one anchored edit inside it, and the gateway confirms forwarding it (D-021).
  if (turn.selection?.action === 'revise') { response.end(JSON.stringify({ commentary: 'Simulated revision of the selected passage.', changes: [{ nodeId: turn.selection.nodeId, edits: [{ find: turn.selection.text, replace: `${turn.selection.text} (revised in its passage)` }], summary: 'Synthetic passage revision' }], parts: [], meta: { model: 'stex/verification-stub', usage: { transport: 'stub' }, forwardedContext: { selection: true } } })); return; }
  // An edit request gets one anchored edit (F5-B) instead of the whole piece; Frige resolves it.
  if (/^simulate edit:/i.test(turn.message)) { response.end(JSON.stringify({ commentary: 'Simulated anchored edit for this synthetic fixture.', changes: [{ nodeId: source.nodeId, edits: [{ find: 'indented and Unicode — kept as written.', replace: 'indented and Unicode — revised, and still kept.' }], summary: 'Synthetic anchored edit' }], parts: [], meta: { model: 'stex/verification-stub', usage: { transport: 'fake' } } })); return; }
  if (/^simulate layout:/i.test(turn.message)) { response.end(JSON.stringify({ commentary: 'Simulated layout proposal for this synthetic fixture.', changes: [], layout: { set: { fontSize: '14pt', leading: '17pt' }, summary: 'Synthetic layout' }, parts: [], meta: { model: 'stex/verification-stub', usage: { transport: 'fake' } } })); return; }
  response.end(JSON.stringify({ commentary: 'Simulated editorial proposal for this synthetic fixture.', changes: [{ nodeId: source.nodeId, source: source.source + '\nA proposed synthetic line.\n', summary: 'Synthetic addition' }], parts: [], meta: { model: 'stex/verification-stub', usage: { transport: 'fake' } } }));
});
await new Promise((resolve) => stub.listen(stubPort, '127.0.0.1', resolve));
/** Reads the current source and metadata for a selected graph node. */
const node = (directory, env) => spawn(process.execPath, ['server.mjs'], { cwd: path.join(repositoryRoot, directory), windowsHide: true, env: { ...process.env, ...env } });
const children = [
  node('apps/frige', { STEX_FRIGE_PORT: String(frigePort), STEX_FRIGE_BASE_PATH: '/frige', STEX_FRIGE_BOOKS_DIR: path.join(root, 'books'), STEX_FRIGE_PROJECT_DIR: path.join(root, 'default'), STEX_PANTHEON_URL: base, STEX_FRIGE_INFERENCE_MODE: 'stub', STEX_INFERENCE_URL: `http://127.0.0.1:${stubPort}`, STEX_INFERENCE_SHARED_SECRET: 'verification-only' }),
  node('apps/pantheon', { STEX_PANTHEON_PORT: String(pantheonPort), STEX_FRIGE_URL: `http://127.0.0.1:${frigePort}` }),
];
const report = { workflow: [], viewports: [], limits: ['Chrome only; synthetic fixtures and local inference stub; no provider or production operations'] };
let browser;
/** The page's evaluate, kept so a failure can record what the page showed. */
let pageEvaluate = null;
/** Waits for the next polling interval. */
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** Polls for an observable condition until its deadline. */
async function until(check, label, timeout = 45000) { const start = Date.now(); while (Date.now() - start < timeout) { if (await check()) return; await delay(100); } throw new Error('Timed out: ' + label); }
/** Sends a request to the owning HTTP API and returns its decoded result. */
async function api(route, payload, method) {
  const response = await fetch(apiPrefix + route, { method: method || (payload ? 'POST' : 'GET'), headers: { 'content-type': 'application/json' }, ...(payload ? { body: JSON.stringify(payload) } : {}) });
  const result = await response.json(); if (!response.ok) throw new Error(result.error); return result;
}
try {
  await Promise.all(children.map((child) => started(child, /ready/, 'Publishing stack')));
  browser = await launchBrowser(); const tab = await page(browser.devtools);
  const evaluate = tab.evaluate; pageEvaluate = evaluate;
  // Dialogs the workflow expects are answered in the page (window.confirm is replaced first). A native
  // dialog would block the page and every later check, so one is dismissed, recorded, and fails the run.
  const unexpectedDialogs = [];
  browser.devtools.listeners.add((message) => {
    if (message.method !== 'Page.javascriptDialogOpening') return;
    unexpectedDialogs.push(`${message.params.type}: ${message.params.message}`);
    tab.send('Page.handleJavaScriptDialog', { accept: false }).catch(() => {});
  });
  /** Sets and dispatches a browser input value in the fixture. */
  const input = (selector, value) => evaluate(`(() => { const node = document.querySelector(${JSON.stringify(selector)}); node.value = ${JSON.stringify(value)}; node.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  /** Activates the matching page control. */
  const click = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  /** Delays the browser's receipt of a real source-save response. */
  const pauseSaveResponse = () => evaluate(`(() => {
    const original = window.fetch;
    window.fetch = async (url, options) => {
      const response = await original(url, options);
      if (options?.method === 'PUT' && String(url).includes('/nodes/')) {
        await new Promise(resolve => { window.__finishSave = resolve; });
      }
      return response;
    };
    window.__restoreFetch = () => { window.fetch = original; };
  })()`);
  // Evidence screenshots are taken at a desktop size, then the window returns to its own size so the steps that follow run as before.
  // `reveal` names an element to scroll into view after the resize, when the layout is final.
  /** Records the evidence requested for the current viewport and step. */
  const capture = async (name, { reveal = null } = {}) => {
    await tab.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    if (reveal) await evaluate(`document.querySelector(${JSON.stringify(reveal)}).scrollIntoView({ block: 'center' })`);
    const shot = await tab.send('Page.captureScreenshot', { format: 'png' }); await writeFile(path.join(out, name), Buffer.from(shot.data, 'base64'));
    await tab.send('Emulation.clearDeviceMetricsOverride');
  };
  /** Waits for the service to report ready before sending requests. */
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
  await until(() => evaluate(`!document.querySelector('#save-source').disabled`), 'save completes');
  const beforeDraft = await api(`/nodes/${selected.id}?book=fixture-book`);
  const mixed = changed.replace('\n', '\r\n').replace('verification,\n', 'verification,\r');
  await api(`/nodes/${selected.id}?book=fixture-book`, { source: mixed, baseHash: beforeDraft.hash }, 'PUT');
  await tab.go(`${base}/frige/?book=fixture-book&scope=${selected.id}`); await ready();
  // Delay only the response from a real write. The second input arrives while the first save is pending.
  await pauseSaveResponse();
  const submitted = changed.replace('verification,', 'checking,');
  await input('#source', submitted); await click('#save-source');
  await until(() => evaluate(`typeof window.__finishSave === 'function'`), 'the fixture has paused the save response');
  const unsaved = submitted + 'A later draft line.';
  await input('#source', unsaved);
  await evaluate('window.__restoreFetch(); window.__finishSave()');
  await until(() => evaluate(`!document.querySelector('#save-source').disabled`), 'delayed save completes');
  assert.equal(await evaluate(`document.querySelector('#source').value`), unsaved);
  assert.match(await evaluate(`document.querySelector('#save-state').textContent`), /Unsaved/);
  const savedMixed = mixed.replace('verification,', 'checking,');
  assert.equal(await readFile(poemPath, 'utf8'), savedMixed);
  await click('#save-source');
  await until(() => evaluate(`!document.querySelector('#save-source').disabled`), 'later draft saves against the new hash');
  assert.equal(await readFile(poemPath, 'utf8'), savedMixed + 'A later draft line.');
  report.workflow.push('manual save keeps mixed line endings and later in-flight input, which saves against the returned revision');
  // Return the disposable fixture to the source expected by the proposal exercises below.
  const afterDraft = await api(`/nodes/${selected.id}?book=fixture-book`);
  await api(`/nodes/${selected.id}?book=fixture-book`, { source: changed, baseHash: afterDraft.hash }, 'PUT');
  await tab.go(`${base}/frige/?book=fixture-book&scope=${selected.id}`); await ready();
  const current = await api(`/nodes/${selected.id}?book=fixture-book`);
  await api(`/nodes/${selected.id}?book=fixture-book`, { source: changed + '\nConcurrent synthetic edit.\n', baseHash: current.hash }, 'PUT');
  await input('#source', changed + '\nStale browser edit.\n'); await click('#save-source');
  await until(() => evaluate(`/changed|stale|reload/i.test(document.querySelector('#save-state').textContent)`), 'visible stale save refusal');
  assert.doesNotMatch(await readFile(poemPath, 'utf8'), /Stale browser/); report.workflow.push('stale save refuses to overwrite concurrent source');
  // The refused edit is still unsaved, so Refresh asks before discarding it; the author chooses to discard.
  await evaluate('window.confirm = () => true');
  await click('#refresh'); await until(() => evaluate(`!document.querySelector('#save-state').textContent.includes('Unsaved')`), 'refresh');
  await click('#show-thread'); await input('#message', 'Prepare a synthetic proposal'); await click('#turn-form [type="submit"]');
  await until(() => evaluate(`!!document.querySelector('.changes .accept')`), 'visible proposal diff');
  assert.doesNotMatch(await readFile(poemPath, 'utf8'), /A proposed synthetic line/);
  await click('.changes .accept');
  await until(async () => (await readFile(poemPath, 'utf8')).includes('A proposed synthetic line'), 'explicit acceptance');
  await until(async () => (await api('/project/build?book=fixture-book'))?.ok, 'real LuaLaTeX proof');
  const pageMap = await api('/project/page-map?book=fixture-book'); assert.equal(pageMap.pagination.verified, true); assert.ok(pageMap.nodes.some((entry) => entry.nodeId === selected.id && entry.firstPage));
  await until(() => evaluate(`document.querySelectorAll('#proof-viewer canvas').length > 0`), 'rendered PDF canvas'); report.workflow.push('proposal inert until acceptance; real compiler-mapped PDF renders');
  // Change contract: the accepted change is recorded with the proof that typeset it, rolls back
  // to the exact prior text, and a rejected proposal changes nothing.
  const beforeAccept = changed + '\nConcurrent synthetic edit.\n'; const historyUrl = `/project/contracts?book=fixture-book&scope=${selected.id}`;
  await until(async () => (await api(historyUrl))[0]?.proof?.paginationVerified === true, 'proof recorded on the contract');
  const [contract] = await api(historyUrl);
  assert.equal(contract.contract, 'stex.frige.change-contract.v1'); assert.equal(contract.changes[0].status, 'accepted'); assert.equal(contract.request, 'Prepare a synthetic proposal');
  await until(() => evaluate(`!!document.querySelector('.decision-revert:not([disabled])')`), 'roll back control beside the accepted change');
  assert.match(await evaluate(`document.querySelector('.decision-proof')?.textContent || ''`), /Typeset in a proof/);
  await until(() => evaluate(`/[1-9]\\d* pass/.test(document.querySelector('#preflight-state').textContent)`), 'preflight of the new proof'); await capture('contract-accepted.png');
  await click('.decision-revert');
  await until(async () => (await readFile(poemPath, 'utf8')) === beforeAccept, 'rollback restores the prior text exactly');
  assert.equal((await api(`/nodes/${selected.id}?book=fixture-book`)).hash, contract.changes[0].baseHash);
  await until(() => evaluate(`document.querySelectorAll('.decision.reverted').length === 1 && !document.querySelector('.decision-revert')`), 'rollback shown in the thread');
  await until(async () => { const build = await api('/project/build?book=fixture-book'); return build?.ok && build.sourceHashes?.[selected.id] === contract.changes[0].baseHash; }, 'proof typeset again from the restored text');
  await until(() => evaluate(`!document.querySelector('#turn-form [type="submit"]').disabled && !document.querySelector('#build').disabled`), 'workspace idle after rollback');
  report.workflow.push('accepted change records its proof and rolls back to the exact prior text; proof typeset again');
  await input('#message', 'Prepare another synthetic proposal'); await click('#turn-form [type="submit"]');
  await until(() => evaluate(`!!document.querySelector('.changes .reject')`), 'second proposal');
  assert.match(await evaluate(`document.querySelector('.change-terms')?.textContent || ''`), /Igor was shown 1 manuscript piece/);
  await evaluate(`document.querySelector('.change-terms').open = true`); await capture('contract-proposal.png');
  await click('.changes .reject');
  await until(async () => (await api(historyUrl))[0]?.changes[0].status === 'rejected', 'rejection recorded on the contract');
  assert.equal(await readFile(poemPath, 'utf8'), beforeAccept); report.workflow.push('contract terms shown; rejection leaves the manuscript unchanged');
  // Anchored edit (F5-B): the director quotes the text it replaces; Frige places it, the card heads the
  // passage with its lines, acceptance writes only that span, and rollback restores the exact bytes.
  await until(() => evaluate(`!document.querySelector('#turn-form [type="submit"]').disabled`), 'workspace idle after rejection');
  await input('#message', 'Simulate edit: revise the indented line'); await click('#turn-form [type="submit"]');
  await until(() => evaluate(`!!document.querySelector('.changes .diff-hunk')`), 'anchored edit shown as a headed passage');
  const card = await evaluate(`({ hunks: [...document.querySelectorAll('.changes .diff-hunk')].map(node => node.textContent), scope: document.querySelector('.changes .change-scope')?.textContent || '', removed: [...document.querySelectorAll('.changes .diff-del')].map(node => node.textContent), added: [...document.querySelectorAll('.changes .diff-add')].map(node => node.textContent) })`);
  assert.deepEqual(card, { hunks: ['Lines 2–6'], scope: '1 passage would change; the text of every other line stays as it is.', removed: ['−   indented and Unicode — kept as written.'], added: ['+   indented and Unicode — revised, and still kept.'] });
  assert.equal(await readFile(poemPath, 'utf8'), beforeAccept, 'the edit is inert until accepted');
  await capture('anchored-edit-proposal.png', { reveal: '.changes .change-diff' });
  await click('.changes .accept');
  const edited = beforeAccept.replace('indented and Unicode — kept as written.', 'indented and Unicode — revised, and still kept.');
  await until(async () => (await readFile(poemPath, 'utf8')) === edited, 'anchored edit accepted byte-exact');
  await until(() => evaluate(`!!document.querySelector('.decision-revert:not([disabled])')`), 'roll back control for the anchored edit');
  await click('.decision-revert');
  await until(async () => (await readFile(poemPath, 'utf8')) === beforeAccept, 'anchored edit rolled back to the exact prior text');
  await until(() => evaluate(`!document.querySelector('#turn-form [type="submit"]').disabled && !document.querySelector('#build').disabled`), 'workspace idle after the anchored edit');
  report.workflow.push('an anchored edit through the gateway reply is shown as its headed passage, accepted byte-exact and rolled back');

  // Interface increment 1: the open scope is in the address, survives a reload, and follows Back and Forward.
  /** Reads the selected publishing scope from the browser URL. */
  const scopeParam = () => evaluate(`new URLSearchParams(location.search).get('scope')`);
  assert.equal(await scopeParam(), selected.id, 'opening a piece records it in the address');
  await tab.go(`${base}/frige/?book=fixture-book&scope=${selected.id}`); await ready();
  assert.match(await evaluate(`document.querySelector('#conversation-title').textContent`), /Morning/, 'a deep link opens its piece');
  assert.equal(await evaluate(`document.querySelector('#source-panel').classList.contains('hidden')`), false, 'a piece opens on its source');
  await click('.tree-book'); await until(async () => (await scopeParam()) === null, 'whole book in the address');
  await evaluate('history.back()'); await until(() => evaluate(`document.querySelector('#conversation-title').textContent.includes('Morning')`), 'Back returns to the piece');
  await evaluate('history.forward()'); await until(() => evaluate(`document.querySelector('.tree-book').getAttribute('aria-current') === 'true'`), 'Forward returns to the whole book');
  await evaluate('history.back()'); await until(async () => (await scopeParam()) === selected.id, 'back on the piece');
  await until(() => evaluate(`document.querySelector('#conversation-title').textContent.includes('Morning')`), 'piece reopened');
  report.workflow.push('the open scope is in the address: a deep link survives reload, and Back and Forward move between scopes');
  // Review finding H1: Back with unsaved edits asks first; refusing keeps the edit, the scope and the
  // address, and steps back without adding a history entry (N3).
  await click('#show-source');
  await evaluate(`(() => { const area = document.querySelector('#source'); area.value += '\\nAn unsaved line.'; area.dispatchEvent(new Event('input', { bubbles: true })); window.__asked = 0; window.confirm = () => { window.__asked += 1; return false; }; })()`);
  const entries = await evaluate('history.length');
  await evaluate('history.back()');
  await until(() => evaluate('window.__asked === 1'), 'Back asks before discarding unsaved edits');
  await until(async () => (await scopeParam()) === selected.id, 'the address returns to the piece');
  assert.equal(await evaluate(`document.querySelector('#source').value.endsWith('An unsaved line.')`), true, 'the unsaved edit survives');
  assert.match(await evaluate(`document.querySelector('#conversation-title').textContent`), /Morning/);
  assert.equal(await evaluate('history.length'), entries, 'no history entry is added');
  await evaluate('window.confirm = () => true'); await click('#refresh');
  await until(() => evaluate(`!document.querySelector('#source').value.endsWith('An unsaved line.')`), 'edit discarded on an accepted refresh');
  report.workflow.push('Back with unsaved edits asks first; refusing keeps the edit, scope and address and adds no entry');
  // Review finding M1: Back then Forward during a slow load ends where the address says.
  await click('.tree-book'); await until(async () => (await scopeParam()) === null, 'whole book open');
  await evaluate(`(() => { const original = window.fetch; window.__restoreFetch = () => { window.fetch = original; }; window.fetch = (url, options) => (String(url).includes('/api/nodes/${selected.id}') ? new Promise((resolve) => setTimeout(resolve, 1500)).then(() => original(url, options)) : original(url, options)); })()`);
  await evaluate('history.back()'); await delay(200); await evaluate('history.forward()');
  await delay(2500);
  assert.equal(await scopeParam(), null, 'the address ends on the whole book');
  assert.equal(await evaluate(`document.querySelector('.tree-book').getAttribute('aria-current')`), 'true', 'the screen ends on the whole book too');
  await evaluate('window.__restoreFetch()');
  await evaluate(`document.querySelector('.tree-piece').click()`);
  await until(async () => (await scopeParam()) === selected.id && (await evaluate(`document.querySelector('#conversation-title').textContent.includes('Morning')`)), 'piece reopened after the race');
  report.workflow.push('Back then Forward during a slow load: the last navigation wins, and the address and screen agree');
  // The navigator filters by title or file and moves by arrow keys.
  await input('#tree-filter', 'morn');
  assert.deepEqual(await evaluate(`({ pieces: [...document.querySelectorAll('#book-tree .tree-piece')].map(node => node.querySelector('.tree-title').textContent), count: document.querySelector('#tree-count').textContent })`), { pieces: ['Morning'], count: '1 of 1 piece' });
  await input('#tree-filter', 'nothing-like-this');
  assert.match(await evaluate(`document.querySelector('.tree-empty')?.textContent || ''`), /No piece matches/);
  await evaluate(`document.querySelector('#tree-filter').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  assert.equal(await evaluate(`document.querySelector('#tree-filter').value`), '');
  // At desktop width the tree is always shown; below 1024 px it is a closed drawer, whose rows cannot take focus.
  await tab.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await evaluate(`document.querySelector('.tree-book').focus()`);
  const treeRows = await evaluate(`[...document.querySelectorAll('#book-tree [data-tree-id]')].map(node => node.dataset.treeId)`);
  /** Identifies the currently focused node in the publishing tree. */
  const focusedRow = () => evaluate(`document.activeElement.dataset.treeId || document.activeElement.id || document.activeElement.tagName`);
  await tab.key('ArrowDown', 'ArrowDown', 40);
  assert.equal(await focusedRow(), treeRows[1], 'ArrowDown moves to the next row');
  await tab.key('End', 'End', 35); assert.equal(await focusedRow(), treeRows.at(-1), 'End moves to the last row');
  await tab.key('Home', 'Home', 36); assert.equal(await focusedRow(), 'book', 'Home moves to the first row');
  await tab.send('Emulation.clearDeviceMetricsOverride');
  report.workflow.push('navigator filter by title, empty state and Escape; arrow-key movement between rows');

  // A real selection in the editor, revised through the passage bar: the chip shows exactly what is sent,
  // the proposal stays inside the passage, acceptance is byte-exact, and rollback restores the bytes.
  const phrase = 'indented and Unicode — kept as written.';
  /** Selects the matching phrase for the passage workflow. */
  const selectPhrase = () => evaluate(`(() => { const area = document.querySelector('#source'); const at = area.value.indexOf(${JSON.stringify(phrase)}); area.focus(); area.setSelectionRange(at, at + ${phrase.length}); area.dispatchEvent(new Event('select')); })()`);
  await click('#show-source'); await selectPhrase();
  await until(() => evaluate(`!document.querySelector('#passage-bar').hidden`), 'passage bar for the selection');
  assert.equal(await evaluate(`document.querySelector('#passage-label').textContent`), 'line 4 of “Morning”');
  assert.equal(await evaluate(`document.querySelector('#source-position').textContent`), `line 4 selected · ${phrase.length} characters`);
  await capture('passage-selected.png', { reveal: '#passage-bar' });
  await click('#passage-bar [data-action="revise"]');
  const chip = await evaluate(`({ shown: !document.querySelector('#passage-chip').hidden, summary: document.querySelector('#passage-chip summary').textContent, text: document.querySelector('#passage-chip .passage-text').textContent, message: document.querySelector('#message').value, focused: document.activeElement.id })`);
  assert.deepEqual(chip, { shown: true, summary: 'Revise · line 4 of “Morning”', text: phrase, message: 'Revise the selected passage.', focused: 'message' });
  await evaluate(`document.querySelector('#passage-chip details').open = true`); await capture('passage-attached.png', { reveal: '#passage-chip' });
  await click('#turn-form [type="submit"]');
  await until(() => evaluate(`!!document.querySelector('.changes .accept') && !!document.querySelector('.passage-quote')`), 'passage proposal and the quoted passage in the thread');
  assert.equal(await evaluate(`document.querySelector('.passage-quote figcaption').textContent`), 'Revise · line 4 of “Morning”');
  assert.equal(await evaluate(`document.querySelectorAll('#passage-chip:not([hidden])').length`), 0, 'the chip is spent once sent');
  assert.equal(await readFile(poemPath, 'utf8'), beforeAccept, 'the passage proposal is inert');
  await capture('passage-proposal.png', { reveal: '.changes' });
  await click('.changes .accept');
  const passageEdited = beforeAccept.replace(phrase, `${phrase} (revised in its passage)`);
  await until(async () => (await readFile(poemPath, 'utf8')) === passageEdited, 'passage revision accepted byte-exact');
  await until(() => evaluate(`!!document.querySelector('.decision-revert:not([disabled])')`), 'roll back control for the passage revision');
  await click('.decision-revert');
  await until(async () => (await readFile(poemPath, 'utf8')) === beforeAccept, 'passage revision rolled back');
  await until(() => evaluate(`!document.querySelector('#turn-form [type="submit"]').disabled && !document.querySelector('#build').disabled`), 'workspace idle after the passage rollback');
  report.workflow.push('select a passage, Revise from the passage bar, inspect the attached text, receive a proposal inside it, accept byte-exact, roll back');

  // A selection made before someone else saved the piece is refused, visibly, and nothing is recorded.
  await click('#show-source'); await selectPhrase(); await until(() => evaluate(`!document.querySelector('#passage-bar').hidden`), 'passage bar again');
  await click('#passage-bar [data-action="explain"]');
  const turnsBefore = (await api(`/scopes/${selected.id}/turns?book=fixture-book`)).length;
  const concurrent = `${beforeAccept}\nA line saved elsewhere.\n`;
  await api(`/nodes/${selected.id}?book=fixture-book`, { source: concurrent, baseHash: (await api(`/nodes/${selected.id}?book=fixture-book`)).hash }, 'PUT');
  await click('#turn-form [type="submit"]');
  await until(() => evaluate(`/changed after the passage was selected/.test(document.querySelector('#turns').textContent)`), 'stale passage refused visibly');
  assert.equal((await api(`/scopes/${selected.id}/turns?book=fixture-book`)).length, turnsBefore, 'a refused passage records no turn');
  assert.equal(await readFile(poemPath, 'utf8'), concurrent);
  assert.equal(await evaluate(`document.querySelector('#passage-chip').hidden`), true, 'the refused passage is not offered again');
  await api(`/nodes/${selected.id}?book=fixture-book`, { source: beforeAccept, baseHash: (await api(`/nodes/${selected.id}?book=fixture-book`)).hash }, 'PUT');
  await click('#refresh'); await until(() => evaluate(`!document.querySelector('#turn-form [type="submit"]').disabled`), 'refreshed after the stale passage');
  report.workflow.push('a passage selected before a concurrent save is refused with a visible reason and records nothing');
  await click('#open-design'); await input('[name="fontSize"]', '13pt'); await click('#design-panel [type="submit"]');
  await until(() => evaluate(`document.querySelector('#design-state').textContent === 'Saved.'`), 'profile save');
  const preflight = await api('/project/preflight?book=fixture-book'); assert.equal(preflight.checks.find((entry) => entry.id === 'freshness').status, 'warn');
  await click('#design-cancel'); report.workflow.push('profile change marks the proof stale in diagnostic preflight');
  // Layout override (Wave 3a): the selected piece gets its own size; a real proof records it; clearing it restores the book size.
  await click('#open-design');
  assert.equal(await evaluate(`document.querySelector('#scope-override').hidden`), false, 'a piece shows its own settings');
  assert.match(await evaluate(`document.querySelector('#override-legend').textContent`), /This piece · Morning/);
  await input('[name="override.fontSize"]', '15pt'); await input('[name="override.leading"]', '18pt');
  await capture('design-override.png', { reveal: '#scope-override' });
  await click('#design-panel [type="submit"]');
  await until(async () => (await api('/project/design?book=fixture-book')).design.nodes?.[selected.id]?.fontSize === '15pt', 'piece override saved');
  await click('#build');
  await until(async () => (await api('/project/page-map?book=fixture-book'))?.nodes?.find((entry) => entry.nodeId === selected.id)?.layout?.sizeFrom === 'element', 'proof typeset with the piece override');
  await until(() => evaluate(`!document.querySelector('#build').disabled`), 'build finished');
  await input('[name="override.fontSize"]', ''); await input('[name="override.leading"]', ''); await click('#design-panel [type="submit"]');
  await until(async () => !(await api('/project/design?book=fixture-book')).design.nodes, 'piece override cleared');
  await click('#design-cancel'); report.workflow.push('a piece override is saved, typeset into a real proof and recorded in its page map, then cleared');
  // Layout change contract (Wave 3b): proposed in the piece's conversation, accepted, typeset, rolled back.
  await click('#show-thread'); await input('#message', 'Simulate layout: 14pt/17pt'); await click('#turn-form [type="submit"]');
  await until(() => evaluate(`!!document.querySelector('.change-layout')`), 'layout change card');
  assert.match(await evaluate(`document.querySelector('.change-layout').textContent`), /as its section \(13pt \/ 13\.6pt\) → 14pt \/ 17pt/);
  await capture('layout-proposal.png', { reveal: '.change-layout' });
  assert.equal((await api('/project/design?book=fixture-book')).design.nodes, undefined, 'the proposal changes nothing');
  await click('.changes .accept');
  await until(async () => (await api('/project/design?book=fixture-book')).design.nodes?.[selected.id]?.fontSize === '14pt', 'layout change accepted into the profile');
  await until(async () => (await api(historyUrl))[0]?.proof?.paginationVerified === true, 'proof under the new profile recorded on the layout contract');
  await until(() => evaluate(`!!document.querySelector('.decision-revert:not([disabled])')`), 'roll back control for the layout change');
  await click('.decision-revert');
  await until(async () => !(await api('/project/design?book=fixture-book')).design.nodes, 'layout change rolled back');
  await until(() => evaluate(`!document.querySelector('#turn-form [type="submit"]').disabled && !document.querySelector('#build').disabled`), 'workspace idle after layout rollback');
  report.workflow.push('a layout change is proposed in conversation, accepted into the profile, proved by a real proof, and rolled back');
  // Settings → "Company & models" opens the shared Company screen (Wave 4a) filtered to Frige.
  // The link is checked in place, not followed: this stack runs no Igor server.
  await evaluate(`document.querySelector('#settings-menu summary').focus()`); await tab.key('Enter', 'Enter', 13, '\r');
  assert.equal(await evaluate(`document.querySelector('#settings-menu').open`), true, 'Settings opens from the keyboard');
  await tab.key('Tab', 'Tab', 9);
  const company = await evaluate(`(() => { const link = document.activeElement; const box = link.getBoundingClientRect(); return { id: link.id, href: link.getAttribute('href'), label: link.textContent.trim(), height: box.height, visible: box.width > 0, outline: getComputedStyle(link).outlineStyle, retired: !!document.querySelector('#configure-models, .model-settings') }; })()`);
  assert.deepEqual({ id: company.id, href: company.href, label: company.label, visible: company.visible, outline: company.outline, retired: company.retired }, { id: 'company-settings', href: '/igor/team?app=frige', label: 'Company & models', visible: true, outline: 'solid', retired: false });
  assert.ok(company.height >= 40, JSON.stringify(company));
  await click('#source'); assert.equal(await evaluate(`document.querySelector('#settings-menu').open`), false, 'a click elsewhere closes Settings');
  report.workflow.push('Settings opens by keyboard to a focusable "Company & models" link to /igor/team?app=frige, and closes on an outside click');
  // Editorial conversations (D-027) through the real interface, at desktop and phone width: a second
  // conversation, a simulated turn, completion with a summary (the proposal stays pending), continue.
  /** Opens a menu action in the conversation bar by its label. */
  const sessionAction = (label) => evaluate(`[...document.querySelectorAll('#session-action-items button')].find(button => button.textContent === ${JSON.stringify(label)}).click()`);
  /** Waits for the bar to show this lifecycle for the open conversation. */
  const lifecycleIs = (text) => until(() => evaluate(`document.querySelector('#session-lifecycle').textContent.startsWith(${JSON.stringify(text)})`), 'lifecycle ' + text);
  const sessionRun = async (width, height, mobile, label) => {
    await tab.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    // A fresh page opens the scope on its first conversation.
    await tab.go(`${base}/frige/?book=fixture-book&scope=${selected.id}`); await ready();
    if (width < 640) await click('[data-view="editor"]');
    await click('#show-thread');
    const title = `${label} review`; const history = `/scopes/${selected.id}/conversations?book=fixture-book`;
    assert.equal(await evaluate(`document.querySelector('#session-bar').hidden`), false, 'the conversation bar is shown');
    assert.equal(await evaluate(`document.querySelector('#session-current').textContent`), 'Main conversation');
    assert.equal(await evaluate(`document.documentElement.scrollWidth <= innerWidth + 1`), true, 'no horizontal scroll with the bar');
    // The switcher opens from the keyboard and Escape returns focus to it.
    await evaluate(`document.querySelector('#session-current').focus()`); await tab.key('Enter', 'Enter', 13, '\r');
    assert.equal(await evaluate(`document.querySelector('#session-switcher').open`), true, 'the switcher opens from the keyboard');
    await tab.key('Escape', 'Escape', 27);
    assert.equal(await evaluate(`document.querySelector('#session-switcher').open`), false); assert.equal(await evaluate(`document.activeElement.id`), 'session-current');
    // An unsaved source edit survives creating and switching conversations (only the thread changes).
    await click('#show-source'); await evaluate(`(() => { const area = document.querySelector('#source'); area.value += '\\nUnsaved while switching.'; area.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await click('#show-thread');
    // New conversation: the dialog names it; focus returns to the switcher.
    await click('#session-current'); await click('#session-new');
    await until(() => evaluate(`document.querySelector('#session-name').open`), 'the naming dialog'); await input('#session-name-input', title);
    await evaluate(`document.querySelector('#session-name-form').requestSubmit()`);
    await until(() => evaluate(`document.querySelector('#session-current').textContent === ${JSON.stringify(title)} && !document.querySelector('#session-name').open`), 'the new conversation is open');
    assert.equal(await evaluate(`document.activeElement.id`), 'session-current', 'focus returns after the dialog');
    await lifecycleIs('Active'); assert.equal(await evaluate(`document.querySelectorAll('#turns .msg').length`), 0, 'a new conversation has an empty thread');
    assert.equal(await evaluate(`document.querySelector('#source').value.endsWith('Unsaved while switching.')`), true, 'the unsaved source survives');
    assert.match(await evaluate(`document.querySelector('#conversation-title').textContent`), /Morning/, 'the scope is unchanged');
    assert.match(await evaluate(`document.querySelector('#composer-scope').textContent`), new RegExp(title));
    // A simulated turn: the proposal is made in this conversation and waits for the author.
    await input('#message', 'Simulate edit: revise the indented line'); await click('#turn-form [type="submit"]');
    await until(() => evaluate(`!!document.querySelector('.changes .accept')`), 'proposal in the new conversation');
    const [created] = (await api(history)).conversations.filter((entry) => entry.title === title);
    const [proposal] = await api(`/project/contracts?book=fixture-book&scope=${selected.id}`);
    assert.equal(proposal.conversationId, created.id); assert.equal(proposal.changes[0].status, 'pending');
    // The first conversation does not show this conversation's proposal; it points to it.
    await click('#session-current'); await evaluate(`[...document.querySelectorAll('.session-choice')].find(node => node.querySelector('.session-choice-title').textContent === 'Main conversation').click()`);
    await until(() => evaluate(`document.querySelector('#session-current').textContent === 'Main conversation' && !document.querySelector('.changes .accept')`), 'the first conversation without the cards');
    assert.match(await evaluate(`document.querySelector('#session-note').textContent`), new RegExp(`waiting for your decision in “${title}”`));
    assert.equal(await evaluate(`document.querySelector('#source').value.endsWith('Unsaved while switching.')`), true, 'the unsaved source still survives');
    await click('#session-note button'); await until(() => evaluate(`document.querySelector('#session-current').textContent === ${JSON.stringify(title)} && !!document.querySelector('.changes .accept')`), 'back with the cards');
    // Complete with a summary: the sheet is prefilled from Frige's records, and says closing decides nothing.
    await click('#session-actions summary'); await sessionAction('Complete…');
    await until(() => evaluate(`document.querySelector('#session-summary').open && document.querySelector('#summary-text').value !== ''`), 'the summary sheet with its draft');
    assert.match(await evaluate(`document.querySelector('#session-summary-source').textContent`), /Draft prepared from Frige’s records, not by a model/);
    assert.match(await evaluate(`document.querySelector('#session-summary-closing').textContent`), /does not accept, reject or apply any proposal/);
    assert.match(await evaluate(`document.querySelector('#summary-proposals').value`), /^Pending change to “Morning”/);
    assert.equal(await evaluate(`document.documentElement.scrollWidth <= innerWidth + 1`), true, 'the sheet fits the viewport');
    await input('#summary-text', (await evaluate(`document.querySelector('#summary-text').value`)) + ' Reviewed by the author.');
    await input('#summary-reason', 'Opening settled.'); await evaluate(`document.querySelector('#session-summary-form').requestSubmit()`);
    await until(() => evaluate(`!document.querySelector('#session-summary').open`), 'the sheet closes after saving'); await lifecycleIs('Completed');
    assert.equal(await evaluate(`document.activeElement.parentElement.id`), 'session-actions', 'focus returns to the actions menu');
    const closedState = (await api(`/scopes/${selected.id}/conversations/${created.id}?book=fixture-book`));
    assert.deepEqual([closedState.lifecycle, closedState.summaryRevision, closedState.transitions.at(-1).to, closedState.transitions.at(-1).reason], ['completed', 1, 'completed', 'Opening settled.']);
    assert.equal((await api(`/scopes/${selected.id}/changes?book=fixture-book`)).changes[0].status, 'pending', 'closing decided nothing');
    assert.equal(await evaluate(`document.querySelector('#message').disabled`), true, 'a closed conversation takes no message');
    assert.match(await evaluate(`document.querySelector('#session-note').textContent`), /closing did not decide it/);
    await capture(`session-completed-${width}.png`);
    // Continue from the summary: a new conversation that is offered the summary, never the transcript.
    await click('#session-actions summary'); await sessionAction('Continue from summary…');
    await until(() => evaluate(`document.querySelector('#session-name').open`), 'the continue dialog'); await evaluate(`document.querySelector('#session-name-form').requestSubmit()`);
    await until(() => evaluate(`document.querySelector('#session-current').textContent === ${JSON.stringify(`Continued: ${title}`)}`), 'the continued conversation is open');
    await lifecycleIs('Active'); assert.equal(await evaluate(`document.querySelector('#message').disabled`), false);
    const requestsBefore = sessionRequests.length; await input('#message', 'Session context check.'); await click('#turn-form [type="submit"]');
    await until(() => sessionRequests.length > requestsBefore && evaluate(`document.querySelectorAll('#turns .msg').length >= 2`), 'the continued turn is answered');
    const sent = sessionRequests.at(-1);
    assert.deepEqual(sent.sessionSummaries.map((entry) => [entry.conversationId, entry.title, entry.lifecycle, entry.summaryRevision]), [[created.id, title, 'completed', 1]]);
    assert.match(sent.sessionSummaries[0].text, /Reviewed by the author\./); assert.deepEqual(sent.turns, [], 'the earlier transcript is not offered');
    // Archive the completed one: it leaves the list unless archived ones are shown.
    await click('#session-current'); await evaluate(`[...document.querySelectorAll('.session-choice')].find(node => node.querySelector('.session-choice-title').textContent === ${JSON.stringify(title)}).click()`);
    await until(() => evaluate(`document.querySelector('#session-current').textContent === ${JSON.stringify(title)}`), 'the completed conversation is open'); await lifecycleIs('Completed');
    await click('#session-actions summary'); await sessionAction('Archive'); await lifecycleIs('Completed · archived');
    await click('#session-current'); await evaluate(`[...document.querySelectorAll('.session-choice')].find(node => node.querySelector('.session-choice-title').textContent.startsWith('Continued:')).click()`);
    await until(() => evaluate(`document.querySelector('#session-current').textContent.startsWith('Continued:')`), 'the continued conversation again');
    await click('#session-current');
    assert.equal(await evaluate(`[...document.querySelectorAll('.session-choice')].some(node => node.querySelector('.session-choice-title').textContent === ${JSON.stringify(title)})`), false, 'an archived conversation is hidden');
    await click('#session-show-archived');
    assert.equal(await evaluate(`[...document.querySelectorAll('.session-choice')].some(node => node.querySelector('.session-choice-title').textContent === ${JSON.stringify(title)})`), true, 'and shown on request');
    await click('#session-show-archived'); await click('#session-current');
    // Leave the fixture as it was: the proposal is rejected through the engine and the unsaved edit discarded.
    await api(`/scopes/${selected.id}/changes/decide?book=fixture-book`, { changeSetId: proposal.id, decision: 'reject' });
    await evaluate('window.confirm = () => true'); await click('#refresh');
    await until(() => evaluate(`!document.querySelector('#source').value.endsWith('Unsaved while switching.')`), 'the unsaved edit is discarded');
    assert.equal(await readFile(poemPath, 'utf8'), beforeAccept, 'the manuscript was never changed by conversations');
  };
  await sessionRun(1440, 900, false, 'Desktop');
  report.workflow.push('conversations at 1440 px: a second conversation keeps scope and unsaved source, a simulated turn proposes, completing with a prefilled summary leaves the proposal pending, continue offers only the summary, archive hides');
  await sessionRun(390, 844, true, 'Phone');
  await tab.send('Emulation.clearDeviceMetricsOverride');
  report.workflow.push('the same conversation workflow at 390 px: switcher, sheets and notices fit without horizontal scroll');
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
  await tab.go(`${base}/frige/?book=fixture-book&scope=${selected.id}`); await ready();
  await until(() => evaluate(`document.querySelector('#production-status').textContent.includes('Currency')`), 'proof has a currency status');
  const latest = await api(`/nodes/${selected.id}?book=fixture-book`);
  const revised = latest.source + '\nSource changed after the proof.';
  await evaluate(`(() => {
    const original = window.fetch;
    window.fetch = (url, options) => String(url).includes('/project/graph')
      ? Promise.resolve(new Response('{}', { status: 500 }))
      : original(url, options);
  })()`);
  await input('#source', revised); await click('#save-source');
  await until(() => evaluate(`document.querySelector('#save-state').textContent.includes('Markdown saved. Contents could not be refreshed.')`), 'save succeeds while graph refresh fails');
  assert.equal(await readFile(poemPath, 'utf8'), revised);
  assert.match(await evaluate(`document.querySelector('#production-status').textContent`), /refresh contents to check the proof/);
  report.workflow.push('a saved edit with a failed contents refresh leaves proof currency unverified');
  const revisionsUrl = `/nodes/${selected.id}/revisions`;
  const history = await api(`${revisionsUrl}?book=fixture-book`);
  const savedAfterFailure = history.entries[0];
  const earlier = await api(`${revisionsUrl}/${savedAfterFailure.parentId}?book=fixture-book`);
  assert.equal(earlier.source, latest.source);
  await tab.go(`${base}/frige/?book=fixture-book&scope=${selected.id}`); await ready();
  await click('#show-history');
  await until(() => evaluate(`!!document.querySelector('[data-revision-id="${earlier.id}"]')`), 'history ready');
  await input('#history-reason', 'Keep the synthetic reading for the proof.');
  await click('#history-decision button');
  await until(() => evaluate(`document.querySelector('#history-decisions').textContent.includes('Keep the synthetic reading')`), 'decision recorded in the dialog');
  await click(`[data-revision-id="${earlier.id}"]`);
  await until(() => evaluate(`document.querySelector('#history-diff .diff-del')?.textContent.includes('Source changed after the proof')`), 'comparison shows the later line');
  await click('#history-restore');
  await until(() => evaluate(`!document.querySelector('#source-history').open`), 'author applied the restore');
  const restored = (await api(`${revisionsUrl}?book=fixture-book`)).entries[0];
  assert.equal(restored.restoredFrom, earlier.id);
  assert.notEqual(restored.id, earlier.id);
  assert.equal(await readFile(poemPath, 'utf8'), latest.source);
  const restoredProof = await api('/project/build?book=fixture-book', { scopeId: 'book', mode: 'prefix' }, 'POST');
  assert.equal(restoredProof.pageMap.pagination.verified, true);
  assert.equal(restoredProof.pageMap.sourceHashes[selected.id], restored.hash);
  report.workflow.push('Frige History records a decision, compares a revision and restores exact source that matches a compiler-verified proof');
  const referenceBefore = 'Café synthetic reference\n  Preserve this exact indentation.';
  const [reference, unapproved, stale] = await api('/project/attachments?book=fixture-book', { attachments: [
    { name: 'reference.md', contentBase64: Buffer.from(referenceBefore).toString('base64') },
    { name: 'unapproved.md', contentBase64: Buffer.from('Never approved.').toString('base64') },
    { name: 'stale.md', contentBase64: Buffer.from('A reviewed reference.').toString('base64') },
  ] }, 'POST');
  const stalePreview = await api(`/project/attachments/${stale.id}/excerpt?book=fixture-book`);
  await api(`/project/attachments/${stale.id}/approve?book=fixture-book`, { hash: stalePreview.hash }, 'POST');
  await writeFile(path.join(bookRoot, '.texgraph', stale.extraction), 'The changed extraction awaits approval.');
  await tab.go(`${base}/frige/?book=fixture-book&scope=${selected.id}`); await ready();
  await click('#show-thread');
  await evaluate(`[...document.querySelectorAll('#attachments .attachment')].find(item => item.textContent.startsWith('reference.md')).querySelector('button').click()`);
  await until(() => evaluate(`!document.querySelector('#approve-excerpt').disabled`), 'document excerpt ready');
  assert.equal(await evaluate(`document.querySelector('#attachment-excerpt').textContent`), referenceBefore);
  await click('#approve-excerpt');
  await until(() => evaluate(`!document.querySelector('#attachment-review').open`), 'exemplar approved');
  await input('#message', 'Inspect reference fixture.'); await click('#turn-form [type="submit"]');
  await until(() => Boolean(documentTurn), 'the stub has the document turn');
  assert.deepEqual(documentTurn.map(({ id, excerpt }) => ({ id, excerpt })), [{ id: reference.id, excerpt: referenceBefore }]);
  assert.notEqual(reference.id, unapproved.id);
  report.workflow.push('Frige sends an exact preview-approved excerpt to the gateway and withholds unapproved and changed extracts');
  await tab.go(`${base}/frige/?book=fixture-book&scope=${selected.id}`); await ready();
  await until(() => evaluate(`document.querySelector('#production-status').textContent.includes('matches saved source')`), 'the proof matches the restored fixture');
  await pauseSaveResponse();
  await input('#source', revised); await click('#save-source');
  await until(() => evaluate(`typeof window.__finishSave === 'function'`), 'save response paused before navigation');
  await evaluate('window.confirm = () => true');
  await click('.tree-book'); await until(async () => (await scopeParam()) === null, 'navigated to the book during the save');
  await evaluate('window.__restoreFetch(); window.__finishSave()');
  await until(() => evaluate(`document.querySelector('#production-status').textContent.includes('1 node changed since proof')`), 'the book reflects the saved piece');
  assert.match(await evaluate(`document.querySelector('#source').value`), /^# Programme/);
  assert.equal(await readFile(poemPath, 'utf8'), revised);
  report.workflow.push('a delayed save refreshes proof currency after navigation and leaves the new scope buffer intact');
  assert.equal((await fetch(`http://127.0.0.1:${frigePort}/frige/?book=fixture-book`, { redirect: 'manual' })).headers.get('location'), base + '/frige/?book=fixture-book');
  assert.deepEqual(unexpectedDialogs, [], 'no native dialog opened that the workflow did not expect');
  report.result = 'PASS'; report.browser = browser.browserPath; console.log('PASS: platform publishing workflow, real proof, five viewports');
} catch (error) {
  report.result = 'FAIL'; report.error = error.stack; console.error(error); process.exitCode = 1;
  // What the page showed when the check failed: the workstation writes a startup failure into the page.
  try { report.pageText = await pageEvaluate?.(`(document.querySelector('main') || document.body).innerText.slice(0, 800)`); console.error(`Page: ${report.pageText}`); } catch { /* the page may be gone */ }
}
finally {
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  if (browser) await browser.close();
  await Promise.all(children.map(async (child) => { if (child.exitCode !== null) return; const done = new Promise((resolve) => child.once('exit', resolve)); child.kill(); await done; }));
  await new Promise((resolve) => stub.close(resolve));
  if (report.result === 'PASS') await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  else console.log('Synthetic fixture retained: ' + root);
  console.log('Report: ' + path.join(out, 'report.json'));
}
