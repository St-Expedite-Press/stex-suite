/** Frige regression tests source that checks production behavior with disposable fixtures. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ProjectStore } from '../src/project-store-vault.mjs';
import { assembleBook, buildBook } from '../src/book-assembler.mjs';
import { DESIGN_DEFAULTS, designDocument, designHash, normalizeDesign, resolveLayout, validateDesign } from '../src/design-settings.mjs';
import { compilerFindings, runPreflight } from '../src/preflight.mjs';

const hasLuaLaTeX = spawnSync('lualatex', ['--version'], { windowsHide: true }).status === 0;

test('design profiles validate strictly on save and fall back to defaults on read', () => {
  assert.deepEqual(validateDesign({}).design, { ...DESIGN_DEFAULTS, margins: { ...DESIGN_DEFAULTS.margins } });
  assert.deepEqual(validateDesign({ fontSize: '40pt', leading: 'tall', runningHeads: 'yes', margins: { inner: '3in' }, trimSize: 'A0' }).errors.length, 5);
  assert.match(validateDesign({ fontSize: '12pt', leading: '10pt' }).errors[0], /Leading cannot be smaller/);
  assert.equal(normalizeDesign({ fontSize: '40pt' }).fontSize, '11pt');
  assert.equal(designHash({}), designHash(DESIGN_DEFAULTS));
  assert.notEqual(designHash({}), designHash({ folios: true }));
  const document = designDocument({ trimSize: '5.5 × 8.5 in', margins: { inner: '0.875in', outer: '0.625in', top: '0.75in', bottom: '0.8in' }, fontSize: '10.5pt', leading: '14pt', runningHeads: true, folios: true }, { title: 'A & B' });
  assert.match(document, /paperwidth=5\.5in,paperheight=8\.5in,top=0\.75in,bottom=0\.8in,inner=0\.875in,outer=0\.625in/);
  assert.match(document, /\\@setfontsize\\normalsize\{10\.5pt\}\{14pt\}/);
  assert.match(document, /\\scshape A \\& B/, 'the running head title is escaped');
  assert.match(designDocument({ runningHeads: true, headTitle: 'Lift Wind/Love Heat' }, { title: 'folder name' }), /\\scshape Lift Wind\/Love Heat\}/, 'the profile title wins over the folder');
  assert.match(document, /\\@oddfoot\{\\hfil\{\\footnotesize\\thepage\}\\hfil\}/);
});

test('compiler findings attribute overfull lines to pieces and collect missing glyphs and font fallbacks', () => {
  const document = ['\\begin{document}', '% texgraph-node:node-a', 'a', '% texgraph-node:node-b', 'b', 'b2'].join('\n');
  const log = 'Overfull \\hbox (12.5pt too wide) in paragraph at lines 5--5\nMissing character: There is no 漢 (U+6F22) in font "x"!\nMissing character: There is no 漢 (U+6F22) in font "x"!\nTEXGRAPH-FONT-FALLBACK: Nope Serif\nLaTeX Warning: something';
  assert.deepEqual(compilerFindings({ log, document, units: [{ nodeId: 'node-b', sourcePath: 'manuscript/b.md' }] }), {
    overfull: [{ points: 12.5, nodeId: 'node-b', sourcePath: 'manuscript/b.md' }],
    missingGlyphs: [{ codePoint: 'U+6F22', count: 2 }], fontFallback: ['Nope Serif'], warnings: 1,
  });
});

test('preflight reports what a real proof gets wrong and never declares it press-ready', { skip: !hasLuaLaTeX && 'lualatex is not on PATH' }, async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'texgraph-preflight-')); context.after(() => rm(root, { recursive: true, force: true }));
  const files = {
    '01_A/Wide.md': `# Wide\n\n${'Unbreakable'.repeat(20)}\n\nA glyph the font lacks: 漢.\n`,
    '01_A/Plain.md': '# Plain\n\nAn ordinary line.\n',
  };
  for (const [relative, source] of Object.entries(files)) { await mkdir(path.dirname(path.join(root, 'manuscript', relative)), { recursive: true }); await writeFile(path.join(root, 'manuscript', relative), source); }
  await writeFile(path.join(root, 'manuscript', 'Programme.md'), Object.keys(files).map((relative) => `- [x](<${relative}>)`).join('\n'));
  const store = new ProjectStore(root); await store.initialize();
  await assert.rejects(() => store.saveDesign({ fontSize: '99pt' }), { code: 'INVALID_DESIGN' });
  await store.saveDesign({ trimSize: '5.5 × 8.5 in', bodyFont: 'No Such Font Family', folios: true, runningHeads: true });
  const result = await buildBook(store); assert.equal(result.ok, true, result.error);
  await store.recordBuild(result);
  const manifest = JSON.parse(await readFile(path.join(store.buildDirectory(), 'page-map.json'), 'utf8'));
  assert.equal(manifest.designHash, designHash(await store.design()));
  assert.deepEqual(manifest.nodes.map((entry) => entry.firstFolio), ['1', '2'], 'folios come from the compiler');
  /** Runs the preflight workflow for the selected test inputs. */
  const preflight = async () => runPreflight({ manifest, pdfPath: store.previewPath(), pdfData: await readFile(store.previewPath()), graph: await store.graph(), currentDesign: await store.design() });
  /** Extracts the relevant status from the fixture response. */
  const status = (report) => Object.fromEntries(report.checks.map((entry) => [entry.id, entry.status]));
  const first = await preflight();
  assert.deepEqual({ ...status(first), embedding: undefined }, { 'source-map': 'pass', 'page-count': 'pass', geometry: 'pass', embedding: undefined, fonts: 'fail', glyphs: 'fail', overfull: 'warn', freshness: 'pass' });
  assert.ok(['pass', 'unavailable'].includes(status(first).embedding));
  // Every overfull line belongs to the piece with the unbreakable word, none to the plain one.
  assert.match(first.checks.find((entry) => entry.id === 'overfull').items.join('|'), /^manuscript\/01_A\/Wide\.md: \d+$/);
  assert.ok(!JSON.stringify(first).match(/press-ready|ready to print/i));
  // Changing the profile after the proof makes it stale and blocks the live-build handoff.
  await store.saveDesign({ trimSize: '6 × 9 in' });
  assert.equal(status(await preflight()).freshness, 'warn');
  await assert.rejects(() => store.queueLiveBuild('book'), { code: 'STALE_BUILD' });
});

