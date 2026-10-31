import { spawn } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { previewDocument } from './lualatex.mjs';
import { writeAtomic } from './project-store.mjs';

const escapeTeX = (value) => String(value)
  .replaceAll('\\', '\\textbackslash{}').replaceAll('&', '\\&').replaceAll('%', '\\%')
  .replaceAll('#', '\\#').replaceAll('_', '\\_').replaceAll('{', '\\{').replaceAll('}', '\\}')
  .replaceAll('~', '\\textasciitilde{}').replaceAll('^', '\\textasciicircum{}');

function manuscriptBody(markdown, kind) {
  let source = markdown;
  if (source.startsWith('---\n') || source.startsWith('---\r\n')) { const end = source.search(/\r?\n---\s*\r?\n/); if (end >= 0) source = source.slice(end).replace(/^\r?\n---\s*\r?\n/, ''); }
  source = source.replace(/\r?\n---\s*\r?\n(?=\s*#{2,4}\s+Editorial\b)[\s\S]*$/i, '');
  const lines = source.split(/\r?\n/); const chunks = [];
  for (const raw of lines) {
    const heading = /^(#{1,6})\s+(.+)$/.exec(raw);
    if (heading) { chunks.push(`\\${heading[1].length < 2 ? 'section*' : 'subsection*'}{${escapeTeX(heading[2])}`); continue; }
    if (!raw.trim()) { chunks.push('\\par'); continue; }
    chunks.push(`${escapeTeX(raw.replace(/\*\*/g, '').replace(/\*/g, ''))}\\par`);
  }
  if (kind === 'section-note' || kind === 'cycle-note') return `\\thispagestyle{empty}\n${chunks.join('\n')}`;
  return chunks.join('\n');
}

export async function assembleBook(store) {
  const graph = await store.graph({ refresh: true });
  const nodes = graph.readingOrder.map((id) => graph.nodes.find((node) => node.id === id)).filter(Boolean);
  if (!nodes.length) throw new Error('Programme.md has no resolvable manuscript links to assemble.');
  const settings = {};
  const sections = []; const pageMap = []; let logicalPage = 1;
  for (const node of nodes) {
    const source = await readFile(store.sourcePath(node.relativePath), 'utf8');
    // Start each intentional unit on a new physical page. Recto units receive a blank verso when the prior unit ended on recto.
    const startsRecto = node.kind === 'front-matter' || node.kind === 'section-note' || node.kind === 'cycle-note';
    if (startsRecto && logicalPage % 2 === 0) { sections.push('\\newpage\\null\\thispagestyle{empty}\\newpage'); logicalPage += 1; }
    sections.push(`% texgraph-node:${node.id}\n${manuscriptBody(source, node.kind)}\n\\clearpage`);
    pageMap.push({ logicalPage, nodeIds: [node.id], sourcePaths: [`manuscript/${node.relativePath}`], kind: node.kind });
    logicalPage += 1;
  }
  const document = previewDocument(settings).replace('\\input{page.tex}', sections.join('\n'));
  return { document, pageMap, graph, settings };
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

export async function buildBook(store) {
  const assembled = await assembleBook(store);
  const directory = path.join(store.buildDirectory(), `run-${Date.now()}-${randomUUID()}`);
  await mkdir(directory, { recursive: true }); await writeFile(path.join(directory, 'document.tex'), assembled.document, 'utf8');
  const result = await runLuaLaTex(directory);
  try {
    if (!result.ok) return result;
    const manifest = { schemaVersion: 1, builtAt: new Date().toISOString(), programmePath: assembled.graph.programmePath, pages: assembled.pageMap, spreads: assembled.pageMap.filter((entry) => entry.logicalPage % 2 === 1).map((entry) => ({ spread: Math.ceil(entry.logicalPage / 2), pageNumbers: [entry.logicalPage, entry.logicalPage + 1], nodeIds: entry.nodeIds })) };
    await writeAtomic(path.join(directory, 'page-map.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    await store.activateBuild(directory, manifest);
    return { ok: true, log: result.log, pageMap: manifest };
  } finally { await rm(directory, { recursive: true, force: true }); }
}
