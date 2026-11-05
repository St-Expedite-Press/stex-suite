import assert from 'node:assert/strict';
import test from 'node:test';
import { parseManuscript } from '../src/document/parser.mjs';

const verse = (block) => block.lines.map(({ indent, text }) => ({ indent, text }));
const shape = (blocks) => blocks.map((block) => block.type);
const sample = ['---', 'title: x', '---', '# Title', '', 'First line  ', '    indented — Æther’s', '', '```', '   fenced *Latin*', '```', 'After', '', '---', '', '### Editorial Notes', '> cut', ''].join('\n');

test('keeps verse lineation, stanzas, indentation and Unicode', () => {
  const { blocks } = parseManuscript(sample);
  assert.deepEqual(shape(blocks), ['heading', 'stanza', 'stanza', 'note']);
  assert.deepEqual(blocks[3].entries, [{ label: null, text: 'cut' }]);
  assert.deepEqual(verse(blocks[1]), [{ indent: 0, text: 'First line' }, { indent: 4, text: 'indented — Æther’s' }]);
  assert.deepEqual(verse(blocks[2]), [{ indent: 3, text: 'fenced *Latin*' }, { indent: 0, text: 'After' }]);
  for (const [source, expected] of [
    ['  If there be such a fool\n', [{ indent: 4, text: 'If there be such a fool' }]], // two em spaces indent 2em
    ['> new device detected\n', [{ indent: 0, text: '> new device detected' }]], // author's decision: a leading > is text
  ]) assert.deepEqual(verse(parseManuscript(source).blocks[0]), expected);
});

test('treats only a YAML-shaped header as front matter', () => {
  // An opening rule followed by verse is not front matter and must not swallow the verse.
  assert.deepEqual(shape(parseManuscript('---\nKept line\n---\nAfter\n').blocks), ['break', 'stanza', 'break', 'stanza']);
  assert.deepEqual(parseManuscript('---\ntitle: x\n---\n').blocks, []);
  const heading = parseManuscript('﻿# A\n').blocks[0];
  assert.deepEqual([heading.type, heading.level, heading.text], ['heading', 1, 'A']);
});

test('records source spans and accounts for every non-blank line exactly once', () => {
  const { blocks, excluded, lineCount } = parseManuscript(sample);
  assert.deepEqual(blocks.map((block) => [block.type, block.span.start, block.span.end]), [['heading', 4, 4], ['stanza', 6, 7], ['stanza', 10, 12], ['note', 14, 17]]);
  assert.deepEqual(blocks[2].lines.map((line) => line.line), [10, 12]);
  const lines = sample.split('\n'); const owners = new Array(lineCount + 1).fill(0);
  // A stanza owns its verse lines (a fence marker may sit inside its span); other regions own their span.
  for (const region of [...blocks, ...excluded]) {
    const owned = region.type === 'stanza' ? region.lines.map((line) => line.line) : Array.from({ length: region.span.end - region.span.start + 1 }, (_, offset) => region.span.start + offset);
    for (const line of owned) owners[line] += 1;
  }
  lines.forEach((text, index) => assert.equal(owners[index + 1], text.trim() ? 1 : owners[index + 1] && 1, `line ${index + 1} ${JSON.stringify(text)}`));
});

test('gives blocks content-derived ids that survive edits elsewhere', () => {
  const before = parseManuscript('# Poem\n\nA line.\n\nRefrain.\n\nRefrain.\n').blocks;
  const after = parseManuscript('# Poem\n\nA changed line.\n\nRefrain.\n\nRefrain.\n').blocks;
  assert.equal(new Set(before.map((block) => block.id)).size, before.length, 'repeated stanzas get distinct ids');
  assert.deepEqual([before[0].id, before[2].id, before[3].id], [after[0].id, after[2].id, after[3].id]);
  assert.notEqual(before[1].id, after[1].id);
});

test('front matter needs an exact opening rule and a closing rule followed by a line break', () => {
  // Each of these was print content before the model moved out of the assembler; it still is.
  for (const source of ['---\ntitle: x\n---', '---  \ntitle: x\n---\nVerse\n', ' ---\ntitle: x\n---\nVerse\n']) {
    assert.ok(parseManuscript(source).blocks.some((block) => block.type === 'stanza' && block.lines.some((line) => /title: x/.test(line.text))), JSON.stringify(source));
  }
  assert.deepEqual(parseManuscript('---\r\ntitle: x\r\n---\r\nVerse\r\n').excluded.map((region) => region.type), ['front-matter']);
});

test('a fence marker inside an editorial note is owned by the note only', () => {
  const { blocks, excluded } = parseManuscript('# Poem\n\nLine.\n\n### Editorial Includability\n\n**R — 5/10**\n\n```\n> quoted\n```\n\n> more\n');
  const note = blocks.find((block) => block.type === 'note');
  assert.deepEqual([note.span.start, note.span.end], [5, 13]);
  assert.deepEqual(excluded, []);
});
