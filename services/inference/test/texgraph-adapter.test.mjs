import assert from 'node:assert/strict';
import test from 'node:test';
import { legacyHermesRequest } from '../src/texgraph-adapter.mjs';

test('Frige compatibility requests scope their upstream identity and sources to the selected thread', () => {
  const base = { contract: 'stex.texgraph.scope-turn.v3', book: { id: 'one-book' }, message: 'Review this.', scopeSources: [{ nodeId: 'page-a', relativePath: 'one/A.md', title: 'A', kind: 'piece', sourceHash: 'aaa', source: 'Only A reaches Hermes.' }] };
  const section = legacyHermesRequest('scope-turn', { ...base, scope: { id: 'section-a', title: 'Section A' } });
  const other = legacyHermesRequest('scope-turn', { ...base, scope: { id: 'section-b', title: 'Section B' }, scopeSources: [{ nodeId: 'page-b', relativePath: 'one/B.md', title: 'B', kind: 'piece', sourceHash: 'bbb', source: 'Only B reaches Hermes.' }] });
  assert.match(section.conversation.id, /^frige-[a-f0-9]{40}$/); assert.match(other.conversation.id, /^frige-[a-f0-9]{40}$/); assert.notEqual(section.conversation.id, other.conversation.id);
  assert.equal(section.context.legacy.scopeSources.length, 1); assert.deepEqual(section.context.legacy.scopeSources[0], base.scopeSources[0]);
  assert.doesNotMatch(JSON.stringify(section), /Only B reaches Hermes/); assert.notEqual(section.requestId, other.requestId);
  const bookOne = legacyHermesRequest('scope-turn', { ...base, book: { id: 'book-one' }, scope: { id: 'book' } });
  const bookTwo = legacyHermesRequest('scope-turn', { ...base, book: { id: 'book-two' }, scope: { id: 'book' } });
  assert.notEqual(bookOne.conversation.id, bookTwo.conversation.id, 'whole-book threads must not collide across projects');
});
