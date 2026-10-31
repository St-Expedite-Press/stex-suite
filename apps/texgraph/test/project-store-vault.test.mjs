import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ProjectStore } from '../src/project-store-vault.mjs';
import { assembleBook } from '../src/book-assembler.mjs';

async function vault() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'texgraph-vault-')); await mkdir(path.join(root, 'manuscript', '02'), { recursive: true }); await mkdir(path.join(root, 'manuscript', '01'), { recursive: true });
  await writeFile(path.join(root, 'manuscript', 'Programme.md'), '# Programme\n\n- [Second](02/Second.md)\n- [First](01/First.md)\n- [Missing](03/Missing.md)\n');
  await writeFile(path.join(root, 'manuscript', '01', 'First.md'), '# First\n\nOne.\n'); await writeFile(path.join(root, 'manuscript', '02', 'Second.md'), '# Second\n\nTwo.\n\n---\n\n### Editorial Includability\nNot print.\n');
  const store = new ProjectStore(root); await store.initialize(); return { root, store };
}
test('maps the example table of contents without rewriting the manuscript and records diagnostics', async (context) => {
  const { root, store } = await vault(); context.after(() => rm(root, { recursive: true, force: true })); const graph = await store.graph();
  assert.equal(graph.readingOrder.length, 2); assert.equal(graph.tableOfContentsPath, 'manuscript/Programme.md'); assert.equal(graph.nodes.find((node) => node.id === graph.readingOrder[0]).relativePath, '02/Second.md'); assert.ok(graph.diagnostics.some((entry) => entry.code === 'unresolved-table-of-contents-link')); assert.ok(graph.diagnostics.some((entry) => entry.code === 'editorial-block'));
  assert.equal(graph.book.kind, 'book'); assert.equal(graph.book.nodeIds.length, 2); assert.equal(graph.book.sections.length, 2); assert.equal((await store.scope(graph.readingOrder[0])).buildThroughNodeId, graph.readingOrder[0]);
  assert.match(await readFile(path.join(root, 'manuscript', '02', 'Second.md'), 'utf8'), /Editorial Includability/);
});
test('coalesces simultaneous graph refreshes so a vault sidecar is written once', async (context) => {
  const { root, store } = await vault(); context.after(() => rm(root, { recursive: true, force: true }));
  const graphs = await Promise.all([store.refreshGraph(), store.refreshGraph(), store.initialize()]);
  assert.equal(graphs[0].readingOrder.length, 2);
  assert.equal(graphs[1].readingOrder.length, 2);
  assert.equal((await store.node(graphs[0].readingOrder[1])).relativePath, '01/First.md');
});
test('rejects stale graph proposals and keeps acceptance history in sidecar state', async (context) => {
  const { root, store } = await vault(); context.after(() => rm(root, { recursive: true, force: true })); const graph = await store.graph(); const node = await store.node(graph.readingOrder[0]);
  const proposal = await store.createProposal(node.id, { source: '# Second\n\nChanged.', commentary: 'Change.' }); await store.updateNode(node.id, '# Second\n\nManual.', node.hash);
  await assert.rejects(() => store.acceptProposal(node.id, proposal.id), { code: 'STALE_PROPOSAL' });
});
test('assembles table-of-contents order and leaves editorial blocks out of derived TeX', async (context) => {
  const { root, store } = await vault(); context.after(() => rm(root, { recursive: true, force: true })); const assembled = await assembleBook(store);
  assert.ok(assembled.document.indexOf('Second') < assembled.document.indexOf('First')); assert.doesNotMatch(assembled.document, /Not print/); assert.equal(assembled.pageMap[0].sourcePaths[0], 'manuscript/02/Second.md');
  assert.match(assembled.document, /\\section\*\{Second\}/);
});
test('build scope keeps the complete preamble through the selected manuscript node', async (context) => {
  const { root, store } = await vault(); context.after(() => rm(root, { recursive: true, force: true })); const graph = await store.graph();
  const partial = await assembleBook(store, { scopeId: graph.readingOrder[0] });
  assert.deepEqual(partial.includedNodeIds, [graph.readingOrder[0]]);
  assert.match(partial.document, /Second/); assert.doesNotMatch(partial.document, /First/);
  assert.match(partial.document, /documentclass/);
  assert.equal(partial.sourceHashes[graph.readingOrder[0]].length, 64);
});
test('stages only a current verified proof for the live-build adapter', async (context) => {
  const { root, store } = await vault(); context.after(() => rm(root, { recursive: true, force: true }));
  const graph = await store.graph(); const scope = await store.scope(graph.readingOrder[0]); const assembled = await assembleBook(store, { scopeId: scope.id });
  await writeFile(store.previewPath(), '%PDF-test');
  await store.recordBuild({ ok: true, targetScope: scope, sourceHashes: assembled.sourceHashes, pageMap: { pages: assembled.pageMap }, log: 'proof' });
  const handoff = await store.queueLiveBuild(scope.id);
  assert.equal(handoff.status, 'queued-locally'); assert.equal(handoff.targetScope.id, scope.id);
  assert.match(await readFile(path.join(root, '.texgraph', 'live-builds', handoff.artifact.pdf), 'utf8'), /PDF-test/);
  const node = await store.node(graph.readingOrder[0]); await store.updateNode(node.id, '# Second\n\nChanged after proof.', node.hash);
  await assert.rejects(() => store.queueLiveBuild(scope.id), { code: 'STALE_BUILD' });
});
