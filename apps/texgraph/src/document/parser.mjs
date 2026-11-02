import { createHash } from 'node:crypto';

// Control characters other than tab and line ends have no printed form and stop or
// split LuaTeX input; the vault graph flags them.
export const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const BOLD_LINE = /^\s*\*\*([^*]+)\*\*\s*$/;
const FENCE = /^\s*```/;

// Content-derived ids stay stable when unrelated parts of a piece change; the
// occurrence number separates identical blocks.
function identify(blocks) {
  const seen = new Map();
  for (const block of blocks) {
    const content = block.type === 'stanza' ? block.lines.map((line) => line.text).join('\n') : block.type === 'heading' ? block.text : block.type === 'note' ? JSON.stringify(block.entries) : '';
    const digest = createHash('sha256').update(`${block.type}\n${content}`, 'utf8').digest('hex').slice(0, 10);
    const occurrence = (seen.get(digest) || 0) + 1; seen.set(digest, occurrence);
    block.id = `${block.type}-${digest}${occurrence > 1 ? `-${occurrence}` : ''}`;
  }
  return blocks;
}

// Reads a manuscript node into a document model. Source lines are verse lines:
// each keeps its own break and leading indentation, and blank lines separate
// stanzas. An "Editorial" section (reviewer labels with their quoted comments)
// becomes a note block, and the work resumes at the first other line. Every
// block carries its 1-based source line span; YAML front matter and code-fence
// markers are recorded as excluded regions, so each non-blank source line is
// accounted for exactly once.
export function parseManuscript(markdown) {
  const lines = String(markdown).replace(/^﻿/, '').replace(/\r\n?/g, '\n').replace(CONTROL_CHARACTERS, '').split('\n');
  const blocks = []; const excluded = []; let stanza = null; let note = null; let first = 0;
  if (lines[0]?.trim() === '---') {
    // Only a YAML-shaped header is front matter; an opening rule followed by verse is print content.
    const end = lines.findIndex((line, index) => index > 0 && /^---\s*$/.test(line));
    const header = end > 0 ? lines.slice(1, end).filter((line) => line.trim()) : [];
    if (header.some((line) => /^[\w-]+\s*:/.test(line)) && header.every((line) => /^[\w-]+\s*:|^\s+\S|^\s*-\s/.test(line))) {
      excluded.push({ type: 'front-matter', span: { start: 1, end: end + 1 } }); first = end + 1;
    }
  }
  const close = () => { if (stanza) blocks.push(stanza); stanza = null; };
  const nextContent = (index) => lines.slice(index + 1).find((line) => line.trim() && !FENCE.test(line)) ?? '';
  for (let index = first; index < lines.length; index += 1) {
    const raw = lines[index]; const number = index + 1;
    if (FENCE.test(raw)) { excluded.push({ type: 'fence-marker', span: { start: number, end: number } }); continue; }
    if (note) {
      if (!raw.trim()) continue;
      const quote = /^\s*>\s?(.*)$/.exec(raw);
      if (quote) {
        note.span.end = number;
        const text = quote[1].trim(); if (!text) continue;
        if (!note.entries.length) note.entries.push({ label: null, text: '' });
        const entry = note.entries.at(-1); entry.text = entry.text ? `${entry.text} ${text}` : text; continue;
      }
      // A bold line is a reviewer label only when a quoted comment follows it; otherwise (e.g. **II**) it is the work's own text.
      const label = BOLD_LINE.exec(raw);
      if (label && /^\s*>/.test(nextContent(index))) { note.entries.push({ label: label[1].trim(), text: '' }); note.span.end = number; continue; }
      note = null;
    }
    if (!raw.trim()) { close(); continue; }
    const editorial = /^#{1,6}\s+(Editorial\b.*?)\s*$/i.exec(raw);
    if (editorial) {
      close();
      // The separator belongs to the note.
      const separator = blocks.at(-1)?.type === 'break' ? blocks.pop() : null;
      note = { type: 'note', title: editorial[1], entries: [], span: { start: separator?.span.start ?? number, end: number } }; blocks.push(note); continue;
    }
    const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(raw);
    if (heading) { close(); blocks.push({ type: 'heading', level: heading[1].length, text: heading[2], span: { start: number, end: number } }); continue; }
    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(raw)) { close(); blocks.push({ type: 'break', span: { start: number, end: number } }); continue; }
    const expanded = raw.replaceAll('\t', '    ');
    const text = expanded.trimStart().trimEnd();
    // Indent is measured in ordinary spaces (half an em); an em space counts as two.
    const indent = [...expanded.slice(0, expanded.length - expanded.trimStart().length)].reduce((sum, character) => sum + (character === ' ' ? 2 : 1), 0);
    stanza ||= { type: 'stanza', lines: [], span: { start: number, end: number } };
    stanza.lines.push({ indent, text, line: number }); stanza.span.end = number;
  }
  close();
  return { blocks: identify(blocks), excluded, lineCount: lines.length };
}
