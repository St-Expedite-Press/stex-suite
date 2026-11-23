/** Frige regression tests source that checks project store vault behavior with disposable fixtures. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ProjectStore, sourceHash } from '../src/project-store-vault.mjs';
import { assembleBook, buildBook, inlineTeX, paginationFromCompiler } from '../src/book-assembler.mjs';
import { parseManuscript } from '../src/document/parser.mjs';

const hasLuaLaTeX = spawnSync('lualatex', ['--version'], { windowsHide: true }).status === 0;

/** Creates an isolated project vault containing synthetic manuscript data. */
async function vault() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'texgraph-vault-')); await mkdir(path.join(root, 'manuscript', '02'), { recursive: true }); await mkdir(path.join(root, 'manuscript', '01'), { recursive: true });
  await writeFile(path.join(root, 'manuscript', 'Programme.md'), '# Programme\n\n- [Second](02/Second.md)\n- [First](01/First.md)\n- [Missing](03/Missing.md)\n');
  await writeFile(path.join(root, 'manuscript', '01', 'First.md'), '# First\n\nOne.\n'); await writeFile(path.join(root, 'manuscript', '02', 'Second.md'), '# Second\n\nTwo.\n\n---\n\n### Editorial Includability\n\n**Ezra Pound — 5/10**\n\n> Reviewer comment,\n> continued.\n\n**II**\n\nResumed after notes.\n');
  const store = new ProjectStore(root); await store.initialize(); return { root, store };
}
test('maps the example table of contents without rewriting the manuscript and records diagnostics', async (context) => {
  const { root, store } = await vault(); context.after(() => rm(root, { recursive: true, force: true })); const graph = await store.graph();
  assert.equal(graph.readingOrder.length, 2); assert.equal(graph.tableOfContentsPath, 'manuscript/Programme.md'); assert.equal(graph.nodes.find((node) => node.id === graph.readingOrder[0]).relativePath, '02/Second.md'); assert.ok(graph.diagnostics.some((entry) => entry.code === 'unresolved-table-of-contents-link')); assert.ok(!graph.diagnostics.some((entry) => entry.code === 'empty-editorial-note'));
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
test('only the newest verified excerpts consume the attachment allowance', async (context) => {
  const { root, store } = await vault();
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(store.stateDirectory, 'extractions'));
  const documents = [];
  for (let i = 0; i < 11; i += 1) {
    const id = i.toString(16).padStart(16, '0');
    const extraction = `extractions/${id}.txt`;
    const source = i === 9 ? `${'漢'.repeat(5999)}😀 trailing` : `Synthetic excerpt ${i}`;
    const preview = i === 9 ? '漢'.repeat(5999) : source;
    await writeFile(path.join(store.stateDirectory, extraction), source);
    documents.push({ id, name: `${i}.md`, extraction, contextState: 'approved', reviewedAt: new Date(1e12 + i).toISOString(), approvalHash: sourceHash(i === 10 ? 'stale' : preview) });
  }
  await writeFile(path.join(store.stateDirectory, 'documents.json'), JSON.stringify(documents));
  const excerpts = await store.approvedSourceExcerpts();
  assert.deepEqual(excerpts.map((entry) => entry.name), ['9.md', '8.md', '7.md', '6.md', '5.md', '4.md', '3.md', '2.md']);
  assert.equal(excerpts[0].excerpt, '漢'.repeat(5999), 'a surrogate pair at the excerpt boundary is left whole by omission');
});
test('keeps book, section and page conversations as separate threads, including legacy anchor turns', async (context) => {
  const { root, store } = await vault(); context.after(() => rm(root, { recursive: true, force: true })); const graph = await store.graph();
  const page = graph.readingOrder[0]; const section = graph.book.sections[0].id;
  assert.equal(graph.book.sections[0].anchorNodeId, page);
  // Before scoped threads, a section turn was saved in its anchor page's file, tagged with the section id.
  await writeFile(path.join(root, '.texgraph', 'conversations', `${page}.jsonl`), `${JSON.stringify({ id: 'old', at: '2026-01-01T00:00:00.000Z', role: 'user', message: 'legacy section turn', scopeId: section })}\n`);
  await store.appendTurn('book', { role: 'user', message: 'about the book' });
  await store.appendTurn(section, { role: 'user', message: 'about the section' });
  await store.appendTurn(page, { role: 'user', message: 'about the page' });
  assert.deepEqual((await store.turns('book')).map((turn) => turn.message), ['about the book']);
  assert.deepEqual((await store.turns(section)).map((turn) => turn.message), ['legacy section turn', 'about the section']);
  assert.deepEqual((await store.turns(page)).map((turn) => turn.message), ['about the page']);
});
test('a change set keeps only changes to offered nodes, and accepting never overwrites a node edited since', async (context) => {
  const { root, store } = await vault(); context.after(() => rm(root, { recursive: true, force: true }));
  const { scope, sources } = await store.scopeContext('book');
  assert.equal(scope.kind, 'book'); assert.deepEqual(sources.map((entry) => entry.relativePath), ['Programme.md'], 'the book offers its table of contents');
  const graph = await store.graph(); const [second, first] = graph.readingOrder;
  const sectionId = graph.book.sections[0].id; const section = await store.scopeContext(sectionId);
  assert.deepEqual(section.sources.map((entry) => entry.nodeId), [second]);
  const pageContext = await store.scopeContext(first);
  const { changeSet, dropped } = await store.createChangeSet(first, { commentary: 'Two edits.', changes: [{ nodeId: first, source: '# First\n\nRevised.\n' }, { nodeId: second, source: '# Second\n\nNot offered.\n' }, { nodeId: first, source: 'duplicate' }] }, pageContext.sources);
  assert.deepEqual(changeSet.changes.map((change) => change.nodeId), [first]);
  assert.deepEqual(dropped.map((entry) => entry.nodeId), [second, first]);
  // Two offered nodes; one is edited by hand before the author accepts all.
  const both = [...section.sources, ...pageContext.sources];
  const pair = (await store.createChangeSet(sectionId, { changes: [{ nodeId: second, source: '# Second\n\nFrom Hermes.\n' }, { nodeId: first, source: '# First\n\nFrom Hermes.\n' }] }, both)).changeSet;
  const edited = await store.node(first); await store.updateNode(first, '# First\n\nBy hand.\n', edited.hash);
  // Accepting both together is all-or-nothing (program Wave 3d): the edited piece is
  // stale, so neither is written, and the other stays pending to decide again.
  const decided = await store.decideChanges(sectionId, pair.id, { decision: 'accept' });
  assert.deepEqual(decided.changes.map((change) => change.status), ['pending', 'stale']); assert.equal(decided.status, 'pending');
  assert.doesNotMatch(await readFile(path.join(root, 'manuscript', '02', 'Second.md'), 'utf8'), /From Hermes/);
  assert.match(await readFile(path.join(root, 'manuscript', '01', 'First.md'), 'utf8'), /By hand/);
  assert.equal((await store.turns(sectionId)).at(-1).kind, 'changes-decided');
  // The remaining piece can still be accepted on its own.
  const second2 = await store.decideChanges(sectionId, pair.id, { decision: 'accept' });
  assert.deepEqual(second2.changes.map((change) => change.status), ['accepted', 'stale']); assert.equal(second2.status, 'resolved');
  assert.match(await readFile(path.join(root, 'manuscript', '02', 'Second.md'), 'utf8'), /From Hermes/);
  await assert.rejects(() => store.decideChanges(sectionId, pair.id, { decision: 'accept' }), /No pending change/);
});
test('assembles table-of-contents order and prints editorial notes as footnotes where they occur', async (context) => {
  const { root, store } = await vault(); context.after(() => rm(root, { recursive: true, force: true })); const assembled = await assembleBook(store);
  assert.ok(assembled.document.indexOf('Second') < assembled.document.indexOf('First')); assert.ok(assembled.document.includes(String.raw`\tgline{0em}{Two.\footnote{\textit{Editorial Includability.} \textbf{Ezra Pound — 5/10.} Reviewer comment, continued.}}`));
  assert.ok(assembled.document.includes(String.raw`\tgline{0em}{\textbf{II}}`), 'a bold stanza numeral after the notes is the poem resuming'); assert.match(assembled.document, /Resumed after notes/); assert.equal(assembled.units[0].sourcePath, 'manuscript/02/Second.md');
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
  /** Constructs or reads the proof evidence needed by the test. */
  const proof = (verified, includedNodeIds = assembled.includedNodeIds) => store.recordBuild({ ok: true, targetScope: scope, includedNodeIds, sourceHashes: assembled.sourceHashes, pageMap: { schemaVersion: 3, pagination: { verified } }, log: 'proof' });
  await proof(false);
  await assert.rejects(() => store.queueLiveBuild(scope.id), { code: 'PAGINATION_UNVERIFIED' });
  await proof(true, []);
  await assert.rejects(() => store.queueLiveBuild(scope.id), { code: 'STALE_BUILD' }, 'a table of contents that no longer matches the proof is stale');
  await proof(true);
  const handoff = await store.queueLiveBuild(scope.id);
  assert.equal(handoff.status, 'queued-locally'); assert.equal(handoff.targetScope.id, scope.id);
  assert.match(await readFile(path.join(root, '.texgraph', 'live-builds', handoff.artifact.pdf), 'utf8'), /PDF-test/);
  const node = await store.node(graph.readingOrder[0]); await store.updateNode(node.id, '# Second\n\nChanged after proof.', node.hash);
  await assert.rejects(() => store.queueLiveBuild(scope.id), { code: 'STALE_BUILD' });
});
test('a table-of-contents insertion before the proof cutoff makes the proof stale', async (context) => {
  const { root, store } = await vault(); context.after(() => rm(root, { recursive: true, force: true }));
  const graph = await store.graph(); const scope = await store.scope('book'); const assembled = await assembleBook(store);
  await writeFile(store.previewPath(), '%PDF-test');
  await store.recordBuild({ ok: true, targetScope: scope, includedNodeIds: assembled.includedNodeIds, sourceHashes: assembled.sourceHashes, pageMap: { schemaVersion: 3, pagination: { verified: true } }, log: 'proof' });
  await writeFile(path.join(root, 'manuscript', '01', 'New.md'), '# New\n\nAdded.\n');
  await writeFile(path.join(root, 'manuscript', 'Programme.md'), '# Programme\n\n- [Second](02/Second.md)\n- [New](01/New.md)\n- [First](01/First.md)\n');
  assert.equal(graph.readingOrder.length, 2);
  await assert.rejects(() => store.queueLiveBuild('book'), { code: 'STALE_BUILD' });
});

test('renders verse markup and escapes TeX in one pass', () => {
  // Author's decision: a leading > is part of the line (e.g. a device prompt), not a quotation.
  assert.equal(inlineTeX('> reject?'), '> reject?');
  for (const [source, tex] of [
    ['*SHE:* and **HE:**', String.raw`\emph{SHE:} and \textbf{HE:}`],
    ['_quid restat?_ but snake_case', String.raw`\emph{quid restat?} but snake\_case`],
    ['a lone * stays', 'a lone * stays'],
    [String.raw`$5 & 10% \ {x}`, String.raw`\$5 \& 10\% \textbackslash{} \{x\}`],
    ['bell\u0007 and nul\u0000 removed', 'bell and nul removed'],
    ['listens  for', String.raw`listens\hspace{1em}\hspace{1em}for`],
  ]) assert.equal(inlineTeX(source), tex);
});
test('derives the page map only from compiler markers and refuses inconsistent evidence', () => {
  const units = [{ nodeId: 'node-a', kind: 'front-matter', sourcePath: 'manuscript/a.md' }, { nodeId: 'node-b', kind: 'poem', sourcePath: 'manuscript/b.md' }];
  const marks = 'start node-a 1 1\nend node-a 1 1\nblank 2\nstart node-b 3 3\nend node-b 5 5\ntotal 5\n';
  // Without a blank marker, the page before the next piece is a continuation (e.g. of a footnote).
  const continued = paginationFromCompiler({ marks: marks.replace('blank 2\n', ''), log: 'Output written on x (5 pages', units });
  assert.deepEqual(continued.nodes.map((node) => [node.firstPage, node.lastPage]), [[1, 2], [3, 5]]);
  assert.equal(continued.pagination.verified, true);
  const good = paginationFromCompiler({ marks, log: 'Output written on\n document.pdf (5 pages, 900 bytes).', units });
  assert.equal(good.pagination.verified, true); assert.equal(good.pagination.physicalPageCount, 5);
  assert.deepEqual(good.nodes.map((node) => [node.firstPage, node.lastPage]), [[1, 1], [3, 5]]);
  assert.deepEqual(good.pages.filter((page) => page.blank).map((page) => page.physicalPage), [2]);
  assert.deepEqual(good.spreads.map((spread) => spread.pages), [[1], [2, 3], [4, 5]]);
  for (const [badMarks, badLog] of [
    [marks.replace('end node-b 5 5\n', ''), 'Output written on x (5 pages'],
    [marks, 'Output written on x (6 pages'],
    [marks.replace('start node-b 3', 'start node-b 1'), 'Output written on x (5 pages'],
  ]) {
    const bad = paginationFromCompiler({ marks: badMarks, log: badLog, units });
    assert.equal(bad.pagination.verified, false); assert.ok(bad.pagination.warnings.length);
  }
});
test('compiles a multi-page proof whose page map matches LuaLaTeX output', { skip: !hasLuaLaTeX && 'lualatex is not on PATH' }, async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'texgraph-proof-')); context.after(() => rm(root, { recursive: true, force: true }));
  const stanzas = Array.from({ length: 30 }, (_, stanza) => Array.from({ length: 4 }, (_, line) => `Stanza ${stanza + 1} line ${line + 1} — Æther’s *turn*`).join('\n'));
  const files = {
    '00_Front_Matter/Title.md': '# A Synthetic Book\n\n### Editorial Includability\n\n**Ezra Pound — 5/10**\n\n> A note anchored to the heading.\n\n**John Gould Fletcher — 6/10**\n\n> A second reviewer paragraph.\n',
    '00_Front_Matter/Bare.md': '# Bare\n\nLine.\n\n### Editorial Includability\n\nJust prose.\n',
    '01_One/00_Section_Note.md': '# One\n\n                         a hanging fragment,\n',
    '01_One/Long.md': `# Long\n\n${stanzas.slice(0, 10).join('\n\n')}\n\n---\n\n### Editorial Includability\n\n**John Gould Fletcher — 7/10**\n\n> A mid-poem note.\n\n${stanzas.slice(10).join('\n\n')}\n`,
    '01_One/Empty.md': '',
    '01_One/Rule.md': '---\n',
    '01_One/Short.md': '# Short\u000B\n\nOne line with a bell\u0007 and a vertical\u000B tab.\n',
    '02_Two/00_Section_Note.md': '# Two\n',
  };
  for (const [relative, source] of Object.entries(files)) { await mkdir(path.dirname(path.join(root, 'manuscript', relative)), { recursive: true }); await writeFile(path.join(root, 'manuscript', relative), source); }
  await writeFile(path.join(root, 'manuscript', 'Programme.md'), Object.keys(files).map((relative) => `- [x](<${relative}>)`).join('\n'));
  const store = new ProjectStore(root); await store.initialize();
  const result = await buildBook(store);
  assert.equal(result.ok, true, result.error);
  const map = JSON.parse(await readFile(path.join(store.buildDirectory(), 'page-map.json'), 'utf8'));
  assert.equal(map.pagination.verified, true, map.pagination.warnings.join('\n'));
  const byPath = Object.fromEntries(map.nodes.map((node) => [node.sourcePath.replace('manuscript/', ''), node]));
  assert.ok(byPath['01_One/Long.md'].lastPage > byPath['01_One/Long.md'].firstPage, 'a long poem spans several physical pages');
  for (const note of ['01_One/00_Section_Note.md', '02_Two/00_Section_Note.md']) assert.equal(byPath[note].firstPage % 2, 1, `${note} opens on a recto`);
  assert.equal(map.pages.length, map.pagination.physicalPageCount);
  assert.equal(map.nodes.at(-1).lastPage, map.pagination.physicalPageCount);
  for (const empty of ['01_One/Empty.md', '01_One/Rule.md']) assert.equal(byPath[empty].firstPage, null, `${empty} has no print content and occupies no page`);
  assert.ok(map.pages.every((page) => !page.nodeIds.includes(byPath['01_One/Empty.md'].nodeId)));
  const diagnostics = (await store.graph()).diagnostics;
  assert.ok(diagnostics.some((entry) => entry.code === 'control-characters'));
  assert.deepEqual(diagnostics.filter((entry) => entry.code === 'empty-editorial-note').map((entry) => entry.nodePath), ['00_Front_Matter/Bare.md']);
  for (const page of map.pages.filter((entry) => entry.blank)) assert.equal(page.side, 'verso', 'only verso padding pages are blank');
});
test('concurrent decisions are serialized: one write wins, the other is stale or refused', async (context) => {
  const { root, store } = await vault(); context.after(() => rm(root, { recursive: true, force: true }));
  const graph = await store.graph(); const page = graph.readingOrder[0]; const section = graph.book.sections[0].id;
  const offered = (await store.scopeContext(page)).sources;
  const fromPage = (await store.createChangeSet(page, { changes: [{ nodeId: page, source: '# Second\n\nPAGE VERSION\n' }] }, offered)).changeSet;
  const fromSection = (await store.createChangeSet(section, { changes: [{ nodeId: page, source: '# Second\n\nSECTION VERSION\n' }] }, offered)).changeSet;
  const [first, second] = await Promise.all([store.decideChanges(page, fromPage.id, { decision: 'accept' }), store.decideChanges(section, fromSection.id, { decision: 'accept' })]);
  assert.deepEqual([first.changes[0].status, second.changes[0].status], ['accepted', 'stale']);
  assert.match(await readFile(path.join(root, 'manuscript', '02', 'Second.md'), 'utf8'), /PAGE VERSION/);
  // An accept and a reject of the same change: exactly one decision lands.
  const again = (await store.createChangeSet(page, { changes: [{ nodeId: page, source: '# Second\n\nThird.\n' }] }, (await store.scopeContext(page)).sources)).changeSet;
  const outcomes = await Promise.allSettled([store.decideChanges(page, again.id, { decision: 'accept' }), store.decideChanges(page, again.id, { decision: 'reject' })]);
  assert.deepEqual(outcomes.map((outcome) => outcome.status), ['fulfilled', 'rejected']);
  assert.equal((await store.changeSet(page)).changes[0].status, 'accepted');
});
test('change sets keep the file line endings and ignore pre-change-set proposal files', async (context) => {
  const { root, store } = await vault(); context.after(() => rm(root, { recursive: true, force: true }));
  const page = (await store.graph()).readingOrder[0];
  await store.updateNode(page, '# Second\r\n\r\nTwo.\r\n', (await store.node(page)).hash);
  const offered = (await store.scopeContext(page)).sources;
  assert.equal((await store.createChangeSet(page, { changes: [{ nodeId: page, source: '# Second\n\nTwo.\n' }] }, offered)).changeSet, null, 'a line-ending-only reply is no change');
  assert.equal((await store.createChangeSet(page, { changes: [{ nodeId: page, source: '# Second\n\nTwo, revised.\n' }] }, offered)).changeSet.changes[0].source, '# Second\r\n\r\nTwo, revised.\r\n');
  await writeFile(path.join(root, '.texgraph', 'proposals', `${page}.json`), JSON.stringify({ id: 'old', nodeId: page, source: '# Old', status: 'pending' }));
  assert.equal(await store.changeSet(page), null);
});
test('isolated proof page maps follow book pages, so a proof that starts on a verso opens with a lone verso', () => {
  const units = [{ nodeId: 'node-a', kind: 'poem', sourcePath: 'manuscript/a.md' }];
  const map = paginationFromCompiler({ marks: 'start node-a 1 42\nend node-a 3 44\ntotal 3\n', log: 'Output written on x (3 pages', units, pageOffset: 41 });
  assert.equal(map.pagination.verified, true);
  assert.deepEqual(map.pages.map((page) => [page.physicalPage, page.bookPage, page.side]), [[1, 42, 'verso'], [2, 43, 'recto'], [3, 44, 'verso']]);
  assert.deepEqual(map.spreads.map((spread) => spread.pages), [[1, 2], [3]]);
  assert.deepEqual([map.nodes[0].firstBookPage, map.nodes[0].lastBookPage], [42, 44]);
});
test('a section typeset alone reproduces its book pages and footnote numbers', { skip: !hasLuaLaTeX && 'lualatex is not on PATH' }, async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'texgraph-isolated-')); context.after(() => rm(root, { recursive: true, force: true }));
  /** Creates a synthetic note for the selected source. */
  const note = (name) => `\n\n### Editorial Includability\n\n**${name} — 5/10**\n\n> A note.\n`;
  /** Returns the test's stanza source while preserving line breaks. */
  const stanzas = (count, label) => Array.from({ length: count }, (_, stanza) => Array.from({ length: 4 }, (_, line) => `${label} ${stanza + 1}.${line + 1}`).join('\n')).join('\n\n');
  const files = {
    '01_A/00_Section_Note.md': '# A\n',
    '01_A/Long.md': `# Long\n\n${stanzas(25, 'Long')}${note('One')}`,
    '01_A/Short.md': `# Short\n\nOne line.${note('Two')}`,
    '02_B/First.md': `# First\n\n${stanzas(12, 'First')}${note('Three')}`,
    '02_B/Second.md': `# Second\n\n${stanzas(3, 'Second')}${note('Four')}`,
  };
  for (const [relative, source] of Object.entries(files)) { await mkdir(path.dirname(path.join(root, 'manuscript', relative)), { recursive: true }); await writeFile(path.join(root, 'manuscript', relative), source); }
  await writeFile(path.join(root, 'manuscript', 'Programme.md'), Object.keys(files).map((relative) => `- [x](<${relative}>)`).join('\n'));
  const store = new ProjectStore(root); await store.initialize();
  assert.equal((await buildBook(store)).ok, true);
  const book = await store.referenceMap(); assert.equal(book.mode, 'prefix');
  const sectionB = (await store.graph()).book.sections.find((section) => section.title === 'B');
  // A book proof made before reference maps existed lives only in page-map.json, which the isolated proof replaces.
  await rm(path.join(store.buildDirectory(), 'reference-map.json'));
  const result = await buildBook(store, { scopeId: sectionB.id, mode: 'isolated' });
  assert.equal((await store.referenceMap()).mode, 'prefix', 'the book proof stays the reference after an isolated proof');
  assert.equal(result.ok, true, result.error);
  const alone = result.pageMap;
  assert.equal(alone.mode, 'isolated'); assert.equal(alone.pagination.verified, true, alone.pagination.warnings.join('\n'));
  assert.deepEqual(alone.numbering, { startPage: book.nodes.find((entry) => entry.nodeId === sectionB.nodeIds[0]).firstPage, basis: 'book-proof', footnotes: 2 });
  /** Reads the compiler or fixture page mapping for the selected unit. */
  const pagesOf = (map) => map.nodes.filter((entry) => sectionB.nodeIds.includes(entry.nodeId)).map((entry) => [entry.firstBookPage ?? entry.firstPage, entry.lastBookPage ?? entry.lastPage, entry.firstFolio]);
  assert.deepEqual(pagesOf(alone), pagesOf(book), 'the section alone lands on the same book pages and folios');
  assert.equal(alone.pagination.physicalPageCount, book.nodes.find((entry) => entry.nodeId === sectionB.nodeIds.at(-1)).lastPage - alone.numbering.startPage + 1);
  await store.recordBuild(result);
  await assert.rejects(() => store.queueLiveBuild(sectionB.id), { code: 'LIVE_BUILD_REQUIRES_BOOK_ORDER' });
  // Once something before the section changes, its page numbers are only provisional.
  const short = (await store.graph()).nodes.find((node) => node.relativePath === '01_A/Short.md');
  await store.updateNode(short.id, '# Short\n\nTwo lines.\n', (await store.node(short.id)).hash);
  assert.equal((await buildBook(store, { scopeId: sectionB.id, mode: 'isolated' })).pageMap.numbering.basis, 'provisional');
});
test('pages carrying a footnote continuation belong to the piece the footnote came from', { skip: !hasLuaLaTeX && 'lualatex is not on PATH' }, async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'texgraph-footnote-')); context.after(() => rm(root, { recursive: true, force: true }));
  const reviewers = Array.from({ length: 40 }, (_, index) => `**Reviewer ${index + 1} — 5/10**\n\n> ${'A long reviewer remark that fills the footnote area. '.repeat(3)}`).join('\n\n');
  const files = { '01/Noted.md': `# Noted\n\nA short poem.\n\n### Editorial Includability\n\n${reviewers}\n`, '01/After.md': '# After\n\nThe next poem.\n' };
  for (const [relative, source] of Object.entries(files)) { await mkdir(path.dirname(path.join(root, 'manuscript', relative)), { recursive: true }); await writeFile(path.join(root, 'manuscript', relative), source); }
  await writeFile(path.join(root, 'manuscript', 'Programme.md'), Object.keys(files).map((relative) => `- [x](<${relative}>)`).join('\n'));
  const store = new ProjectStore(root); await store.initialize();
  const map = (await buildBook(store)).pageMap;
  assert.equal(map.pagination.verified, true, map.pagination.warnings.join('\n'));
  const [noted, after] = map.nodes;
  assert.ok(noted.lastPage > noted.firstPage, 'the footnote runs past the poem’s first page');
  assert.equal(after.firstPage, noted.lastPage + 1);
  assert.deepEqual(map.pages.filter((page) => page.blank).map((page) => page.physicalPage), [], 'no page is left unattributed');
});
test('stores Hermes artifacts by reference and only accepts images whose bytes match their type', async (context) => {
  const { root, store } = await vault(); context.after(() => rm(root, { recursive: true, force: true }));
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const { parts, dropped } = await store.storeParts('book', [
    { type: 'text', text: 'Hello.' },
    { type: 'artifact', kind: 'code', title: 'Helper', language: 'js', content: 'export const x = 1;' },
    { type: 'artifact', kind: 'image', title: 'Dot', mediaType: 'image/png', content: png },
    { type: 'artifact', kind: 'image', title: 'Liar', mediaType: 'image/jpeg', content: png },
    { type: 'artifact', kind: 'image', title: 'Page', mediaType: 'image/png', content: Buffer.from('<html><script>alert(1)</script>').toString('base64') },
    { type: 'choice', id: 'tone', prompt: 'Tone?', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] },
  ], { model: 'example/model' });
  assert.deepEqual(parts.map((part) => part.type), ['text', 'artifact', 'artifact', 'choice']);
  assert.deepEqual(dropped.map((entry) => entry.index), [3, 4]);
  const [code, image] = parts.filter((part) => part.type === 'artifact');
  assert.equal(code.content, undefined, 'turns hold a reference, not the content');
  assert.equal((await store.artifactContent(code.artifactId)).content.toString('utf8'), 'export const x = 1;');
  assert.equal((await store.artifact(image.artifactId)).mediaType, 'image/png');
  assert.equal((await store.artifacts()).length, 2);
  assert.match(parts[3].promptId, /^prompt-[a-f0-9]{16}$/);
  await assert.rejects(() => store.artifact('../../manuscript/x'), /Invalid artifact id/);
});
test('answers are validated against the stored prompt and recorded once', async (context) => {
  const { root, store } = await vault(); context.after(() => rm(root, { recursive: true, force: true }));
  const { parts } = await store.storeParts('book', [
    { type: 'choice', id: 'tone', prompt: 'Which tone?', options: [{ id: 'dark', label: 'Darker' }, { id: 'light', label: 'Lighter' }], allowOther: true },
    { type: 'form', id: 'facts', title: 'Book facts', fields: [{ id: 'title', label: 'Title', kind: 'text', required: true }, { id: 'trim', label: 'Trim', kind: 'select', options: ['6 × 9 in'] }, { id: 'pages', label: 'Pages', kind: 'number' }, { id: 'heads', label: 'Running heads', kind: 'checkbox' }] },
  ]);
  await store.appendTurn('book', { role: 'assistant', commentary: 'Two questions.', parts });
  const [choice, form] = parts;
  for (const values of [{ selected: ['nope'] }, { selected: [] }, { selected: ['dark', 'light'] }, { selected: ['dark'], other: 'and grim' }, null]) {
    await assert.rejects(() => store.recordAnswer('book', choice.promptId, values), { code: 'INVALID_ANSWER' });
  }
  for (const values of [{ trim: '6 × 9 in' }, { title: 'X', trim: 'A4' }, { title: 'X', pages: 'many' }, { title: 'X', extra: 1 }]) {
    await assert.rejects(() => store.recordAnswer('book', form.promptId, values), { code: 'INVALID_ANSWER' });
  }
  await assert.rejects(() => store.recordAnswer('book', 'prompt-0000000000000000', { selected: ['dark'] }), { code: 'UNKNOWN_PROMPT' });
  await assert.rejects(() => store.recordAnswer('scope-other-scope', choice.promptId, { selected: ['dark'] }), /scope|not found|not part/i);
  const outcomes = await Promise.allSettled([store.recordAnswer('book', choice.promptId, { other: 'Bleaker' }), store.recordAnswer('book', choice.promptId, { selected: ['light'] })]);
  assert.deepEqual(outcomes.map((outcome) => outcome.status), ['fulfilled', 'rejected']);
  assert.equal(outcomes[1].reason.code, 'ALREADY_ANSWERED');
  assert.equal(outcomes[0].value.message, 'Which tone? — Other: Bleaker');
  const answered = await store.recordAnswer('book', form.promptId, { title: '  Lift Wind  ', pages: '96', heads: true });
  assert.deepEqual(answered.values, { title: 'Lift Wind', trim: '', pages: 96, heads: true });
  assert.equal(answered.message, 'Book facts — Title: Lift Wind; Pages: 96; Running heads: yes');
});
test('an answer Hermes never received leaves the question open to answer again', async (context) => {
  const { root, store } = await vault(); context.after(() => rm(root, { recursive: true, force: true }));
  const { parts } = await store.storeParts('book', [{ type: 'choice', id: 'tone', prompt: 'Tone?', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] }]);
  await store.appendTurn('book', { role: 'assistant', commentary: 'One question.', parts });
  const pending = await store.reserveAnswer('book', parts[0].promptId, { selected: ['a'] });
  await assert.rejects(() => store.reserveAnswer('book', parts[0].promptId, { selected: ['b'] }), { code: 'ALREADY_ANSWERED' }, 'an answer on its way to Hermes holds the question');
  store.releaseAnswer(pending);
  assert.deepEqual((await store.recordAnswer('book', parts[0].promptId, { selected: ['b'] })).values, { selected: ['b'] });
  assert.equal((await store.turns('book')).filter((turn) => turn.kind === 'answer').length, 1);
});