test('preflight catches an overflowing running head and a table of contents changed after the proof', { skip: !hasLuaLaTeX && 'lualatex is not on PATH' }, async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'texgraph-preflight-heads-')); context.after(() => rm(root, { recursive: true, force: true }));
  const long = Array.from({ length: 80 }, (_, index) => `Line ${index + 1} of a poem long enough to reach a verso page.`).join('\n');
  await mkdir(path.join(root, 'manuscript', '01'), { recursive: true });
  await writeFile(path.join(root, 'manuscript', '01', 'Long.md'), `# Long\n\n${long}\n`);
  await writeFile(path.join(root, 'manuscript', '01', 'Later.md'), '# Later\n\nAdded after the proof.\n');
  await writeFile(path.join(root, 'manuscript', 'Programme.md'), '- [x](<01/Long.md>)\n');
  const store = new ProjectStore(root); await store.initialize();
  await store.saveDesign({ runningHeads: true, headTitle: 'W'.repeat(120) });
  const result = await buildBook(store); assert.equal(result.ok, true, result.error);
  /** Reads or constructs the report inspected in this scenario. */
  const report = async () => runPreflight({ manifest: result.pageMap, pdfPath: store.previewPath(), pdfData: await readFile(store.previewPath()), graph: await store.graph({ refresh: true }), currentDesign: await store.design(), currentHeadTitle: 'W'.repeat(120) });
  const overfull = (await report()).checks.find((entry) => entry.id === 'overfull');
  assert.equal(overfull.status, 'warn'); assert.match(overfull.items.join('|'), /running head or folio: \d+/);
  assert.equal((await report()).checks.find((entry) => entry.id === 'freshness').status, 'pass');
  await writeFile(path.join(root, 'manuscript', 'Programme.md'), '- [x](<01/Long.md>)\n- [x](<01/Later.md>)\n');
  const freshness = (await report()).checks.find((entry) => entry.id === 'freshness');
  assert.equal(freshness.status, 'warn'); assert.match(freshness.detail, /table of contents changed/);
});

