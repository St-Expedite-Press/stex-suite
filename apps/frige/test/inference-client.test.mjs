import assert from 'node:assert/strict';
import test from 'node:test';
import { inferenceHealth, requestPageRevision, requestScopeTurn } from '../src/inference-client.mjs';

test('Frige alpha deterministic transport returns a labelled no-change response without a gateway', async () => {
  const previous = process.env.STEX_FRIGE_INFERENCE_MODE;
  process.env.STEX_FRIGE_INFERENCE_MODE = 'fake';
  try {
    const result = await requestScopeTurn({ book: { id: 'fixture', title: 'Fixture' }, scope: { id: 'book', kind: 'book', title: 'Fixture', nodeIds: [] }, sources: [], graph: {}, turns: [], message: 'Check this proof.' });
    assert.equal(result.availability, 'available'); assert.equal(result.changes.length, 0); assert.equal(result.meta.model, 'stex/hermes-fake'); assert.match(result.commentary, /Deterministic Hermes simulator/);
    assert.deepEqual(await inferenceHealth(), { state: 'simulated', model: 'stex/hermes-fake', provider: 'fake' });
    const page = await requestPageRevision({ book: {}, page: {}, turns: [], message: 'Revise this page.' });
    assert.equal(page.availability, 'available'); assert.equal(page.proposal, null);
  } finally {
    if (previous === undefined) delete process.env.STEX_FRIGE_INFERENCE_MODE; else process.env.STEX_FRIGE_INFERENCE_MODE = previous;
  }
});