// --- Stable section identity (program Wave 3e) ------------------------------------

/**
 * A book with section folder `01_Cycle` holding Alpha then Beta, and `02_End`.
 *
 * @param {import('node:test').TestContext} context
 */
async function cycleBook(context) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'frige-sections-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  for (const folder of ['01_Cycle', '02_End']) await mkdir(path.join(root, 'manuscript', folder), { recursive: true });
  await writeFile(path.join(root, 'manuscript', '01_Cycle', 'Alpha.md'), '# Alpha\n\nOne.\n');
  await writeFile(path.join(root, 'manuscript', '01_Cycle', 'Beta.md'), '# Beta\n\nTwo.\n');
  await writeFile(path.join(root, 'manuscript', '02_End', 'End.md'), '# End\n\nThree.\n');
  /** Builds the link programme used to test cyclic references. */
  const programme = (first) => `- [x](01_Cycle/${first}.md)\n- [x](01_Cycle/Beta.md)\n- [x](02_End/End.md)\n`;
  await writeFile(path.join(root, 'manuscript', 'Programme.md'), programme('Alpha'));
  const store = new ProjectStore(root); await store.initialize();
  return { root, store, programme };
}

test('a section keeps its id, conversation and proposals when its first piece is renamed or reordered', async (context) => {
  const { root, store, programme } = await cycleBook(context);
  const before = (await store.graph()).book.sections[0];
  assert.match(before.id, /^section-[a-f0-9]{16}$/);
  await store.appendTurn(before.id, { role: 'user', message: 'About the cycle.' });
  const { sources } = await store.scopeContext(before.id);
  const { changeSet } = await store.createChangeSet(before.id, { changes: [{ nodeId: sources[1].nodeId, source: '# Beta\n\nTwo, revised.\n' }] }, sources);
  // The first piece is renamed (a new node id), then the two pieces swap places.
  await rename(path.join(root, 'manuscript', '01_Cycle', 'Alpha.md'), path.join(root, 'manuscript', '01_Cycle', 'Aleph.md'));
  await writeFile(path.join(root, 'manuscript', 'Programme.md'), programme('Aleph'));
  await store.refreshGraph();
  await writeFile(path.join(root, 'manuscript', 'Programme.md'), '- [x](01_Cycle/Beta.md)\n- [x](01_Cycle/Aleph.md)\n- [x](02_End/End.md)\n');
  const after = (await store.refreshGraph()).book.sections[0];
  assert.equal(after.id, before.id, 'the id follows the folder, not the first piece');
  assert.deepEqual((await store.turns(after.id)).map((turn) => turn.message), ['About the cycle.']);
  assert.equal((await store.changeSet(after.id)).id, changeSet.id);
  assert.deepEqual((await store.contracts({ scopeId: after.id })).map((entry) => entry.id), [changeSet.id]);
});

