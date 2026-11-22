/** Frige regression tests source that checks inference client behavior with disposable fixtures. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { inferenceHealth, layoutFrom, requestPageRevision, requestScopeTurn } from '../src/inference-client.mjs';

test('Frige alpha deterministic transport returns a labelled no-change response without a gateway', async () => {
  const previous = process.env.STEX_FRIGE_INFERENCE_MODE;
  process.env.STEX_FRIGE_INFERENCE_MODE = 'fake';
  try {
    const result = await requestScopeTurn({ book: { id: 'fixture', title: 'Fixture' }, scope: { id: 'book', kind: 'book', title: 'Fixture', nodeIds: [] }, sources: [], graph: {}, turns: [], message: 'Check this proof.' });
    assert.equal(result.availability, 'available'); assert.equal(result.changes.length, 0); assert.equal(result.meta.model, 'stex/hermes-fake'); assert.match(result.commentary, /Deterministic Igor simulator/);
    assert.deepEqual(await inferenceHealth(), { state: 'simulated', model: 'stex/hermes-fake', provider: 'fake' });
    const page = await requestPageRevision({ book: {}, page: {}, turns: [], message: 'Revise this page.' });
    assert.equal(page.availability, 'available'); assert.equal(page.proposal, null);
  } finally {
    if (previous === undefined) delete process.env.STEX_FRIGE_INFERENCE_MODE; else process.env.STEX_FRIGE_INFERENCE_MODE = previous;
  }
});

test('the deterministic simulator proposes one labelled change only when asked, and never to the table of contents', async () => {
  const previous = process.env.STEX_FRIGE_INFERENCE_MODE;
  process.env.STEX_FRIGE_INFERENCE_MODE = 'fake';
  /** Encodes a synthetic inference turn for the tested contract. */
  const turn = (message, sources) => requestScopeTurn({ book: { id: 'fixture', title: 'Fixture' }, scope: { id: 'node-fixture', kind: 'node', title: 'Piece', nodeIds: [] }, sources, graph: {}, turns: [], message });
  const programme = { nodeId: 'node-programme', title: 'Programme', kind: 'programme', relativePath: 'Programme.md', hash: 'h0', source: '# Programme\n' };
  const piece = { nodeId: 'node-piece', title: 'Piece', kind: 'poem', relativePath: '01/Piece.md', hash: 'h1', source: '# Piece\n\nA line.' };
  try {
    const proposed = await turn('Simulate change:   A closing\n line.  ', [programme, piece]);
    assert.equal(proposed.meta.model, 'stex/hermes-fake'); assert.equal(proposed.meta.usage.transport, 'fake');
    assert.match(proposed.commentary, /Deterministic Igor simulator/); assert.match(proposed.commentary, /Nothing changes until you accept/);
    // The request is folded to one line and appended as a new stanza; existing text is untouched.
    assert.deepEqual(proposed.changes.map(({ nodeId, source }) => ({ nodeId, source })), [{ nodeId: 'node-piece', source: '# Piece\n\nA line.\n\nA closing line.\n' }]);
    assert.match(proposed.changes[0].summary, /not a model/);
    const windows = await turn('simulate change: Kept endings.', [{ ...piece, source: '# Piece\r\n\r\nA line.\r\n' }]);
    assert.equal(windows.changes[0].source, '# Piece\r\n\r\nA line.\r\n\r\nKept endings.\r\n', 'the piece keeps its own line endings');
    const contentsOnly = await turn('Simulate change: A line.', [programme]);
    assert.equal(contentsOnly.changes.length, 0); assert.match(contentsOnly.commentary, /no change was simulated/);
    assert.equal((await turn('Please simulate change: no.', [piece])).changes.length, 0, 'the request must lead the message');
    assert.equal((await turn('Simulate change:   ', [piece])).changes.length, 0, 'an empty request proposes nothing');
    // Leading Markdown markers are dropped, so the line cannot become a heading and retitle the piece.
    assert.equal((await turn('Simulate change: ## > Not a heading', [piece])).changes[0].source, '# Piece\n\nA line.\n\nNot a heading\n');
    assert.equal((await turn('Simulate change: Alone.', [{ ...piece, source: '' }])).changes[0].source, 'Alone.\n', 'an empty piece gets the line alone');
    // 300 characters outside the Basic Multilingual Plane: clipped to 240 whole characters, none cut in half.
    const clipped = (await turn(`Simulate change: ${'𝄞'.repeat(300)}`, [piece])).changes[0].source;
    assert.equal(clipped, `# Piece\n\nA line.\n\n${'𝄞'.repeat(240)}\n`);
    // Layout requests shape a proposal; the engine validates every value.
    /** Extracts the layout values asserted by the test. */
    const layoutOf = async (message) => (await turn(message, [piece])).layout;
    assert.deepEqual((await layoutOf('Simulate layout: 15pt / 18pt')).set, { fontSize: '15pt', leading: '18pt' });
    assert.deepEqual((await layoutOf('simulate layout: Recto OFF')).set, { opensRecto: false });
    assert.deepEqual((await layoutOf('Simulate layout: recto inherit')).set, { opensRecto: null });
    assert.deepEqual((await layoutOf('Simulate layout: size inherit')).set, { fontSize: null, leading: null });
    assert.deepEqual((await layoutOf('Simulate layout: head The Northern Poems')).set, { headText: 'The Northern Poems' });
    assert.equal((await layoutOf('Simulate layout: clear')).clear, true);
    assert.match((await layoutOf('Simulate layout: clear')).summary, /not a model/);
    const unknown = await turn('Simulate layout: make it nicer', [piece]);
    assert.equal(unknown.layout, undefined); assert.match(unknown.commentary, /did not recognise/); assert.equal(unknown.changes.length, 0);
    const page = await requestPageRevision({ book: {}, page: {}, turns: [], message: 'Simulate change: A line.' });
    assert.equal(page.proposal, null); assert.doesNotMatch(page.commentary, /table of contents/, 'the one-page book is not told about scopes it does not have');
  } finally {
    if (previous === undefined) delete process.env.STEX_FRIGE_INFERENCE_MODE; else process.env.STEX_FRIGE_INFERENCE_MODE = previous;
  }
});

