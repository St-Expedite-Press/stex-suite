/** Per-person knowledge library tests (D-028): isolation, legacy root journal, bounded cache and per-user failure. Disposable fixtures only. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import { openKnowledgeLibrary, personDirectoryName } from '../src/library.mjs';
import { openKnowledge } from '../src/projections.mjs';

const project = { application: 'frige', id: 'test-book', reference: 'stex://frige/project/test-book', title: 'Synthetic book' };
const sha = (text) => createHash('sha256').update(text).digest('hex');
const directories = [];
after(() => Promise.all(directories.map((directory) => rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))));
/** Allocates a temporary fixture directory. */
async function temporary() { const directory = await mkdtemp(path.join(os.tmpdir(), 'stex-library-')); directories.push(directory); return directory; }
/** A valid engine revision event. */
const event = (sequence = 1) => ({ id: `revision-${sequence}`, sequence, occurredAt: '2026-11-07T18:00:00.000Z', project, sources: [{ id: 'node-one', reference: `${project.reference}#source=node-one`, title: 'One', revision: sha('r'), bytes: 1, mediaType: 'text/markdown' }] });
/** Accepts the fixture event into a journal. */
const accept = (journal, key) => journal.accept({ idempotencyKey: key, expectedVersion: journal.view().version, event: event() });
/** Runs fn with a leased journal and releases it. */
async function using(library, user, fn) { const lease = await library.lease(user); try { return await fn(lease.knowledge); } finally { lease.release(); } }
const sources = (library, user) => using(library, user, (journal) => journal.view().knowledge.sources.length);

test('each hosted person gets their own journal directory; one cannot read, export or erase another journal', async () => {
  const directory = await temporary(); const library = await openKnowledgeLibrary({ directory, hosted: true });
  await using(library, 'alice', (journal) => accept(journal, 'alice-accept-1'));
  assert.equal(await sources(library, 'alice'), 1);
  assert.equal(await sources(library, 'bob'), 0);
  assert.equal(await using(library, 'bob', (journal) => journal.export().journal.events.length), 0);
  await using(library, 'bob', (journal) => journal.erase({ confirmation: 'delete-knowledge', expectedVersion: journal.view().version }));
  assert.equal(await sources(library, 'alice'), 1);
  assert.equal(await sources(library, 'Alice'), 0, 'usernames compare exactly');
  assert.deepEqual((await readdir(path.join(directory, 'people'))).sort(), ['alice', 'bob', 'Alice'].map(personDirectoryName).sort());
  assert.match(personDirectoryName('alice'), /^[a-f0-9]{32}$/);
  assert.equal(personDirectoryName('alice'), createHash('sha256').update('alice').digest('hex').slice(0, 32));
  await library.close();
  // Closed: locks released, so a fresh library can reopen alice's data.
  const again = await openKnowledgeLibrary({ directory, hosted: true });
  assert.equal(await sources(again, 'alice'), 1); await again.close();
});

test('hosted requests without a user are refused, and a disabled library never creates a directory', async () => {
  const directory = await temporary(); const library = await openKnowledgeLibrary({ directory, hosted: true });
  await assert.rejects(() => library.lease(null), (error) => error.status === 401);
  await assert.rejects(() => library.lease(''), (error) => error.status === 401);
  await library.close();
  await assert.rejects(() => library.lease('alice'), (error) => error.code === 'KNOWLEDGE_CLOSED');
  const disabled = await openKnowledgeLibrary({ directory: '', hosted: true });
  assert.equal((await disabled.lease('alice')).knowledge.enabled, false);
});

test('a username with an unpaired surrogate has a separate journal from the replacement character', async (context) => {
  const directory = await temporary();
  const library = await openKnowledgeLibrary({ directory, hosted: true });
  context.after(() => library.close());

  const unpaired = 'member-\ud800';
  const replacement = 'member-\ufffd';
  assert.notEqual(personDirectoryName(unpaired), personDirectoryName(replacement));
  await using(library, unpaired, (journal) => accept(journal, 'unpaired-accept-1'));
  assert.equal(await sources(library, replacement), 0);
  assert.equal(await sources(library, unpaired), 1);
});

test('local mode uses the existing journal in place, whatever the user', async () => {
  const directory = await temporary();
  const first = await openKnowledge({ directory }); await accept(first, 'local-accept-1'); await first.close();
  const before = await readFile(path.join(directory, 'knowledge.v1.json'), 'utf8');
  const library = await openKnowledgeLibrary({ directory, hosted: false });
  assert.equal(await sources(library, null), 1); assert.equal(await sources(library, 'anyone'), 1);
  assert.equal(await library.legacyState(), 'none');
  await library.close();
  assert.equal(await readFile(path.join(directory, 'knowledge.v1.json'), 'utf8'), before);
  await assert.rejects(readdir(path.join(directory, 'people')), { code: 'ENOENT' });
});