test('conversations and contracts recorded under a section id from before stable ids stay attached, even after later renames', async (context) => {
  const { root, store, programme } = await cycleBook(context);
  const graph = await store.graph();
  const section = graph.book.sections[0];
  const oldId = `scope-${section.anchorNodeId}`;
  assert.ok(section.legacyIds.includes(oldId), 'the id it would have had before is an alias');
  // Data written by the earlier version, under the old id.
  await writeFile(path.join(root, '.texgraph', 'conversations', `${oldId}.jsonl`), `${JSON.stringify({ id: 'old-turn', at: '2026-01-01T00:00:00.000Z', role: 'user', message: 'Under the old id.', scopeId: oldId })}\n`);
  const { sources } = await store.scopeContext(section.id);
  const { changeSet } = await store.createChangeSet(oldId, { changes: [{ nodeId: sources[0].nodeId, source: '# Alpha\n\nOne, revised.\n' }] }, sources);
  assert.equal(changeSet.scopeId, section.id, 'a proposal addressed by the old id is recorded under the current one');
  const legacy = { ...changeSet, id: '0b7253f0-0000-4000-8000-000000000000', scopeId: oldId };
  await writeFile(path.join(root, '.texgraph', 'contracts', `${legacy.id}.json`), JSON.stringify(legacy));

  assert.equal((await store.scope(oldId)).id, section.id, 'the old id resolves to the section');
  assert.deepEqual((await store.turns(section.id)).map((turn) => turn.message), ['Under the old id.']);
  assert.ok((await store.contracts({ scopeId: section.id })).some((entry) => entry.id === legacy.id), 'contracts under the old id are listed with the section');
  const appended = await store.appendTurn(oldId, { role: 'user', message: 'Addressed by the old id.' });
  assert.equal(appended.scopeId, section.id);

  // The first piece is then renamed: the old id is still remembered through the previous graph.
  await rename(path.join(root, 'manuscript', '01_Cycle', 'Alpha.md'), path.join(root, 'manuscript', '01_Cycle', 'Aleph.md'));
  await writeFile(path.join(root, 'manuscript', 'Programme.md'), programme('Aleph'));
  const renamed = (await store.refreshGraph()).book.sections[0];
  assert.equal(renamed.id, section.id); assert.ok(renamed.legacyIds.includes(oldId));
  assert.deepEqual((await store.turns(section.id)).map((turn) => turn.message), ['Under the old id.', 'Addressed by the old id.']);
});

