import { spawn } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { designDocument, designHash } from './design-settings.mjs';
import { compilerFindings } from './preflight.mjs';
import { writeAtomic } from './project-store.mjs';
import { CONTROL_CHARACTERS, parseManuscript } from './document/parser.mjs';

// Typographic spaces are authorial spacing; Latin Modern has no glyphs for them, so they become explicit space.
const TEX_ESCAPES = { '\\': '\\textbackslash{}', '&': '\\&', '%': '\\%', $: '\\$', '#': '\\#', _: '\\_', '{': '\\{', '}': '\\}', '~': '\\textasciitilde{}', '^': '\\textasciicircum{}', ' ': '\\hspace{.5em}', ' ': '\\hspace{1em}', ' ': '\\thinspace{}' };
// One pass, so the braces of an emitted \textbackslash{} are never escaped again.
export const escapeTeX = (value) => String(value).replace(CONTROL_CHARACTERS, '').replace(/[\\&%$#_{}~^   ]/g, (character) => TEX_ESCAPES[character]);

const INLINE = /\*\*(?=\S)(.+?)\*\*|\*(?=[^\s*])([^*]+?)\*|(?<![\p{L}\p{N}_])_(?=\S)([^_]+?)_(?![\p{L}\p{N}_])/gu;
export function inlineTeX(text) {
  let result = ''; let last = 0;
  for (const match of text.matchAll(INLINE)) {
    result += escapeTeX(text.slice(last, match.index));
    result += match[1] !== undefined ? `\\textbf{${inlineTeX(match[1])}}` : `\\emph{${inlineTeX(match[2] ?? match[3])}}`;
    last = match.index + match[0].length;
  }
  // An unmatched * or _ is authorial text, not markup; it is kept literally.
  return result + escapeTeX(text.slice(last));
}

// All notes at one anchor form a single footnote, one paragraph per reviewer.
function footnoteText(notes) {
  return notes.map((note) => `\\textit{${inlineTeX(note.title)}.} ${note.entries.map((entry) => `${entry.label ? `\\textbf{${inlineTeX(entry.label)}.} ` : ''}${inlineTeX(entry.text)}`).join('\\par ')}`).join('\\par ');
}

// Each note is a footnote on the end of the text just before it; notes ahead of
// any text attach to the first heading or line that follows.
function anchoredNotes(blocks) {
  const footnotes = new Map(); let pending = []; let anchor = null;
  for (const block of blocks) {
    if (block.type === 'note') { if (block.entries.length) (anchor ? footnotes.get(anchor) : pending).push(block); continue; }
    if (block.type === 'heading' || block.type === 'stanza') { anchor = block; footnotes.set(block, pending); pending = []; }
  }
  return footnotes;
}
// How many footnote numbers a node uses: one per anchor that carries notes.
export const footnoteCount = (blocks) => [...anchoredNotes(blocks).values()].filter((notes) => notes.length).length;

function manuscriptBody(blocks, kind) {
  const footnotes = anchoredNotes(blocks);
  const marks = (block) => (footnotes.get(block)?.length ? `\\footnote{${footnoteText(footnotes.get(block))}}` : '');
  const chunks = blocks.filter((block) => block.type !== 'note').map((block) => {
    // A heading argument cannot hold paragraphs, so it carries only the mark and the text follows it.
    if (block.type === 'heading') {
      const notes = footnotes.get(block) || [];
      return `\\${block.level < 2 ? 'section*' : 'subsection*'}{${inlineTeX(block.text)}${notes.length ? '\\footnotemark' : ''}}${notes.length ? `\\footnotetext{${footnoteText(notes)}}` : ''}`;
    }
    if (block.type === 'break') return '\\par\\bigskip';
    const last = block.lines.length - 1;
    return `\\tgstanza\n${block.lines.map((line, index) => `\\tgline{${line.indent / 2}em}{${inlineTeX(line.text)}${index === last ? marks(block) : ''}}`).join('\n')}`;
  });
  // Openers carry no running head or folio.
  if (kind === 'section-note' || kind === 'cycle-note' || kind === 'front-matter') return `\\thispagestyle{empty}\n${chunks.join('\n')}`;
  return chunks.join('\n');
}

// Page evidence comes from the compiler: each node writes start/end markers that
// TeX expands at shipout with the physical page (\ReadonlyShipoutCounter) and folio.
const COMPOSITION_MACROS = String.raw`\makeatletter
\newwrite\tg@map\immediate\openout\tg@map=\jobname.tgmap
\newcommand\tgmark[2]{\write\tg@map{#1 #2 \the\ReadonlyShipoutCounter\space\thepage}}
\newcommand\tgrecto{\clearpage\ifodd\value{page}\else\null\write\tg@map{blank \the\ReadonlyShipoutCounter}\thispagestyle{empty}\newpage\fi}
\newcommand\tgstanza{\par\addvspace{\baselineskip}}
\newcommand\tgline[2]{{\noindent\hangindent=\dimexpr#1+2em\relax\hangafter=1\hspace*{#1}#2\par}}
\AtEndDocument{\clearpage\immediate\write\tg@map{total \the\ReadonlyShipoutCounter}}
\makeatother`;

// Book pagination for a scope typeset alone: where its first printed piece falls in
// a book-order proof. Exact only if everything before it is unchanged since then.
// Proofs made before design profiles existed used the default profile.
function isolatedStart(reference, preceding, firstNodeId, currentDesign) {
  const entry = reference?.nodes?.find((node) => node.nodeId === firstNodeId && node.firstPage);
  if (!entry) return { startPage: 1, basis: 'unknown' };
  const sameOrder = JSON.stringify((reference.includedNodeIds || []).slice(0, preceding.length)) === JSON.stringify(preceding.map((node) => node.id));
  const sameDesign = (reference.designHash ?? designHash({})) === currentDesign;
  const unchanged = sameOrder && sameDesign && preceding.every((node) => reference.sourceHashes?.[node.id] === node.hash);
  return { startPage: entry.firstBookPage ?? entry.firstPage, basis: unchanged ? 'book-proof' : 'provisional' };
}

// The verso running head: the profile's title, else the settings ticket's, else the folder name.
export async function resolveHeadTitle(store, graph, design) {
  const ticket = await store.settingsTicket();
  return design.headTitle || ticket?.identity?.title || graph.book?.title || '';
}

export async function assembleBook(store, { scopeId = 'book', mode = 'prefix', reference = null } = {}) {
  const graph = await store.graph({ refresh: true });
  const allNodes = graph.readingOrder.map((id) => graph.nodes.find((node) => node.id === id)).filter(Boolean);
  if (!allNodes.length) throw new Error('The table of contents (Programme.md in this example) has no resolvable manuscript links to assemble.');
  const scope = await store.scope(scopeId);
  const cutoff = allNodes.findIndex((node) => node.id === scope.buildThroughNodeId);
  if (cutoff < 0) throw new Error('The selected scope does not resolve to a reading-order node.');
  // A prefix proof is a valid book document from its beginning through the cutoff, so
  // its pagination is evaluated exactly as in the complete book. An isolated proof
  // typesets only the scope's pieces with the same preamble, continuing the book's
  // page and footnote numbering from what precedes it.
  const isolated = mode === 'isolated' && scope.kind !== 'book';
  const first = isolated ? allNodes.findIndex((node) => node.id === scope.nodeIds[0]) : 0;
  if (first < 0) throw new Error('The selected scope does not resolve to a reading-order node.');
  const nodes = allNodes.slice(first, cutoff + 1); const preceding = allNodes.slice(0, first);
  const settings = await store.design(); const designId = designHash(settings);
  const sections = []; const units = []; let numbering = { startPage: 1, basis: 'book-order', footnotes: 0 };
  const parsed = new Map();
  for (const node of nodes) parsed.set(node.id, parseManuscript(await readFile(store.sourcePath(node.relativePath), 'utf8')).blocks);
  if (isolated) {
    let footnotes = 0;
    for (const node of preceding) footnotes += footnoteCount(parseManuscript(await readFile(store.sourcePath(node.relativePath), 'utf8')).blocks);
    const firstPrinted = nodes.find((node) => parsed.get(node.id).some((block) => block.type === 'heading' || block.type === 'stanza'));
    numbering = { ...isolatedStart(reference, preceding, firstPrinted?.id, designId), footnotes };
    sections.push(`\\setcounter{page}{${numbering.startPage}}\\setcounter{footnote}{${numbering.footnotes}}`);
  }
  const sectionOf = (nodeId) => graph.book?.sections?.find((section) => section.nodeIds.includes(nodeId));
  let markedSection = null;
  for (const node of nodes) {
    const blocks = parsed.get(node.id);
    const unit = { nodeId: node.id, kind: node.kind, sourcePath: `manuscript/${node.relativePath}`, printable: blocks.some((block) => block.type === 'heading' || block.type === 'stanza') };
    units.push(unit);
    // A node without print content occupies no page, so it gets no markers.
    if (!unit.printable) { sections.push(`% texgraph-node:${node.id} (no print content)`); continue; }
    // Each unit starts a new page; openers start on a recto when the profile asks, decided in TeX from the folio.
    const opensRecto = settings.rectoOpeners && (node.kind === 'front-matter' || node.kind === 'section-note' || node.kind === 'cycle-note');
    // The recto running head names the section a page belongs to.
    // The recto head uses the section opener's own heading when it has one, so head and opener agree.
    const opener = node.kind === 'section-note' ? blocks.find((block) => block.type === 'heading')?.text : null;
    const section = sectionOf(node.id); const mark = section && section !== markedSection ? `\\markright{${opener ? inlineTeX(opener) : escapeTeX(section.title)}}` : '';
    if (section) markedSection = section;
    sections.push(`% texgraph-node:${node.id}\n${opensRecto ? '\\tgrecto\n' : ''}\\tgmark{start}{${node.id}}${mark}\n${manuscriptBody(blocks, node.kind)}\n\\tgmark{end}{${node.id}}\n\\clearpage`);
  }
  const headTitle = await resolveHeadTitle(store, graph, settings);
  const document = designDocument(settings, { title: headTitle }).replace('%TEXGRAPH-BODY%', () => `${COMPOSITION_MACROS}\n${sections.join('\n')}`);
  const sourceHashes = Object.fromEntries(nodes.map((node) => [node.id, node.hash]));
  return { document, units, graph, settings, headTitle, designHash: designId, scope, mode: isolated ? 'isolated' : 'prefix', numbering, includedNodeIds: nodes.map((node) => node.id), sourceHashes };
}

// Builds the page map only from compiler output. Anything inconsistent is
// reported and leaves the map unverified rather than guessed.
export function paginationFromCompiler({ marks, log, units, pageOffset = 0 }) {
  const warnings = []; const seen = new Map(); let shippedPages = null; const blanks = new Set();
  for (const line of String(marks || '').split(/\r?\n/)) {
    const total = /^total (\d+)$/.exec(line.trim());
    if (total) { shippedPages = Number(total[1]); continue; }
    const blank = /^blank (\d+)$/.exec(line.trim());
    if (blank) { blanks.add(Number(blank[1])); continue; }
    const match = /^(start|end) (\S+) (\d+) (\S+)$/.exec(line.trim()); if (!match) continue;
    const entry = seen.get(match[2]) || {};
    if (entry[match[1]]) warnings.push(`Duplicate ${match[1]} marker for ${match[2]}.`);
    entry[match[1]] = { page: Number(match[3]), folio: match[4] }; seen.set(match[2], entry);
  }
  const logged = /Output written on .*?\((\d+) pages?/.exec(String(log || '').replace(/\r?\n/g, ''));
  const loggedPages = logged ? Number(logged[1]) : null;
  if (shippedPages === null) warnings.push('The compiler did not report its shipped page total.');
  if (loggedPages === null) warnings.push('The compiler log does not report an output page count.');
  if (shippedPages !== null && loggedPages !== null && shippedPages !== loggedPages) warnings.push(`Shipped pages (${shippedPages}) and PDF pages (${loggedPages}) disagree.`);
  const physicalPageCount = loggedPages ?? shippedPages ?? 0;
  const nodes = []; let previousLast = 0;
  for (const unit of units) {
    if (unit.printable === false) { nodes.push({ ...unit, firstPage: null, lastPage: null }); continue; }
    const entry = seen.get(unit.nodeId);
    if (!entry?.start || !entry?.end) { warnings.push(`No compiler page markers for ${unit.sourcePath}.`); nodes.push({ ...unit, firstPage: null, lastPage: null }); continue; }
    const mapped = { ...unit, firstPage: entry.start.page, lastPage: entry.end.page, firstBookPage: entry.start.page + pageOffset, lastBookPage: entry.end.page + pageOffset, firstFolio: entry.start.folio, lastFolio: entry.end.folio };
    if (mapped.lastPage < mapped.firstPage || mapped.lastPage > physicalPageCount || mapped.firstPage < 1) warnings.push(`Impossible page range for ${unit.sourcePath}.`);
    if (mapped.firstPage <= previousLast) warnings.push(`${unit.sourcePath} shares a page with the preceding unit.`);
    previousLast = Math.max(previousLast, mapped.lastPage);
    nodes.push(mapped);
  }
  // A piece's end marker sits after its text, but a footnote can continue onto later
  // pages before the next piece starts. Pieces are separated by page breaks, so every
  // page up to the next piece belongs to this one, except recto padding (marked blank).
  const printed = nodes.filter((node) => node.firstPage);
  printed.forEach((node, index) => {
    let boundary = (printed[index + 1]?.firstPage ?? physicalPageCount + 1) - 1;
    while (boundary > node.lastPage && blanks.has(boundary)) boundary -= 1;
    if (boundary > node.lastPage) {
      node.lastPage = boundary; node.lastBookPage = boundary + pageOffset;
      if (/^\d+$/.test(node.lastFolio)) node.lastFolio = String(Number(node.firstFolio) + boundary - node.firstPage);
    }
  });
  const pages = Array.from({ length: physicalPageCount }, (_, index) => {
    const page = index + 1;
    const nodeIds = nodes.filter((node) => node.firstPage <= page && page <= node.lastPage).map((node) => node.nodeId);
    const bookPage = page + pageOffset;
    return { physicalPage: page, bookPage, side: bookPage % 2 ? 'recto' : 'verso', nodeIds, blank: !nodeIds.length };
  });
  // Spreads follow book pages: a verso opens a spread and the recto after it joins;
  // so a book opens on a lone recto and a proof starting on a verso opens with one.
  const spreads = [];
  for (const page of pages) {
    const open = spreads.at(-1);
    if (page.side === 'recto' && open?.pages.length === 1 && pages[open.pages[0] - 1].side === 'verso') open.pages.push(page.physicalPage);
    else spreads.push({ spread: Math.floor(page.bookPage / 2), pages: [page.physicalPage] });
  }
  return { pagination: { source: 'lualatex-shipout-markers', verified: !warnings.length && physicalPageCount > 0, physicalPageCount, warnings }, nodes, pages, spreads };
}

function runLuaLaTex(directory) {
  return new Promise((resolve) => {
    let output = ''; let settled = false;
    const finish = (result) => { if (!settled) { settled = true; resolve(result); } };
    const child = spawn('lualatex', ['-interaction=nonstopmode', '-halt-on-error', '-no-shell-escape', '-output-directory', directory, 'document.tex'], { cwd: directory, windowsHide: true });
    child.stdout.on('data', (chunk) => { output += chunk; }); child.stderr.on('data', (chunk) => { output += chunk; });
    child.on('error', (error) => finish({ ok: false, error: 'LuaLaTeX is unavailable. Install TeX Live or MiKTeX and ensure lualatex is on PATH.', log: `${output}\n${error.message}` }));
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish({ ok: false, error: 'LuaLaTeX exceeded the 30-second build limit.', log: output }); }, 30_000);
    child.on('close', async (code) => { clearTimeout(timer); if (settled) return; if (code !== 0) return finish({ ok: false, error: 'LuaLaTeX could not build this book.', log: output }); try { await readFile(path.join(directory, 'document.pdf')); finish({ ok: true, log: output }); } catch { finish({ ok: false, error: 'LuaLaTeX exited without producing a PDF.', log: output }); } });
  });
}

export async function buildBook(store, { scopeId = 'book', mode = 'prefix' } = {}) {
  const reference = mode === 'isolated' ? await store.referenceMap() : null;
  // The reference may be the current page map, which this proof is about to replace; keep it.
  if (reference) await store.saveReferenceMap(reference);
  const assembled = await assembleBook(store, { scopeId, mode, reference });
  const directory = path.join(store.buildDirectory(), `run-${Date.now()}-${randomUUID()}`);
  await mkdir(directory, { recursive: true }); await writeFile(path.join(directory, 'document.tex'), assembled.document, 'utf8');
  const result = await runLuaLaTex(directory);
  try {
    if (!result.ok) return result;
    const marks = await readFile(path.join(directory, 'document.tgmap'), 'utf8').catch(() => '');
    const compiled = paginationFromCompiler({ marks, log: result.log, units: assembled.units, pageOffset: assembled.numbering.startPage - 1 });
    const compiler = compilerFindings({ log: result.log, document: assembled.document, units: assembled.units });
    const manifest = { schemaVersion: 3, mode: assembled.mode, numbering: assembled.numbering, design: assembled.settings, designHash: assembled.designHash, headTitle: assembled.headTitle, compiler, builtAt: new Date().toISOString(), tableOfContentsPath: assembled.graph.tableOfContentsPath || assembled.graph.programmePath, programmePath: assembled.graph.programmePath, targetScope: assembled.scope, includedNodeIds: assembled.includedNodeIds, sourceHashes: assembled.sourceHashes, ...compiled };
    await writeAtomic(path.join(directory, 'page-map.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    await store.activateBuild(directory, manifest);
    // A verified book-order proof is the reference for later isolated page numbering.
    if (manifest.mode === 'prefix' && manifest.pagination.verified) await store.saveReferenceMap(manifest);
    return { ok: true, log: result.log, pageMap: manifest, targetScope: assembled.scope, includedNodeIds: assembled.includedNodeIds, sourceHashes: assembled.sourceHashes };
  } finally { await rm(directory, { recursive: true, force: true }); }
}