test('saving a profile refuses non-object input and keeps fields that are left out', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'texgraph-design-')); context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'manuscript'), { recursive: true }); await writeFile(path.join(root, 'manuscript', 'Programme.md'), '# Contents\n');
  const store = new ProjectStore(root); await store.initialize();
  await store.saveDesign({ folios: true, margins: { inner: '0.875in' } });
  for (const input of [5, 'x', [], null]) await assert.rejects(() => store.saveDesign(input), { code: 'INVALID_DESIGN' });
  const saved = await store.saveDesign({ fontSize: '12pt', leading: '15pt' });
  assert.deepEqual([saved.folios, saved.margins.inner, saved.margins.outer, saved.fontSize], [true, '0.875in', '0.5in', '12pt']);
});

test('the recto running head uses the section opener heading', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'texgraph-heads-')); context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'manuscript', '01_A'), { recursive: true });
  await writeFile(path.join(root, 'manuscript', '01_A', '00_Section_Note.md'), '# Alpha & Omega\n');
  await writeFile(path.join(root, 'manuscript', '01_A', 'Poem.md'), '# Poem\n\nA line.\n');
  await writeFile(path.join(root, 'manuscript', 'Programme.md'), '- [x](<01_A/00_Section_Note.md>)\n- [x](<01_A/Poem.md>)\n');
  const store = new ProjectStore(root); await store.initialize();
  assert.ok((await assembleBook(store)).document.includes(String.raw`\markright{Alpha \& Omega}`));
});

// --- Layout overrides (program Wave 3a) -----------------------------------------

/**
 * A synthetic two-section book. Section `01_A` holds Alpha and Beta, section
 * `02_B` holds Gamma; every piece has enough lines that a larger type size
 * changes how many pages it spans.
 *
 * @param {import('node:test').TestContext} context
 * @returns {Promise<{ store: ProjectStore, ids: Record<string, string> }>}  Node ids by piece title.
 */
async function sectionedBook(context) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'frige-layout-')); context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'manuscript', '01_A'), { recursive: true }); await mkdir(path.join(root, 'manuscript', '02_B'), { recursive: true });
  /** Constructs a verse sample with controlled lines for the test. */
  const verse = (title) => `# ${title}\n\n${Array.from({ length: 30 }, (_, line) => `Line ${line + 1} of a synthetic piece called ${title}.`).join('\n')}\n`;
  for (const [folder, title] of [['01_A', 'Alpha'], ['01_A', 'Beta'], ['02_B', 'Gamma']]) await writeFile(path.join(root, 'manuscript', folder, `${title}.md`), verse(title));
  await writeFile(path.join(root, 'manuscript', 'Programme.md'), '- [Alpha](01_A/Alpha.md)\n- [Beta](01_A/Beta.md)\n- [Gamma](02_B/Gamma.md)\n');
  const store = new ProjectStore(root); const graph = await store.initialize();
  return { store, ids: Object.fromEntries(graph.nodes.filter((node) => node.kind === 'poem').map((node) => [node.title, node.id])) };
}