test('a folder that appears in two places in the reading order gives two sections with distinct, stable ids', async (context) => {
  const { root, store } = await cycleBook(context);
  await writeFile(path.join(root, 'manuscript', 'Programme.md'), '- [x](01_Cycle/Alpha.md)\n- [x](02_End/End.md)\n- [x](01_Cycle/Beta.md)\n');
  const sections = (await store.refreshGraph()).book.sections;
  assert.deepEqual(sections.map((section) => section.folder), ['01_Cycle', '02_End', '01_Cycle']);
  assert.equal(sections[2].id, `${sections[0].id}-2`);
  assert.equal(new Set(sections.map((section) => section.id)).size, 3);
});

test('when one run of a split folder disappears, the other keeps its own id and never takes over the vanished run', async (context) => {
  const { root, store } = await cycleBook(context);
  await writeFile(path.join(root, 'manuscript', 'Programme.md'), '- [x](01_Cycle/Alpha.md)\n- [x](02_End/End.md)\n- [x](01_Cycle/Beta.md)\n');
  const [first, , second] = (await store.refreshGraph()).book.sections;
  await store.appendTurn(first.id, { role: 'user', message: 'About Alpha only.' });
  await store.appendTurn(second.id, { role: 'user', message: 'About Beta only.' });
  const { sources } = await store.scopeContext(first.id);
  const { changeSet } = await store.createChangeSet(first.id, { changes: [{ nodeId: sources[0].nodeId, source: '# Alpha\n\nChanged.\n' }] }, sources);
  // Alpha leaves the table of contents: the first run vanishes.
  await writeFile(path.join(root, 'manuscript', 'Programme.md'), '- [x](02_End/End.md)\n- [x](01_Cycle/Beta.md)\n');
  const remaining = (await store.refreshGraph()).book.sections.find((section) => section.folder === '01_Cycle');
  assert.equal(remaining.id, second.id, 'the surviving run keeps the id it shares pieces with');
  assert.deepEqual((await store.turns(remaining.id)).map((turn) => turn.message), ['About Beta only.']);
  assert.equal(await store.changeSet(remaining.id), null, 'the vanished run\u2019s proposal is not inherited');
  // Restoring Alpha brings both runs back under their own ids.
  await writeFile(path.join(root, 'manuscript', 'Programme.md'), '- [x](01_Cycle/Alpha.md)\n- [x](02_End/End.md)\n- [x](01_Cycle/Beta.md)\n');
  const restored = (await store.refreshGraph()).book.sections;
  assert.equal(restored[0].id, first.id); assert.equal(restored[2].id, second.id);
  assert.equal((await store.changeSet(first.id)).id, changeSet.id);
});

