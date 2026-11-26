/**
 * stex.frige.passages.v1: deterministic segments, approved-only scope, exact
 * citations and stale refusal, and an unchanged shared context export.
 * Synthetic book and attachments only.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { segmentExcerpt } from '../src/passages.mjs';
import { conformsTo } from './schema-check.mjs';

const SCHEMA = JSON.parse(await (await import('node:fs/promises')).readFile(new URL('../../../protocol/frige/passages.v1.schema.json', import.meta.url), 'utf8'));

const appDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha = (text) => createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');

test('segments carry exact UTF-8 byte offsets and split long paragraphs at whitespace', () => {
  const excerpt = 'Frost — 雪 on the pane.\n\n  Second paragraph 🌨 here.\n\n\n' + 'word '.repeat(400);
  const segments = segmentExcerpt(excerpt);
  const bytes = Buffer.from(excerpt, 'utf8');
  assert.equal(segments[0].text, 'Frost — 雪 on the pane.');
  assert.equal(segments[1].text, 'Second paragraph 🌨 here.');
  for (const segment of segments) {
    assert.equal(bytes.subarray(segment.start, segment.end).toString('utf8'), segment.text, 'offsets name exactly the segment bytes');
    assert.ok(segment.text.length <= 1200);
  }
  assert.ok(segments.length >= 4, 'the 2,000-character paragraph was split');
  assert.deepEqual(segmentExcerpt(excerpt), segments, 'segmentation is deterministic');
});

/** A free loopback port. */
async function freePort() {
  const server = http.createServer(); await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address(); await new Promise((resolve) => server.close(resolve)); return port;
}

test('only approved excerpt bytes are searchable and citations are re-verified', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'stex-frige-passages-'));
  const book = path.join(root, 'books', 'fixture-book');
  await mkdir(path.join(book, 'manuscript'), { recursive: true });
  await writeFile(path.join(book, 'manuscript', 'Programme.md'), '# Programme\n\n- [Morning](Morning.md)\n');
  await writeFile(path.join(book, 'manuscript', 'Morning.md'), '# Morning\n\nThe kettle sings.\n');
  const port = await freePort();
  const child = spawn(process.execPath, ['server.mjs'], { cwd: appDirectory, env: { ...process.env, STEX_FRIGE_PORT: String(port), STEX_FRIGE_BOOKS_DIR: path.join(root, 'books'), STEX_FRIGE_PROJECT_DIR: path.join(root, 'local'), STEX_FRIGE_PROJECTS_DIR: path.join(root, 'projects'), STEX_FRIGE_BASE_PATH: '/frige', STEX_FRIGE_INFERENCE_MODE: 'fake' } });
  await new Promise((resolve, reject) => { child.stdout.on('data', (chunk) => { if (String(chunk).includes('ready')) resolve(); }); child.once('exit', reject); });
  const base = `http://127.0.0.1:${port}/frige`;
  /** Calls Frige as Pantheon's proxy would. */
  const call = async (route, body) => {
    const response = await fetch(base + route, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, value: await response.json() };
  };
  try {
    const approvedText = 'Ledger of the orchard.\n\nThe frost-bound orchard keeps its counted rows — 雪.\n\nNothing else here.\n';
    const pendingText = 'The orchard is mentioned in a document nobody approved.\n';
    const uploaded = await call('/api/project/attachments?book=fixture-book', { attachments: [
      { name: 'approved.txt', contentBase64: Buffer.from(approvedText).toString('base64') },
      { name: 'pending.txt', contentBase64: Buffer.from(pendingText).toString('base64') },
    ] });
    assert.equal(uploaded.status, 201, JSON.stringify(uploaded.value));
    const records = (await call('/api/project/attachments?book=fixture-book')).value;
    const approved = records.find((record) => record.name === 'approved.txt');
    const preview = (await call(`/api/project/attachments/${approved.id}/excerpt?book=fixture-book`)).value;
    assert.equal((await call(`/api/project/attachments/${approved.id}/approve?book=fixture-book`, { hash: preview.hash })).status, 200);

    const search = await call('/api/stex/passages/v1/projects/fixture-book/search?q=orchard%20rows');
    assert.equal(search.status, 200);
    assert.equal(search.value.schemaVersion, 'stex.frige.passages.v1');
    assert.equal(search.value.passages.length, 1, 'only the approved document matches; the pending one never does');
    const [hit] = search.value.passages;
    assert.equal(hit.attachmentId, approved.id); assert.equal(hit.excerptHash, preview.hash);
    assert.equal(hit.originalSha256, sha(approvedText)); assert.equal(hit.passageSha256, sha('The frost-bound orchard keeps its counted rows — 雪.'));
    assert.ok(hit.snippet.length <= 242);
    assert.equal((await call('/api/stex/passages/v1/projects/fixture-book/search?q=nobody%20approved')).value.passages.length, 0);

    const citation = `?excerpt=${hit.excerptHash}&start=${hit.start}&end=${hit.end}&passage=${hit.passageSha256}`;
    const read = await call(`/api/stex/passages/v1/projects/fixture-book/attachments/${approved.id}${citation}`);
    assert.equal(read.status, 200); assert.equal(read.value.passage.text, 'The frost-bound orchard keeps its counted rows — 雪.');
    const shifted = await call(`/api/stex/passages/v1/projects/fixture-book/attachments/${approved.id}?excerpt=${hit.excerptHash}&start=${hit.start + 1}&end=${hit.end}&passage=${hit.passageSha256}`);
    assert.equal(shifted.status, 409); assert.equal(shifted.value.code, 'STALE_PASSAGE');
    // The published stex.frige.passages.v1 schema describes what the server actually sends.
    assert.deepEqual(conformsTo(SCHEMA, 'searchResponse', search.value), []);
    assert.deepEqual(conformsTo(SCHEMA, 'readResponse', read.value), []);
    assert.deepEqual(conformsTo(SCHEMA, 'error', shifted.value), []);
    assert.ok(conformsTo(SCHEMA, 'readResponse', { ...read.value, passage: { ...read.value.passage, start: -1 } }).length, 'the schema rejects a malformed citation');
    const pending = records.find((record) => record.name === 'pending.txt');
    const notApproved = await call(`/api/stex/passages/v1/projects/fixture-book/attachments/${pending.id}${citation}`);
    assert.equal(notApproved.status, 404); assert.deepEqual(conformsTo(SCHEMA, 'error', notApproved.value), []);
    assert.equal((await call('/api/stex/passages/v1/projects/fixture-book/search')).status, 400);
    assert.equal((await fetch(`${base}/api/stex/passages/v1/projects/fixture-book/search?q=x`, { method: 'POST' })).status, 405);

    // The shared context export is unchanged: manuscript pieces only, never attachments.
    const context = (await call('/api/stex/context/v1/projects/fixture-book')).value;
    assert.ok(context.sources.every((source) => !JSON.stringify(source).includes(approved.id)));
    assert.ok(!JSON.stringify(context).includes('orchard'));

    // A changed extraction no longer matches the approval: the passage is stale and unsearchable.
    await writeFile(path.join(book, '.texgraph', 'extractions', `${approved.id}.txt`), approvedText.replace('counted', 'uncounted'));
    assert.equal((await call(`/api/stex/passages/v1/projects/fixture-book/attachments/${approved.id}${citation}`)).status, 404);
    assert.equal((await call('/api/stex/passages/v1/projects/fixture-book/search?q=orchard')).value.passages.length, 0);
  } finally {
    child.kill(); await new Promise((resolve) => child.once('exit', resolve));
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
