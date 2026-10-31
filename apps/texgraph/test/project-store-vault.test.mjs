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
test('maps Programme order without rewriting the manuscript and records diagnostics', async (context) => {
  const { root, store } = await vault(); context.after(() => rm(root, { recursive: true, force: true })); const graph = await store.graph();
  assert.equal(graph.readingOrder.length, 2); assert.equal(graph.nodes.find((node) => node.id === graph.readingOrder[0]).relativePath, '02/Second.md'); assert.ok(graph.diagnostics.some((entry) => entry.code === 'unresolved-programme-link')); assert.ok(graph.diagnostics.some((entry) => entry.code === 'editorial-block'));
  assert.match(await readFile(path.join(root, 'manuscript', '02', 'Second.md'), 'utf8'), /Editorial Includability/);
});
test('rejects stale graph proposals and keeps acceptance history in sidecar state', async (context) => {
  const { root, store } = await vault(); context.after(() => rm(root, { recursive: true, force: true })); const graph = await store.graph(); const node = await store.node(graph.readingOrder[0]);
  const proposal = await store.createProposal(node.id, { source: '# Second\n\nChanged.', commentary: 'Change.' }); await store.updateNode(node.id, '# Second\n\nManual.', node.hash);
  await assert.rejects(() => store.acceptProposal(node.id, proposal.id), { code: 'STALE_PROPOSAL' });
});
test('assembles Programme order and leaves editorial blocks out of derived TeX', async (context) => {
  const { root, store } = await vault(); context.after(() => rm(root, { recursive: true, force: true })); const assembled = await assembleBook(store);
  assert.ok(assembled.document.indexOf('Second') < assembled.document.indexOf('First')); assert.doesNotMatch(assembled.document, /Not print/); assert.equal(assembled.pageMap[0].sourcePaths[0], 'manuscript/02/Second.md');
});