test('a contract change to a piece outside its conversation’s section is never applied', async (context) => {
  const { root, store } = await cycleBook(context);
  const graph = await store.graph({ refresh: true });
  const [cycle, end] = graph.book.sections;
  // A contract recorded for the cycle section that names the End piece (as an alias mix-up could).
  const endSources = (await store.scopeContext(end.id)).sources;
  const { changeSet } = await store.createChangeSet(cycle.id, { changes: [{ nodeId: endSources[0].nodeId, source: '# End\n\nChanged from the wrong section.\n' }] }, endSources);
  const decided = await store.decideChanges(cycle.id, changeSet.id, { decision: 'accept' });
  assert.equal(decided.changes[0].status, 'stale'); assert.match(decided.changes[0].error, /no longer part of this conversation/);
  assert.equal(await readFile(path.join(root, 'manuscript', '02_End', 'End.md'), 'utf8'), '# End\n\nThree.\n');
});

test('old-form section ids stay attached through many renames, a lost graph, and a case-only folder rename', async (context) => {
  const { root, store } = await cycleBook(context);
  const section = (await store.graph()).book.sections[0];
  const oldId = `scope-${section.anchorNodeId}`;
  await writeFile(path.join(root, '.texgraph', 'conversations', `${oldId}.jsonl`), `${JSON.stringify({ id: 'old', at: '2026-01-01T00:00:00.000Z', role: 'user', message: 'Old data.', scopeId: oldId })}\n`);
  // Turns kept in the first piece's own file by older versions, tagged with the section id.
  await writeFile(path.join(root, '.texgraph', 'conversations', `${section.anchorNodeId}.jsonl`), `${JSON.stringify({ id: 'anchor', at: '2026-01-02T00:00:00.000Z', role: 'user', message: 'Anchor-file turn.', scopeId: oldId })}\n`);
  await store.refreshGraph();
  // The first piece is renamed again and again.
  let name = 'Alpha';
  for (let round = 0; round < 25; round += 1) {
    const next = `Alpha${round}`;
    await rename(path.join(root, 'manuscript', '01_Cycle', `${name}.md`), path.join(root, 'manuscript', '01_Cycle', `${next}.md`));
    await writeFile(path.join(root, 'manuscript', 'Programme.md'), `- [x](01_Cycle/${next}.md)\n- [x](01_Cycle/Beta.md)\n- [x](02_End/End.md)\n`);
    await store.refreshGraph(); name = next;
  }
  const expected = ['Old data.', 'Anchor-file turn.'];
  assert.deepEqual((await store.turns(section.id)).map((turn) => turn.message), expected, 'kept after 25 renames');
  // The graph file is lost and rebuilt.
  await rm(path.join(root, '.texgraph', 'graph.json'));
  const rebuilt = new ProjectStore(root); await rebuilt.initialize();
  assert.equal((await rebuilt.graph()).book.sections[0].id, section.id);
  assert.deepEqual((await rebuilt.turns(section.id)).map((turn) => turn.message), expected, 'kept after the graph is rebuilt');
  // A case-only folder rename keeps the section id (as node ids already ignore case).
  await rename(path.join(root, 'manuscript', '01_Cycle'), path.join(root, 'manuscript', '01_cycle'));
  await writeFile(path.join(root, 'manuscript', 'Programme.md'), `- [x](01_cycle/${name}.md)\n- [x](01_cycle/Beta.md)\n- [x](02_End/End.md)\n`);
  assert.equal((await rebuilt.refreshGraph()).book.sections[0].id, section.id);
  // No alias belongs to two sections.
  const all = (await rebuilt.graph()).book.sections.flatMap((entry) => entry.legacyIds);
  assert.equal(new Set(all).size, all.length);
});