test('the hosted root journal is untouched, unassigned by default and reached only by the named legacy owner', async () => {
  const directory = await temporary();
  const original = await openKnowledge({ directory }); await accept(original, 'legacy-accept-1'); await original.close();
  const bytes = await readFile(path.join(directory, 'knowledge.v1.json'), 'utf8');

  const unassigned = await openKnowledgeLibrary({ directory, hosted: true });
  assert.equal(await unassigned.legacyState(), 'unassigned');
  assert.equal(await sources(unassigned, 'alice'), 0, 'nobody reaches it');
  await unassigned.close();
  assert.equal(await readFile(path.join(directory, 'knowledge.v1.json'), 'utf8'), bytes, 'never rewritten');

  const assigned = await openKnowledgeLibrary({ directory, hosted: true, legacyOwner: 'alice' });
  assert.equal(await assigned.legacyState(), 'assigned');
  assert.equal(await sources(assigned, 'alice'), 1);
  assert.equal(await sources(assigned, 'bob'), 0);
  await assigned.close();

  // Igor reports usernames lower-cased and trimmed, so a configured ` Alice ` still names alice.
  const cased = await openKnowledgeLibrary({ directory, hosted: true, legacyOwner: ' Alice ' });
  assert.equal(await sources(cased, 'alice'), 1);
  await cased.close();
  assert.equal(await readFile(path.join(directory, 'knowledge.v1.json'), 'utf8'), bytes, 'still never rewritten');

  const fresh = await temporary(); const empty = await openKnowledgeLibrary({ directory: fresh, hosted: true });
  assert.equal(await empty.legacyState(), 'none'); await empty.close();
});

test('a journal that cannot open fails closed for that person only and recovers when fixed', async () => {
  const directory = await temporary(); const library = await openKnowledgeLibrary({ directory, hosted: true });
  const corrupt = path.join(directory, 'people', personDirectoryName('mallory'));
  await mkdir(corrupt, { recursive: true }); await writeFile(path.join(corrupt, 'knowledge.v1.json'), '{ not json');
  await assert.rejects(() => library.lease('mallory'), (error) => error.status === 503);
  assert.equal(await sources(library, 'alice'), 0, 'others are unaffected');
  assert.equal(library.openCount(), 1, 'the failure is not cached');
  assert.equal(await readFile(path.join(corrupt, 'knowledge.v1.json'), 'utf8'), '{ not json', 'the damaged journal is preserved');
  // A lock held by a live process (this one) also fails closed for that user alone.
  const locked = path.join(directory, 'people', personDirectoryName('locked'));
  await mkdir(locked, { recursive: true }); await writeFile(path.join(locked, 'knowledge.lock'), JSON.stringify({ pid: process.pid, nonce: 'other' }));
  await assert.rejects(() => library.lease('locked'), (error) => error.code === 'KNOWLEDGE_LOCKED');
  assert.equal(await sources(library, 'bob'), 0);
  await rm(path.join(corrupt, 'knowledge.v1.json')); assert.equal(await sources(library, 'mallory'), 0, 'recovers once repaired');
  await library.close();
});

test('the open-journal cache is bounded; eviction releases the lock and busy journals are never evicted', async () => {
  const directory = await temporary(); const library = await openKnowledgeLibrary({ directory, hosted: true, limit: 2 });
  for (const user of ['u1', 'u2', 'u3']) await sources(library, user);
  assert.equal(library.openCount(), 2);
  const evicted = path.join(directory, 'people', personDirectoryName('u1'));
  await assert.rejects(readFile(path.join(evicted, 'knowledge.lock')), { code: 'ENOENT' }, 'closing released the evicted lock');
  await readFile(path.join(directory, 'people', personDirectoryName('u3'), 'knowledge.lock'));
  // Both slots leased: a third person is told to retry rather than evicting a journal in use.
  const a = await library.lease('u2'); const b = await library.lease('u3');
  await assert.rejects(() => library.lease('u4'), (error) => error.code === 'KNOWLEDGE_BUSY');
  a.release(); b.release();
  assert.equal(await sources(library, 'u4'), 0);
  assert.equal(library.openCount(), 2);
  await library.close();
  await assert.rejects(() => openKnowledgeLibrary({ directory, hosted: true, limit: 0 }), /positive integer/);
});