test('the deterministic simulator passes one anchored edit, quoted exactly, to the first offered piece', async (context) => {
  const previous = process.env.STEX_FRIGE_INFERENCE_MODE;
  process.env.STEX_FRIGE_INFERENCE_MODE = 'fake';
  context.after(() => { if (previous === undefined) delete process.env.STEX_FRIGE_INFERENCE_MODE; else process.env.STEX_FRIGE_INFERENCE_MODE = previous; });
  /** Encodes a synthetic inference turn for the tested contract. */
  const turn = (message, sources) => requestScopeTurn({ book: { id: 'fixture', title: 'Fixture' }, scope: { id: 'node-fixture', kind: 'node', title: 'Piece', nodeIds: [] }, sources, graph: {}, turns: [], message });
  const programme = { nodeId: 'node-programme', title: 'Programme', kind: 'programme', relativePath: 'Programme.md', hash: 'h0', source: '# Programme\n' };
  const piece = { nodeId: 'node-piece', title: 'Piece', kind: 'poem', relativePath: '01/Piece.md', hash: 'h1', source: '# Piece\n\nA line.' };
  const edited = await turn('Simulate edit: A line. => A  revised line.', [programme, piece]);
  // The simulator does not resolve the edit or claim a suggestion: Frige decides whether it can be placed.
  assert.deepEqual(edited.changes.map(({ nodeId, edits }) => ({ nodeId, edits })), [{ nodeId: 'node-piece', edits: [{ find: 'A line.', replace: 'A  revised line.' }] }]);
  assert.match(edited.changes[0].summary, /not a model/); assert.match(edited.commentary, /If Frige can place it exactly/);
  assert.deepEqual((await turn('Simulate edit: A line. =>', [piece])).changes[0].edits, [{ find: 'A line.', replace: '' }], 'an empty replacement deletes');
  const contentsOnly = await turn('Simulate edit: A => B', [programme]);
  assert.equal(contentsOnly.changes.length, 0); assert.match(contentsOnly.commentary, /no edit was simulated/);
  // The longest message a turn allows, with no arrow, is read at once and proposes nothing (review finding 1:
  // a backtracking pattern took minutes here and froze the server).
  const started = Date.now();
  const unanchored = await turn(`Simulate edit: ${' '.repeat(11_970)}x`, [piece]);
  assert.ok(Date.now() - started < 1_000, `took ${Date.now() - started} ms`);
  assert.equal(unanchored.changes.length, 0);
  assert.equal((await turn('Simulate edit:   => B', [piece])).changes.length, 0, 'an empty anchor is no edit');
});

test('a gateway change may carry anchored edits instead of the whole text, and only known fields are kept', async (context) => {
  const { createServer } = await import('node:http');
  const changes = [
    { nodeId: 'node-a', edits: [{ find: 'x', replace: 'y' }], summary: 'Edit.', extra: 'dropped' },
    { nodeId: 'node-b', source: 'Whole.' },
    { nodeId: 'node-c' },
    { nodeId: 'node-d', edits: 'not a list' },
  ];
  const gateway = createServer(async (request, response) => {
    for await (const chunk of request) void chunk;
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ commentary: 'ok', changes, parts: [], meta: { model: 'stub' } }));
  });
  await new Promise((resolve) => gateway.listen(0, '127.0.0.1', resolve));
  const saved = { mode: process.env.STEX_FRIGE_INFERENCE_MODE, url: process.env.STEX_INFERENCE_URL };
  delete process.env.STEX_FRIGE_INFERENCE_MODE; process.env.STEX_INFERENCE_URL = `http://127.0.0.1:${gateway.address().port}`;
  context.after(() => {
    gateway.close();
    if (saved.mode === undefined) delete process.env.STEX_FRIGE_INFERENCE_MODE; else process.env.STEX_FRIGE_INFERENCE_MODE = saved.mode;
    if (saved.url === undefined) delete process.env.STEX_INFERENCE_URL; else process.env.STEX_INFERENCE_URL = saved.url;
  });
  const reply = await requestScopeTurn({ book: { id: 'fixture', title: 'Fixture' }, scope: { id: 'node-a', kind: 'node', title: 'A', nodeIds: [] }, sources: [], graph: {}, turns: [], message: 'Hello.' });
  // The engine resolves and validates the edits; the client only shapes the reply.
  assert.deepEqual(reply.changes, [{ nodeId: 'node-a', edits: [{ find: 'x', replace: 'y' }], summary: 'Edit.' }, { nodeId: 'node-b', source: 'Whole.' }]);
});

