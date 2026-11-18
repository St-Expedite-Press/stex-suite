import assert from 'node:assert/strict';
import test from 'node:test';
import { inferenceHealth, requestPageRevision, requestScopeTurn } from '../src/inference-client.mjs';

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
    const page = await requestPageRevision({ book: {}, page: {}, turns: [], message: 'Simulate change: A line.' });
    assert.equal(page.proposal, null); assert.doesNotMatch(page.commentary, /table of contents/, 'the one-page book is not told about scopes it does not have');
  } finally {
    if (previous === undefined) delete process.env.STEX_FRIGE_INFERENCE_MODE; else process.env.STEX_FRIGE_INFERENCE_MODE = previous;
  }
});
