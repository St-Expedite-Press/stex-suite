import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { projectContext } from '../src/project-context.mjs';
import { ProjectStore, sourceHash } from '../src/project-store-vault.mjs';

async function fixture(context, source = '\uFEFF# Source\r\n\r\n  Καλημέρα — a line.\r\n\r\n\tAnother stanza.\r\n') {
  const root = await mkdtemp(path.join(os.tmpdir(), 'stex-frige-context-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const book = path.join(root, 'book');
  const manuscript = path.join(book, 'manuscript');
  await mkdir(path.join(manuscript, 'pieces'), { recursive: true });
  const programme = '# Programme\n\n- [Source](pieces/Source.md)\n';
  await writeFile(path.join(manuscript, 'Programme.md'), programme);
  const file = path.join(manuscript, 'pieces', 'Source.md');
  await writeFile(file, source);
  const store = new ProjectStore(book);
  await store.initialize();
  return { root, store, file, source, programme, manuscript };
}

test('Frige context exports exact Unicode, whitespace and provenance without changing canonical source', async (context) => {
  const { store, file, source, programme, manuscript } = await fixture(context);
  const catalog = await projectContext(store, 'synthetic-book');
  assert.equal(catalog.schemaVersion, 'stex.project.context.v1');
  assert.equal(catalog.project.reference, 'stex://frige/project/synthetic-book');
  const entry = catalog.sources.find((item) => item.title === 'Source');
  assert.ok(entry);
  assert.equal(entry.revision, sourceHash(source));
  assert.equal(entry.bytes, Buffer.byteLength(source));
  assert.equal(entry.available, true);
  assert.equal(Object.hasOwn(entry, 'source'), false, 'catalogues expose metadata only');
  const result = await projectContext(store, 'synthetic-book', { sourceId: entry.id, revision: entry.revision });
  assert.equal(result.source.source, source);
  assert.equal(result.source.reference, `${catalog.project.reference}#source=${entry.id}`);
  assert.equal(result.source.bytes, Buffer.byteLength(source));
  assert.equal(await readFile(file, 'utf8'), source);
  assert.equal(await readFile(path.join(manuscript, 'Programme.md'), 'utf8'), programme);
});

test('Frige rejects stale or unknown source revisions and malformed pages', async (context) => {
  const { store, file } = await fixture(context);
  const entry = (await projectContext(store, 'synthetic-book')).sources.find((item) => item.title === 'Source');
  await writeFile(file, '# Source\n\nChanged after preview.\n');
  await assert.rejects(() => projectContext(store, 'synthetic-book', { sourceId: entry.id, revision: entry.revision }), { status: 409, code: 'STALE_SOURCE' });
  await assert.rejects(() => projectContext(store, 'synthetic-book', { sourceId: 'node-missing', revision: entry.revision }), { status: 404, code: 'NOT_FOUND' });
  await assert.rejects(() => projectContext(store, 'synthetic-book', { offset: '../1' }), { status: 400, code: 'INVALID_REQUEST' });
});

test('Frige lists oversized sources as unavailable and refuses their content', async (context) => {
  const { store } = await fixture(context, '# Source\n\n' + 'é'.repeat(6000));
  const entry = (await projectContext(store, 'synthetic-book')).sources.find((item) => item.title === 'Source');
  assert.equal(entry.available, false);
  assert.ok(entry.bytes > 12000);
  await assert.rejects(() => projectContext(store, 'synthetic-book', { sourceId: entry.id, revision: entry.revision }), { status: 413, code: 'CONTEXT_LIMIT' });
});

test('Frige denies a directory-link escape even when graph metadata predates the replacement', async (context) => {
  const { root, store, manuscript } = await fixture(context);
  const graph = await store.graph();
  const entry = graph.nodes.find((item) => item.title === 'Source');
  const outside = path.join(root, 'outside');
  await mkdir(outside);
  await writeFile(path.join(outside, 'Source.md'), 'PRIVATE outside the selected manuscript');
  const pieces = path.join(manuscript, 'pieces');
  await rm(pieces, { recursive: true });
  await symlink(outside, pieces, process.platform === 'win32' ? 'junction' : 'dir');
  context.after(() => unlink(pieces).catch(() => {}));
  // Preserve an actual earlier graph to exercise the realpath guard against a
  // concurrent replacement, rather than relying on the scanner omitting links.
  store.graph = async () => graph;
  await assert.rejects(() => projectContext(store, 'synthetic-book', { sourceId: entry.id, revision: entry.hash }), { status: 403, code: 'FORBIDDEN' });
  await assert.rejects(() => projectContext(store, 'synthetic-book'), { status: 403, code: 'FORBIDDEN' });
  assert.equal(await readFile(path.join(outside, 'Source.md'), 'utf8'), 'PRIVATE outside the selected manuscript');
});
