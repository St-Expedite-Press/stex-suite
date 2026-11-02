import { spawn } from 'node:child_process';
import { TRIM_SIZES } from './lualatex.mjs';
import { designHash } from './design-settings.mjs';

// Findings from the complete compiler log, taken at build time because the stored
// log is truncated. Overfull lines are attributed to pieces through the
// "% texgraph-node:" markers in the generated document.
export function compilerFindings({ log, document, units = [] }) {
  const text = String(log || '');
  const starts = []; String(document || '').split('\n').forEach((line, index) => { const match = /^% texgraph-node:(\S+)/.exec(line); if (match) starts.push({ line: index + 1, nodeId: match[1] }); });
  const nodeAt = (line) => [...starts].reverse().find((entry) => entry.line <= line)?.nodeId || null;
  const paths = new Map(units.map((unit) => [unit.nodeId, unit.sourcePath]));
  const overfull = [...text.matchAll(/Overfull \\hbox \(([\d.]+)pt too wide\)[^\n]*?lines? (\d+)(?:--\d+)?/g)].map((match) => {
    const nodeId = nodeAt(Number(match[2])); return { points: Number(match[1]), nodeId, sourcePath: paths.get(nodeId) || null };
  });
  const missing = new Map(); for (const match of text.matchAll(/Missing character: There is no (.+?) \(U\+([0-9A-F]+)\)/g)) missing.set(match[2], (missing.get(match[2]) || 0) + 1);
  return {
    overfull,
    missingGlyphs: [...missing].map(([code, count]) => ({ codePoint: `U+${code}`, count })),
    fontFallback: [...new Set([...text.matchAll(/TEXGRAPH-FONT-FALLBACK: ([^\r\n]+)/g)].map((match) => match[1].trim()))],
    warnings: (text.match(/(?:LaTeX|Package \w+) Warning/g) || []).length,
  };
}

// pdffonts (Poppler, also shipped with MiKTeX) when available; otherwise the check is unavailable.
function pdffonts(file) {
  return new Promise((resolve) => {
    let output = ''; const child = spawn('pdffonts', [file], { windowsHide: true });
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.on('error', () => resolve(null));
    child.on('close', (code) => resolve(code === 0 ? output : null));
  });
}

const check = (id, title, status, detail, items = []) => ({ id, title, status, detail, items });