test('a graph from before stable ids is rebuilt on first use, and records, artifacts and proofs addressed by old ids resolve to the section', async (context) => {
  const { root, store } = await cycleBook(context);
  const graph = await store.graph(); const section = graph.book.sections[0];
  const oldId = `scope-${section.anchorNodeId}`;
  // A graph as the earlier version wrote it: old-form section ids and no aliases.
  const old = { ...graph, book: { ...graph.book, sections: graph.book.sections.map(({ legacyIds, ...rest }) => ({ ...rest, id: `scope-${rest.anchorNodeId}` })) } };
  await writeFile(path.join(root, '.texgraph', 'graph.json'), JSON.stringify(old));
  const fresh = new ProjectStore(root); await fresh.initialize();
  assert.equal((await fresh.graph()).book.sections[0].id, section.id, 'rebuilt with stable ids at once');
  const stored = await fresh.storeParts(oldId, [{ type: 'artifact', kind: 'document', title: 'Notes', content: 'x' }]);
  assert.equal((await fresh.artifact(stored.parts[0].artifactId)).scopeId, section.id, 'artifacts use the current id');
  // A proof made under the old id still counts for the section's live build.
  const assembled = await assembleBook(fresh, { scopeId: section.id });
  await writeFile(fresh.previewPath(), '%PDF-test');
  await fresh.recordBuild({ ok: true, targetScope: { ...section, id: oldId }, includedNodeIds: assembled.includedNodeIds, sourceHashes: assembled.sourceHashes, pageMap: { schemaVersion: 3, mode: 'prefix', designHash: assembled.designHash, pagination: { verified: true } }, log: '' });
  assert.equal((await fresh.queueLiveBuild(section.id)).status, 'queued-locally');
});

