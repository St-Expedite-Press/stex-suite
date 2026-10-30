import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const appDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function startLab(root, port, context) {
  const child = spawn(process.execPath, ['server.mjs'], { cwd: appDirectory, env: { ...process.env, STEX_LAB_PORT: String(port), STEX_BOOKS_DIR: root } });
  context.after(async () => { child.kill(); await rm(root, { recursive: true, force: true }); });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Lab server did not start.')), 5_000);
    child.stdout.on('data', (data) => { if (data.toString().includes('ready')) { clearTimeout(timeout); resolve(); } });
    child.on('error', reject);
  });
}

test('discovers a manuscript graph without changing it', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'stex-books-'));
  const manuscript = path.join(root, 'existing-book', 'manuscript');
  await mkdir(manuscript, { recursive: true });
  await writeFile(path.join(root, 'existing-book', 'README.md'), '# Existing Book\n\nA preserved manuscript.\n');
  await writeFile(path.join(manuscript, 'Programme.md'), '# Programme\n');
  await writeFile(path.join(manuscript, 'Poem.md'), '# A poem\n');
  await startLab(root, 4397, context);
  const response = await fetch('http://127.0.0.1:4397/api/books');
  const [book] = await response.json();
  assert.equal(response.status, 200);
  assert.equal(book.title, 'Existing Book');
  assert.equal(book.state, 'manuscript-detected');
  assert.equal(book.manuscriptNodes, 2);
  assert.equal(await readFile(path.join(manuscript, 'Poem.md'), 'utf8'), '# A poem\n');
});

test('accepts an interview ticket and creates a structured project vault', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'stex-books-'));
  await startLab(root, 4398, context);
  const ticket = { title: 'Field Notes', author: 'A. Poet', editorialIntent: 'A book of observant lyric poems.', sourceMode: 'existing-markdown', bookType: 'poetry-collection', podProfile: 'cross-pod', trimSize: '6 × 9 in', interiorInk: 'black-white', paperStock: 'white', bleed: 'no-bleed', margins: '0.5 in', isbnPlan: 'own-isbn', proofPlan: 'order-proof', coverFinish: 'matte' };
  const response = await fetch('http://127.0.0.1:4398/api/books', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ticket, transcript: [{ role: 'assistant', message: 'What is the title?' }, { role: 'user', message: 'Field Notes' }] }) });
  assert.equal(response.status, 201);
  const book = await response.json();
  const rootPath = path.join(root, book.id);
  const settings = JSON.parse(await readFile(path.join(rootPath, 'texgraph', 'settings.json'), 'utf8'));
  const markdown = await readFile(path.join(rootPath, 'texgraph', 'Global Settings Ticket.md'), 'utf8');
  assert.equal(settings.identity.title, 'Field Notes');
  assert.equal(settings.structure.programme, 'manuscript/Programme.md');
  assert.match(markdown, /# Global Settings Ticket/);
  assert.match(markdown, /\[\[\.\.\/manuscript\/Programme\|Programme\]\]/);
  assert.match(await readFile(path.join(rootPath, 'manuscript', 'Programme.md'), 'utf8'), /canonical reading sequence/);
  assert.equal((await readFile(path.join(rootPath, '.texgraph', 'interview.jsonl'), 'utf8')).split('\n').filter(Boolean).length, 2);
  const upload = await fetch(`http://127.0.0.1:4398/api/books/${book.id}/documents`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ documents: [{ name: 'context.md', mimeType: 'text/markdown', contentBase64: Buffer.from('# Context\n\nKeep this close.\n').toString('base64') }] }) });
  assert.equal(upload.status, 201);
  const [document] = await upload.json();
  assert.equal(document.contextState, 'ready');
  const manifest = await fetch(`http://127.0.0.1:4398/api/books/${book.id}/documents`);
  assert.equal((await manifest.json()).length, 1);
  await assert.rejects(() => fetch(`http://127.0.0.1:4398/api/books/${book.id}/documents`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ documents: [{ name: '../../bad.md', contentBase64: 'eA==' }] }) }).then((result) => { if (!result.ok) throw new Error('Rejected unsafe filename.'); }), /Rejected unsafe filename/);
});