// Deterministic checks of the proof on screen. They describe the proof; none of
// them, alone or together, makes a book press-ready.
export async function runPreflight({ manifest, pdfPath, pdfData, graph, currentDesign }) {
  if (!manifest || manifest.schemaVersion < 3) return { checkedAt: new Date().toISOString(), proof: null, checks: [check('proof', 'Compiler-mapped proof', 'fail', 'There is no compiler-mapped proof. Typeset the book first.')] };
  const checks = [];
  const pagination = manifest.pagination;
  checks.push(pagination.verified
    ? check('source-map', 'Source-to-page map', 'pass', `${manifest.nodes.filter((entry) => entry.firstPage).length} pieces mapped to compiler pages.`)
    : check('source-map', 'Source-to-page map', 'fail', 'The page map is unverified.', pagination.warnings));

  let pdf = null; let task = null;
  try {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    task = pdfjs.getDocument({ data: new Uint8Array(pdfData), isEvalSupported: false, verbosity: 0 });
    pdf = await task.promise;
  } catch (error) { checks.push(check('pdf', 'PDF readable', 'fail', `The proof PDF could not be read: ${error.message}`)); }
  if (pdf) {
    checks.push(pdf.numPages === pagination.physicalPageCount
      ? check('page-count', 'Page count', 'pass', `${pdf.numPages} pages, as the compiler reported.`)
      : check('page-count', 'Page count', 'fail', `The PDF has ${pdf.numPages} pages; the compiler reported ${pagination.physicalPageCount}.`));
    // PDF points are 1/72 in; the trim comes from the profile the proof was built with.
    const [width, height] = (TRIM_SIZES.get(manifest.design?.trimSize || '6 × 9 in') || ['6in', '9in']).map((value) => Number.parseFloat(value) * 72);
    const wrong = [];
    for (let number = 1; number <= pdf.numPages; number += 1) {
      const [x0, y0, x1, y1] = (await pdf.getPage(number)).view;
      if (Math.abs(x1 - x0 - width) > 0.5 || Math.abs(y1 - y0 - height) > 0.5) wrong.push(`p. ${number}: ${((x1 - x0) / 72).toFixed(3)} × ${((y1 - y0) / 72).toFixed(3)} in`);
    }
    checks.push(wrong.length
      ? check('geometry', 'Trim size', 'fail', `${wrong.length} page(s) differ from ${manifest.design?.trimSize}.`, wrong.slice(0, 20))
      : check('geometry', 'Trim size', 'pass', `Every page is ${manifest.design?.trimSize || '6 × 9 in'}.`));
    await task.destroy();
  }

  const fonts = pdfPath ? await pdffonts(pdfPath) : null;
  if (fonts === null) checks.push(check('embedding', 'Fonts embedded', 'unavailable', 'pdffonts is not available, so embedding was not checked.'));
  else {
    const rows = fonts.split(/\r?\n/).slice(2).filter((line) => line.trim());
    const unembedded = rows.filter((line) => { const columns = line.trim().split(/\s+/); return columns.at(-5) !== 'yes'; });
    checks.push(unembedded.length ? check('embedding', 'Fonts embedded', 'fail', `${unembedded.length} font(s) are not embedded.`, unembedded) : check('embedding', 'Fonts embedded', 'pass', `All ${rows.length} fonts are embedded.`));
  }

  const findings = manifest.compiler;
  if (!findings) checks.push(check('compiler', 'Compiler findings', 'unavailable', 'This proof predates compiler findings. Typeset it again.'));
  else {
    checks.push(findings.fontFallback.length ? check('fonts', 'Requested fonts', 'fail', `Not installed, replaced by Latin Modern: ${findings.fontFallback.join(', ')}.`) : check('fonts', 'Requested fonts', 'pass', 'The profile’s fonts were used.'));
    checks.push(findings.missingGlyphs.length ? check('glyphs', 'Glyph coverage', 'fail', `${findings.missingGlyphs.length} character(s) have no glyph in the font and do not print.`, findings.missingGlyphs.map((entry) => `${entry.codePoint} × ${entry.count}`)) : check('glyphs', 'Glyph coverage', 'pass', 'Every character has a glyph.'));
    const byPiece = new Map(); for (const entry of findings.overfull) byPiece.set(entry.sourcePath || 'unattributed', (byPiece.get(entry.sourcePath || 'unattributed') || 0) + 1);
    checks.push(findings.overfull.length ? check('overfull', 'Lines within the measure', 'warn', `${findings.overfull.length} line(s) run into the margin.`, [...byPiece].map(([piece, count]) => `${piece}: ${count}`)) : check('overfull', 'Lines within the measure', 'pass', 'No line runs into the margin.'));
  }

  const current = new Map(graph.nodes.map((node) => [node.id, node.hash]));
  const changed = Object.entries(manifest.sourceHashes || {}).filter(([id, hash]) => current.get(id) !== hash).map(([id]) => graph.nodes.find((node) => node.id === id)?.relativePath || id);
  const designChanged = (manifest.designHash ?? designHash({})) !== designHash(currentDesign);
  checks.push(changed.length || designChanged
    ? check('freshness', 'Proof matches source', 'warn', [changed.length && `${changed.length} piece(s) changed since this proof.`, designChanged && 'The design profile changed since this proof.'].filter(Boolean).join(' '), changed)
    : check('freshness', 'Proof matches source', 'pass', 'The proof matches the saved manuscript and profile.'));
  if (manifest.mode === 'isolated') checks.push(check('scope', 'Whole book', 'warn', `This proof is ${manifest.targetScope?.title} alone; preflight the whole book before production.`));

  return { checkedAt: new Date().toISOString(), proof: { builtAt: manifest.builtAt, scope: manifest.targetScope?.title, mode: manifest.mode }, checks };
}