/**
 * Adds pieces to the cycle book: `01_Cycle/<name>.md` for each name, and a
 * `03_Coda/Coda.md` piece used to split a folder into more runs.
 *
 * @param {string} root
 * @param {string[]} names
 */
async function addCyclePieces(root, names) {
  for (const name of names) await writeFile(path.join(root, 'manuscript', '01_Cycle', `${name}.md`), `# ${name}\n\nMore.\n`);
  await mkdir(path.join(root, 'manuscript', '03_Coda'), { recursive: true });
  await writeFile(path.join(root, 'manuscript', '03_Coda', 'Coda.md'), '# Coda\n\nLast.\n');
}

/** @param {string[]} entries  Paths under `manuscript/`, in reading order. */
const contents = (entries) => entries.map((entry) => `- [x](${entry})\n`).join('');

test('a split run whose every piece was renamed keeps its id when nothing else is ambiguous', async (context) => {
  const { root, store } = await cycleBook(context);
  await writeFile(path.join(root, 'manuscript', 'Programme.md'), contents(['01_Cycle/Alpha.md', '02_End/End.md', '01_Cycle/Beta.md']));
  const [, , second] = (await store.refreshGraph()).book.sections;
  await store.appendTurn(second.id, { role: 'user', message: 'About Beta.' });
  await rename(path.join(root, 'manuscript', '01_Cycle', 'Beta.md'), path.join(root, 'manuscript', '01_Cycle', 'Bet.md'));
  await writeFile(path.join(root, 'manuscript', 'Programme.md'), contents(['01_Cycle/Alpha.md', '02_End/End.md', '01_Cycle/Bet.md']));
  const renamed = (await store.refreshGraph()).book.sections[2];
  assert.equal(renamed.id, second.id);
  assert.deepEqual((await store.turns(renamed.id)).map((turn) => turn.message), ['About Beta.']);
});