test('overrides validate strictly, drop individually when read, and leave an override-free profile hash unchanged', () => {
  const valid = validateDesign({ sections: { '01_A': { fontSize: '10pt', leading: '12pt', headText: 'The A Poems' } }, nodes: { 'node-abcdef': { opensRecto: true } } });
  assert.deepEqual(valid.errors, []);
  assert.deepEqual(valid.design.sections, { '01_A': { fontSize: '10pt', leading: '12pt', headText: 'The A Poems' } });
  assert.deepEqual(valid.design.nodes, { 'node-abcdef': { opensRecto: true } });
  const refused = validateDesign({ sections: { '01_A': { fontSize: '10pt' }, '..': { opensRecto: true }, '02_B': { trimSize: 'A4' } }, nodes: { 'node-abcdef': { headText: 'x' }, 'node-ghijkl': { fontSize: '12pt', leading: '9pt' } } });
  assert.equal(refused.design, null);
  for (const message of [/set together/, /does not name a section/, /trimSize cannot be set for a section/, /headText cannot be set for a piece/, /Leading cannot be smaller/]) assert.ok(refused.errors.some((entry) => message.test(entry)), String(message));
  assert.match(validateDesign({ sections: { '01_A': { fontSize: String.raw`\input{x}pt`, leading: '12pt' } } }).errors.join(' '), /Body size must be between/, 'no LaTeX passes as a value');
  // Read leniently: the invalid override goes; the valid one and the book settings stay.
  const read = normalizeDesign({ folios: true, sections: { '01_A': { fontSize: '40pt', leading: '50pt' }, '02_B': { opensRecto: false } } });
  assert.equal(read.folios, true); assert.deepEqual(read.sections, { '02_B': { opensRecto: false } });
  assert.equal(designHash({ sections: {}, nodes: {} }), designHash({}), 'empty override maps do not change the hash');
  assert.notEqual(designHash({ nodes: { 'node-abcdef': { opensRecto: true } } }), designHash({}));
  assert.equal(designHash({ sections: { b: { opensRecto: true }, a: { opensRecto: false } } }), designHash({ sections: { a: { opensRecto: false }, b: { opensRecto: true } } }), 'key order does not change the hash');
});

test('the nearest level that sets a value wins: element, then section, then book', () => {
  const design = { fontSize: '11pt', leading: '13.6pt', sections: { '01_A': { fontSize: '10pt', leading: '12pt', opensRecto: true, headText: 'A' } }, nodes: { 'node-beta00': { fontSize: '9pt', leading: '11pt', opensRecto: false } } };
  assert.deepEqual(resolveLayout(design, { sectionKey: '01_A', nodeId: 'node-beta00' }), { fontSize: '9pt', leading: '11pt', sizeFrom: 'element', nodeOpensRecto: false, sectionOpensRecto: true, headText: 'A' });
  assert.deepEqual(resolveLayout(design, { sectionKey: '01_A', nodeId: 'node-alpha0' }), { fontSize: '10pt', leading: '12pt', sizeFrom: 'section', nodeOpensRecto: undefined, sectionOpensRecto: true, headText: 'A' });
  assert.deepEqual(resolveLayout(design, { sectionKey: '02_B', nodeId: 'node-gamma0' }), { fontSize: '11pt', leading: '13.6pt', sizeFrom: 'book', nodeOpensRecto: undefined, sectionOpensRecto: undefined, headText: null });
});

test('saving overrides merges by key, clears with null, and refuses targets that are not in the book', async (context) => {
  const { store, ids } = await sectionedBook(context);
  await store.saveDesign({ folios: true, sections: { '01_A': { fontSize: '10pt', leading: '12pt' } } });
  await store.saveDesign({ nodes: { [ids.Beta]: { opensRecto: true } } });
  let saved = await store.design();
  assert.deepEqual([saved.folios, saved.sections['01_A'].fontSize, saved.nodes[ids.Beta].opensRecto], [true, '10pt', true], 'each save keeps what it leaves out');
  await store.saveDesign({ sections: { '01_A': null } });
  saved = await store.design();
  assert.equal(saved.sections, undefined, 'clearing the last override removes the map'); assert.equal(saved.nodes[ids.Beta].opensRecto, true);
  await assert.rejects(() => store.saveDesign({ sections: { '09_Missing': { opensRecto: true } } }), (error) => error.code === 'INVALID_DESIGN' && /not a section/.test(error.message));
  await assert.rejects(() => store.saveDesign({ nodes: { 'node-000000notreal': { opensRecto: true } } }), (error) => error.code === 'INVALID_DESIGN' && /not a piece/.test(error.message));
  await assert.rejects(() => store.saveDesign({ nodes: [] }), { code: 'INVALID_DESIGN' });
});