test('a gateway layout field is shaped and bounded before the engine sees it', () => {
  assert.deepEqual(layoutFrom({ set: { fontSize: '12pt', leading: '14pt' }, summary: 'x'.repeat(900) }), { set: { fontSize: '12pt', leading: '14pt' }, summary: 'x'.repeat(500) });
  assert.deepEqual(layoutFrom({ clear: true }), { clear: true });
  for (const malformed of [null, 'clear', [], { clear: 'yes' }, { set: [] }, { set: 'x' }, { set: Object.fromEntries(Array.from({ length: 9 }, (_, index) => [String(index), 1])) }]) assert.equal(layoutFrom(malformed), null, JSON.stringify(malformed)?.slice(0, 40));
});

test('a scope turn sends the outline, settings and approved contracts as separately labelled fields to the gateway', async (context) => {
  const { createServer } = await import('node:http');
  let received = null;
  const gateway = createServer(async (request, response) => {
    let raw = ''; for await (const chunk of request) raw += chunk;
    received = JSON.parse(raw);
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ commentary: 'ok', changes: [], parts: [], meta: { model: 'stub', forwardedContext: { outline: { count: 1, truncated: true }, documentSettings: true, approvedContracts: ['c-1', 7] } } }));
  });
  await new Promise((resolve) => gateway.listen(0, '127.0.0.1', resolve));
  const saved = { mode: process.env.STEX_FRIGE_INFERENCE_MODE, url: process.env.STEX_INFERENCE_URL };
  delete process.env.STEX_FRIGE_INFERENCE_MODE; process.env.STEX_INFERENCE_URL = `http://127.0.0.1:${gateway.address().port}`;
  context.after(() => {
    gateway.close();
    if (saved.mode === undefined) delete process.env.STEX_FRIGE_INFERENCE_MODE; else process.env.STEX_FRIGE_INFERENCE_MODE = saved.mode;
    if (saved.url === undefined) delete process.env.STEX_INFERENCE_URL; else process.env.STEX_INFERENCE_URL = saved.url;
  });
  const hierarchy = { outline: { category: 'outline', entries: [{ nodeId: 'node-a' }], truncated: false }, settings: { category: 'document-settings', designHash: 'abc', book: {}, scope: null }, contracts: { category: 'approved-contract', entries: [] } };
  const reply = await requestScopeTurn({ book: { id: 'fixture', title: 'Fixture' }, scope: { id: 'book', kind: 'book', title: 'Fixture', nodeIds: [] }, sources: [], graph: {}, hierarchy, turns: [], message: 'Hello.' });
  assert.equal(reply.availability, 'available');
  assert.deepEqual(reply.meta.forwardedContext, { outline: { count: 1, truncated: true }, documentSettings: true, approvedContracts: ['c-1'], selection: false }, 'the gateway report is read and shaped');
  assert.deepEqual([received.outline, received.documentSettings, received.approvedContracts], [hierarchy.outline, hierarchy.settings, hierarchy.contracts]);
  assert.deepEqual(received.proposalForms, ['source', 'edits'], 'Frige tells the gateway it resolves anchored edits (D-020)');
  // A turn without that context sends none of the fields.
  await requestScopeTurn({ book: { id: 'fixture', title: 'Fixture' }, scope: { id: 'book', kind: 'book', title: 'Fixture', nodeIds: [] }, sources: [], graph: {}, turns: [], message: 'Hello.' });
  assert.equal('outline' in received, false); assert.equal('selection' in received, false);
  // A selected passage travels as its own labelled field, never inside the message (D-021).
  const passage = { nodeId: 'node-a', relativePath: '01/A.md', title: 'A', baseHash: 'h', action: 'revise', start: 3, end: 9, startLine: 2, endLine: 2, text: 'A line' };
  await requestScopeTurn({ book: { id: 'fixture', title: 'Fixture' }, scope: { id: 'node-a', kind: 'node', title: 'A', nodeIds: [] }, sources: [], graph: {}, turns: [], message: 'Revise the selected passage.', passage });
  assert.deepEqual(received.selection, { category: 'selected-passage', nodeId: 'node-a', relativePath: '01/A.md', sourceHash: 'h', action: 'revise', startLine: 2, endLine: 2, text: 'A line' });
  assert.equal(received.message, 'Revise the selected passage.');
});
