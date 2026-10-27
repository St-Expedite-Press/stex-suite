import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { BookStore, sourceHash } from '../src/project-store.mjs';
import { previewDocument, validatePageSource } from '../src/lualatex.mjs';

async function temporaryStore() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'texgraph-'));
  const store = new BookStore(root);
  await store.initialize();
  return { root, store };
}

test('initializes a one-page book with a stable source hash', async (context) => {
  const { root, store } = await temporaryStore();
  context.after(() => rm(root, { recursive: true, force: true }));
  const book = await store.book();
  const page = await store.page(book.pages[0].id);
  assert.equal(book.pages.length, 1);
  assert.equal(page.hash, sourceHash(page.source));
  assert.match(page.source, /\\section/);
});

test('rejects stale source updates and only accepts an explicit proposal', async (context) => {
  const { root, store } = await temporaryStore();
  context.after(() => rm(root, { recursive: true, force: true }));
  const page = await store.page('page-001');
  const proposal = await store.createProposal(page.id, { commentary: 'Replace the opening.', source: 'A revised page.' });
  await store.updatePage(page.id, 'A manual edit.', page.hash);
  await assert.rejects(() => store.acceptProposal(page.id, proposal.id), { code: 'STALE_PROPOSAL' });
  const stored = await store.proposal(page.id);
  assert.equal(stored.status, 'pending');
});

test('accepting a current proposal changes canonical source and records history', async (context) => {
  const { root, store } = await temporaryStore();
  context.after(() => rm(root, { recursive: true, force: true }));
  const page = await store.page('page-001');
  const proposal = await store.createProposal(page.id, { commentary: 'Shorten it.', source: 'A clean revision.' });
  const accepted = await store.acceptProposal(page.id, proposal.id);
  assert.equal(accepted.source, 'A clean revision.');
  assert.equal((await store.proposal(page.id)).status, 'accepted');
  assert.equal((await store.turns(page.id)).at(-1).kind, 'proposal-accepted');
});

test('adds a new canonical page to the book manifest', async (context) => {
  const { root, store } = await temporaryStore();
  context.after(() => rm(root, { recursive: true, force: true }));
  const page = await store.createPage('Second movement');
  assert.equal(page.id, 'page-002');
  assert.equal(page.title, 'Second movement');
  assert.equal((await store.book()).pages.at(-1).id, 'page-002');
});

test('rejects unsafe page-level TeX setup commands', () => {
  assert.equal(validatePageSource('A safe paragraph with \\emph{emphasis}.'), null);
  assert.match(validatePageSource('\\input{secrets.tex}'), /file access/i);
  assert.match(validatePageSource('\\directlua{os.execute("bad")}'), /Lua execution/i);
});

test('renders a trimmed POD preview with validated settings only', () => {
  const document = previewDocument({ trimSize: '6 × 9 in', margins: '0.5 in', fontSize: '10.5 pt', bodyFont: 'Crimson Pro' });
  assert.match(document, /paperwidth=6in,paperheight=9in/);
  assert.match(document, /inner=0.5in,outer=0.5in/);
  assert.match(document, /\\IfFontExistsTF\{Crimson Pro\}/);
  const fallback = previewDocument({ trimSize: 'not a size', margins: '0in', fontSize: '100pt', bodyFont: '\\input{bad}' });
  assert.match(fallback, /paperwidth=6in,paperheight=9in/);
  assert.match(fallback, /inner=0.5in/);
  assert.match(fallback, /\\IfFontExistsTF\{Latin Modern Roman\}/);
  assert.doesNotMatch(fallback, /input\{bad\}/);
});