test('the assembled document applies an override to its own pieces only and records it in each unit', async (context) => {
  const { store, ids } = await sectionedBook(context);
  await store.saveDesign({ sections: { '01_A': { fontSize: '14pt', leading: '17pt', headText: 'Override & Head' } }, nodes: { [ids.Beta]: { fontSize: '9pt', leading: '11pt', opensRecto: true } } });
  const { document, units } = await assembleBook(store);
  /** Selects the parsed unit associated with the expected source. */
  const unitOf = (title) => units.find((unit) => unit.nodeId === ids[title]);
  assert.deepEqual(unitOf('Alpha').layout, { fontSize: '14pt', leading: '17pt', sizeFrom: 'section', opensRecto: false });
  assert.deepEqual(unitOf('Beta').layout, { fontSize: '9pt', leading: '11pt', sizeFrom: 'element', opensRecto: true });
  assert.deepEqual(unitOf('Gamma').layout, { fontSize: '11pt', leading: '13.6pt', sizeFrom: 'book', opensRecto: false });
  /** Builds an isolated source segment for the compiler fixture. */
  const chunk = (title) => { const start = document.indexOf(`% texgraph-node:${ids[title]}`); return document.slice(start, document.indexOf('\\clearpage', start)); };
  assert.match(chunk('Alpha'), /\\fontsize\{14pt\}\{17pt\}\\selectfont/); assert.match(chunk('Alpha'), /\\markright\{Override \\& Head\}/, 'the head text is escaped');
  assert.match(chunk('Beta'), /\\tgrecto/); assert.match(chunk('Beta'), /\\fontsize\{9pt\}\{11pt\}\\selectfont/);
  assert.doesNotMatch(chunk('Gamma'), /\\fontsize/, 'a piece at the book size gets no group');
});

test('override edge cases found in review: line breaks, half pairs, long folders, inherited property names', () => {
  assert.match(validateDesign({ sections: { '01_A': { headText: 'Head\n\nText' } } }).errors.join(' '), /on one line/, 'a line break would end the TeX argument');
  assert.match(validateDesign({ sections: { '01_A': { headText: 'Tab\there' } } }).errors.join(' '), /on one line/);
  assert.match(validateDesign({ nodes: { 'node-abcdef': { fontSize: '12pt', leading: '' } } }).errors.join(' '), /set together/, 'one empty field of the pair is reported as such');
  assert.deepEqual(validateDesign({ nodes: { 'node-abcdef': { fontSize: '', leading: '', opensRecto: true } } }).design.nodes, { 'node-abcdef': { opensRecto: true } });
  assert.deepEqual(validateDesign({ sections: { ['F'.repeat(200)]: { opensRecto: true } } }).errors, [], 'a folder name up to 255 characters can be named');
  assert.equal(resolveLayout({}, { sectionKey: 'constructor', nodeId: 'toString' }).sizeFrom, 'book', 'an inherited property is not an override');
});

/**
 * A book whose section `02_B` opens with a piece that prints nothing, and whose
 * folder `01_A` appears in two separate runs of the reading order.
 *
 * @param {import('node:test').TestContext} context
 */
async function irregularBook(context) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'frige-layout-irregular-')); context.after(() => rm(root, { recursive: true, force: true }));
  for (const folder of ['01_A', '02_B']) await mkdir(path.join(root, 'manuscript', folder), { recursive: true });
  await writeFile(path.join(root, 'manuscript', '01_A', 'One.md'), '# One\n\nA line.\n');
  await writeFile(path.join(root, 'manuscript', '01_A', 'Three.md'), '# Three\n\nA line.\n');
  // Only an editorial note: no heading or stanza, so nothing prints.
  await writeFile(path.join(root, 'manuscript', '02_B', 'Empty.md'), '### Editorial\n\n**Reader — 5/10**\n\n> A comment.\n');
  await writeFile(path.join(root, 'manuscript', '02_B', 'Real.md'), '# Real\n\nA line.\n');
  await writeFile(path.join(root, 'manuscript', 'Programme.md'), '- [One](01_A/One.md)\n- [Empty](02_B/Empty.md)\n- [Real](02_B/Real.md)\n- [Three](01_A/Three.md)\n');
  const store = new ProjectStore(root); const graph = await store.initialize();
  // Keyed by file name: a piece's title comes from its first heading, which the note-only piece lacks.
  return { store, ids: Object.fromEntries(graph.nodes.map((node) => [path.posix.basename(node.relativePath, '.md'), node.id])) };
}

