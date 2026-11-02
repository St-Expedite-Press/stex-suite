import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ProjectStore } from '../src/project-store-vault.mjs';
import { assembleBook, buildBook } from '../src/book-assembler.mjs';
import { DESIGN_DEFAULTS, designDocument, designHash, normalizeDesign, validateDesign } from '../src/design-settings.mjs';
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
  const preflight = async () => runPreflight({ manifest, pdfPath: store.previewPath(), pdfData: await readFile(store.previewPath()), graph: await store.graph(), currentDesign: await store.design() });
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