test('a new run never inherits a vanished run while another run of the folder is also unmatched', async (context) => {
  const { root, store } = await cycleBook(context);
  await addCyclePieces(root, ['Gamma', 'Delta']);
  await writeFile(path.join(root, 'manuscript', 'Programme.md'), contents(['01_Cycle/Alpha.md', '01_Cycle/Beta.md', '02_End/End.md', '01_Cycle/Gamma.md']));
  const [cycle, , gamma] = (await store.refreshGraph()).book.sections;
  await store.appendTurn(gamma.id, { role: 'user', message: 'About Gamma.' });
  // Gamma goes, Delta arrives, and Alpha and Beta are split apart: Beta and Delta are both new
  // runs, so neither can be told apart as Gamma's successor.
  await writeFile(path.join(root, 'manuscript', 'Programme.md'), contents(['01_Cycle/Alpha.md', '02_End/End.md', '01_Cycle/Beta.md', '03_Coda/Coda.md', '01_Cycle/Delta.md']));
  const sections = (await store.refreshGraph()).book.sections.filter((section) => section.folder === '01_Cycle');
  assert.equal(sections[0].id, cycle.id);
  for (const section of sections.slice(1)) {
    assert.notEqual(section.id, gamma.id);
    assert.deepEqual(await store.turns(section.id), []);
  }
});

test('a run keeps the id of the earlier run it shares the most pieces with, not the first in reading order', async (context) => {
  const { root, store } = await cycleBook(context);
  await addCyclePieces(root, ['Gamma']);
  await writeFile(path.join(root, 'manuscript', 'Programme.md'), contents(['01_Cycle/Alpha.md', '02_End/End.md', '01_Cycle/Beta.md', '01_Cycle/Gamma.md']));
  const [, , later] = (await store.refreshGraph()).book.sections;
  await store.appendTurn(later.id, { role: 'user', message: 'About Beta and Gamma.' });
  // The runs merge: two of the three pieces were the later run's.
  await writeFile(path.join(root, 'manuscript', 'Programme.md'), contents(['01_Cycle/Alpha.md', '01_Cycle/Beta.md', '01_Cycle/Gamma.md', '02_End/End.md']));
  const merged = (await store.refreshGraph()).book.sections[0];
  assert.equal(merged.id, later.id);
  assert.deepEqual((await store.turns(merged.id)).map((turn) => turn.message), ['About Beta and Gamma.']);
});

test('a section id once retired is never issued again, so a new run cannot inherit its records', async (context) => {
  const { root, store } = await cycleBook(context);
  await addCyclePieces(root, ['Gamma']);
  await writeFile(path.join(root, 'manuscript', 'Programme.md'), contents(['01_Cycle/Alpha.md', '02_End/End.md', '01_Cycle/Beta.md']));
  const [first, , second] = (await store.refreshGraph()).book.sections;
  await store.appendTurn(second.id, { role: 'user', message: 'About Beta, split off.' });
  // Beta rejoins Alpha: the second run's id is retired (its records stay on disk).
  await writeFile(path.join(root, 'manuscript', 'Programme.md'), contents(['01_Cycle/Alpha.md', '01_Cycle/Beta.md', '02_End/End.md']));
  assert.equal((await store.refreshGraph()).book.sections[0].id, first.id);
  // A new piece then forms a second run; it gets an id never issued before.
  await writeFile(path.join(root, 'manuscript', 'Programme.md'), contents(['01_Cycle/Alpha.md', '01_Cycle/Beta.md', '02_End/End.md', '01_Cycle/Gamma.md']));
  const fresh = (await store.refreshGraph()).book.sections[2];
  assert.notEqual(fresh.id, second.id);
  assert.deepEqual(await store.turns(fresh.id), []);
  const memory = JSON.parse(await readFile(path.join(root, '.texgraph', 'section-aliases.json'), 'utf8'));
  assert.deepEqual(Object.keys(memory.sections).filter((id) => id === second.id || id === fresh.id).length, 2);
});

test('a damaged line in a piece file read for old section turns does not break the section thread', async (context) => {
  const { root, store } = await cycleBook(context);
  const section = (await store.graph()).book.sections[0];
  const oldId = `scope-${section.anchorNodeId}`;
  const good = JSON.stringify({ id: 'anchor', at: '2026-01-02T00:00:00.000Z', role: 'user', message: 'Anchor-file turn.', scopeId: oldId });
  await writeFile(path.join(root, '.texgraph', 'conversations', `${section.anchorNodeId}.jsonl`), `{"truncated\n${good}\n`);
  assert.deepEqual((await store.turns(section.id)).map((turn) => turn.message), ['Anchor-file turn.']);
});

test('with the graph lost, a split folder’s runs recover their own ids by their pieces, not their positions', async (context) => {
  const { root, store } = await cycleBook(context);
  await writeFile(path.join(root, 'manuscript', 'Programme.md'), contents(['01_Cycle/Alpha.md', '02_End/End.md', '01_Cycle/Beta.md']));
  const [alpha, , beta] = (await store.refreshGraph()).book.sections;
  await store.appendTurn(beta.id, { role: 'user', message: 'About Beta.' });
  // The graph is lost while the runs swap places.
  await rm(path.join(root, '.texgraph', 'graph.json'));
  await writeFile(path.join(root, 'manuscript', 'Programme.md'), contents(['01_Cycle/Beta.md', '02_End/End.md', '01_Cycle/Alpha.md']));
  const rebuilt = new ProjectStore(root); await rebuilt.initialize();
  const [first, , last] = (await rebuilt.graph()).book.sections;
  assert.equal(first.id, beta.id); assert.equal(last.id, alpha.id);
  assert.deepEqual((await rebuilt.turns(beta.id)).map((turn) => turn.message), ['About Beta.']);
});