test('a section setting reaches the first piece that prints, once for each run of its folder', async (context) => {
  const { store, ids } = await irregularBook(context);
  await store.saveDesign({ sections: { '01_A': { opensRecto: true, headText: 'HEAD' }, '02_B': { opensRecto: true } } });
  const { document, units } = await assembleBook(store);
  /** Selects the parsed unit associated with the expected source. */
  const unitOf = (title) => units.find((unit) => unit.nodeId === ids[title]);
  assert.equal(unitOf('Real').layout.opensRecto, true, 'the note-only anchor does not swallow the section setting');
  assert.equal(unitOf('Empty').layout, undefined, 'a piece that prints nothing has no layout');
  assert.equal(unitOf('One').layout.opensRecto, true); assert.equal(unitOf('Three').layout.opensRecto, true, 'each run of the folder opens as a section');
  assert.equal(document.match(/\\markright\{HEAD\}/g).length, 2);
});

test('an unchanged override whose piece left the table of contents does not block other saves', async (context) => {
  const { store, ids } = await sectionedBook(context);
  await store.saveDesign({ nodes: { [ids.Gamma]: { opensRecto: true } } });
  await writeFile(path.join(store.manuscriptDirectory, 'Programme.md'), '- [Alpha](01_A/Alpha.md)\n- [Beta](01_A/Beta.md)\n');
  // The workstation resends the stored override with every save; that is not setting it anew.
  const saved = await store.saveDesign({ folios: true, nodes: { [ids.Gamma]: { opensRecto: true } } });
  assert.equal(saved.folios, true); assert.deepEqual(saved.nodes[ids.Gamma], { opensRecto: true });
  await assert.rejects(() => store.saveDesign({ nodes: { [ids.Gamma]: { opensRecto: false } } }), (error) => error.code === 'INVALID_DESIGN' && /“Gamma” is not a piece/.test(error.message), 'changing it is refused, naming the piece by title');
  assert.equal((await store.saveDesign({ nodes: { [ids.Gamma]: null } })).nodes, undefined, 'it can always be cleared');
});

test('a real proof follows the overrides: a larger section size spans more pages, and clearing it restores the book',{ skip: !hasLuaLaTeX && 'lualatex is not on PATH' }, async (context) => {
  const { store, ids } = await sectionedBook(context);
  /** Reads the compiler or fixture page mapping for the selected unit. */
  const pagesOf = async () => {
    const build = await store.recordBuild(await buildBook(store));
    assert.equal(build.ok, true, build.error || build.log); assert.equal(build.pageMap.pagination.verified, true, build.pageMap.pagination.warnings.join(' '));
    return Object.fromEntries(Object.entries(ids).map(([title, id]) => { const node = build.pageMap.nodes.find((entry) => entry.nodeId === id); return [title, node.lastPage - node.firstPage + 1]; }));
  };
  const book = await pagesOf();
  await store.saveDesign({ sections: { '01_A': { fontSize: '18pt', leading: '30pt' } } });
  const enlarged = await pagesOf();
  assert.ok(enlarged.Alpha > book.Alpha && enlarged.Beta > book.Beta, `section pieces grow: ${JSON.stringify({ book, enlarged })}`);
  assert.equal(enlarged.Gamma, book.Gamma, 'the other section is unchanged');
  await store.saveDesign({ nodes: { [ids.Beta]: { fontSize: '11pt', leading: '13.6pt' } } });
  const pieceWins = await pagesOf();
  assert.equal(pieceWins.Beta, book.Beta, 'the piece override beats its section'); assert.equal(pieceWins.Alpha, enlarged.Alpha);
  await store.saveDesign({ sections: { '01_A': null }, nodes: { [ids.Beta]: null } });
  assert.deepEqual(await pagesOf(), book, 'clearing the overrides restores the book layout');
});
