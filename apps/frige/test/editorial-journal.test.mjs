/** Revision recovery and decision tests using only disposable manuscripts. */
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ProjectStore, sourceHash } from '../src/project-store-vault.mjs';

const poem = '\uFEFF# Poem\r\n\r\n   Where the light fell\n we waited.\r\n\r\nThe river held';
const later = poem.replace('held', 'paused');
const newest = later.replace('waited.', 'listened.');

async function fixture(t) {
  const parent = path.resolve(os.tmpdir());
  const root = await mkdtemp(path.join(parent, 'stex-frige-editorial-'));
  assert.equal(path.dirname(root), parent);
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new ProjectStore(root);
  await mkdir(store.manuscriptDirectory);
  const file = store.sourcePath('Poem.md');
  await writeFile(file, poem);
  await writeFile(store.sourcePath('Prose.md'), '# Prose\n\nA separate piece.\n');
  await writeFile(store.sourcePath('Programme.md'), '# Programme\n\n- [Poem](Poem.md)\n- [Prose](Prose.md)\n');
  const { readingOrder: [id, other] } = await store.initialize();
  return { store, root, file, id, other };
}

const baseOf = ({ currentHash, currentRevisionId }) => ({ baseHash: currentHash, baseRevisionId: currentRevisionId });
const interrupted = Object.assign(new Error('Simulated process stop'), { code: 'SIMULATED_STOP' });
const refuse = () => { throw interrupted; };

test('records direct saves and restores exact snapshots as distinct author revisions', async (t) => {
  const { store, root, file, id, other } = await fixture(t);
  const empty = await store.listRevisions(id);
  assert.deepEqual(empty, { schemaVersion: 'stex.frige.editorial.v1', nodeId: id, currentHash: sourceHash(poem), currentRevisionId: null, entries: [], nextBefore: null });
  await store.updateNode(id, later, empty.currentHash);
  const reopened = new ProjectStore(root);
  await reopened.initialize();
  const initial = await reopened.listRevisions(id);
  const [saved, original] = initial.entries;
  assert.deepEqual([saved.kind, original.kind], ['save', 'baseline']);
  assert.deepEqual([saved.parentId, original.parentId], [original.id, null]);
  assert.deepEqual([saved.provenance.role, original.provenance.role], ['author', 'unattributed']);
  assert.equal(initial.currentRevisionId, saved.id);
  assert.equal(Object.hasOwn(saved, 'source'), false);
  assert.equal((await reopened.readRevision(id, original.id)).source, poem);
  await assert.rejects(reopened.readRevision(other, original.id), { code: 'REVISION_NOT_FOUND' });
  const { node, revision } = await reopened.restoreRevision(id, original.id, baseOf(initial));
  assert.equal(revision.kind, 'restore');
  assert.equal(revision.restoredFrom, original.id);
  assert.equal(revision.parentId, saved.id);
  assert.notEqual(revision.id, original.id);
  assert.equal(revision.hash, original.hash);
  assert.equal(node.source, poem);
  assert.deepEqual(await readFile(file), Buffer.from(poem));
  assert.equal((await readdir(reopened.editorial.snapshots)).length, 2, 'repeat content is stored once');
  await assert.rejects(reopened.restoreRevision(id, saved.id, { baseHash: original.hash, baseRevisionId: original.id }), { code: 'STALE_SOURCE' });
  const current = await reopened.listRevisions(id);
  assert.equal((await reopened.restoreRevision(id, original.id, baseOf(current))).revision, null);
  assert.equal((await reopened.listRevisions(id)).entries.length, 3, 'a no-op creates no revision');
});

test('one concurrent save wins and an intervening save prevents stale restore or decisions', async (t) => {
  const { store, file, id } = await fixture(t);
  const both = await Promise.allSettled([store.updateNode(id, later, sourceHash(poem)), store.updateNode(id, newest, sourceHash(poem))]);
  assert.equal(both[0].status, 'fulfilled');
  assert.equal(both[1].reason.code, 'STALE_SOURCE');
  const before = await store.listRevisions(id);
  await store.updateNode(id, newest, before.currentHash);
  await assert.rejects(store.restoreRevision(id, before.entries[1].id, baseOf(before)), { code: 'STALE_SOURCE' });
  await assert.rejects(store.recordEditorialDecision(id, { ...baseOf(before), reason: 'Outdated reading.' }), { code: 'STALE_SOURCE' });
  assert.equal((await store.listEditorialDecisions(id)).entries.length, 0);
  assert.equal(await readFile(file, 'utf8'), newest);
});

test('a verified historical snapshot can restore a preexisting source above the new-save limit', async (t) => {
  const { store, file, id } = await fixture(t);
  const long = `${poem}\r\n${'Long synthetic line.\r\n'.repeat(20_000)}`;
  await writeFile(file, long);
  await assert.rejects(store.updateNode(id, long + 'New text.', sourceHash(long)), /under 400 KB/);
  await store.updateNode(id, later, sourceHash(long));
  const history = await store.listRevisions(id);
  const original = history.entries[1];
  assert.equal(original.hash, sourceHash(long));
  await store.restoreRevision(id, original.id, baseOf(history));
  assert.deepEqual(await readFile(file), Buffer.from(long));
});

test('records why an author retains text and distinguishes an untracked source observation', async (t) => {
  const { store, file, id } = await fixture(t);
  const before = await store.listRevisions(id);
  await assert.rejects(store.recordEditorialDecision(id, { ...baseOf(before), reason: ' ' }), { code: 'INVALID_EDITORIAL_REQUEST' });
  await assert.rejects(store.recordEditorialDecision(id, { baseHash: before.currentHash, reason: 'Missing revision.' }), { code: 'INVALID_EDITORIAL_REQUEST' });
  const reason = 'Keep “held” for its sense of bearing weight.';
  const first = await store.recordEditorialDecision(id, { ...baseOf(before), reason, provenance: { role: 'igor' } });
  const baseline = await store.listRevisions(id);
  assert.equal(first.provenance.role, 'author');
  assert.equal(first.revisionId, baseline.currentRevisionId);
  assert.equal(first.reason, reason);
  assert.equal(await readFile(file, 'utf8'), poem);
  await assert.rejects(store.recordEditorialDecision(id, { ...baseOf(before), reason }), { code: 'STALE_SOURCE' });
  const repeated = await store.recordEditorialDecision(id, { ...baseOf(baseline), reason: ` ${reason} ` });
  assert.deepEqual(repeated, first, 'retrying the same reason against the same revision returns the original decision');
  await writeFile(file, later);
  const external = await store.listRevisions(id);
  assert.equal(external.currentRevisionId, null);
  assert.equal(external.entries[0].id, first.revisionId);
  const second = await store.recordEditorialDecision(id, { ...baseOf(external), reason: 'Pause at the last line.' });
  const current = await store.listRevisions(id);
  assert.equal(current.entries[0].kind, 'observed');
  assert.equal(current.entries[0].parentId, first.revisionId);
  assert.deepEqual((await store.listEditorialDecisions(id, first.id)).entries, []);
  assert.deepEqual((await store.listEditorialDecisions(id)).entries.map((item) => item.id), [second.id, first.id]);
  assert.equal(await readFile(file, 'utf8'), later);
});

test('recovers a durable intent before and after the canonical write and preserves outside edits', async (t) => {
  for (const mode of ['before', 'after', 'outside']) {
    await t.test(mode, async (context) => {
      const { store, root, file, id } = await fixture(context);
      if (mode === 'before') {
        const prepare = store.editorial.prepare.bind(store.editorial);
        store.editorial.prepare = async (...args) => { await prepare(...args); refuse(); };
      } else {
        store.editorial.settle = refuse;
      }
      await assert.rejects(store.updateNode(id, later, sourceHash(poem)), { code: 'SIMULATED_STOP' });
      const pending = JSON.parse(await readFile(store.editorial.file, 'utf8')).pending;
      assert.equal(pending.event.hash, sourceHash(later));
      assert.equal(await readFile(file, 'utf8'), mode === 'before' ? poem : later);
      if (mode === 'outside') await writeFile(file, newest);
      const reopened = new ProjectStore(root);
      await reopened.initialize();
      const result = await reopened.listRevisions(id);
      assert.equal(result.entries.some((entry) => entry.id === pending.event.id), mode === 'after');
      assert.equal(result.currentRevisionId === null, mode === 'outside');
      assert.equal((await reopened.listRevisions(id)).entries.length, result.entries.length, 'settles once');
      assert.equal(JSON.parse(await readFile(store.editorial.file, 'utf8')).pending, null);
      assert.equal(await readFile(file, 'utf8'), mode === 'before' ? poem : mode === 'after' ? later : newest);
    });
  }
});

test('a prior journal intent is reconciled before a legacy proposal can advance the piece', async (t) => {
  const { store, id } = await fixture(t);
  const settle = store.editorial.settle.bind(store.editorial);
  store.editorial.settle = refuse;
  await assert.rejects(store.updateNode(id, later, sourceHash(poem)), { code: 'SIMULATED_STOP' });
  store.editorial.settle = settle;
  const { sources } = await store.scopeContext(id);
  const { changeSet } = await store.createChangeSet(id, { changes: [{ nodeId: id, source: newest }] }, sources);
  const decided = await store.decideChanges(id, changeSet.id, { decision: 'accept' });
  assert.equal(decided.changes[0].status, 'accepted');
  const revision = await store.listRevisions(id);
  assert.equal(revision.entries[0].hash, sourceHash(later));
  assert.equal(revision.currentRevisionId, null, 'the legacy proposal stays outside this journal increment');
});

test('an unsettled legacy acceptance cannot undo a later intentional restore of matching bytes', async (t) => {
  const { store, root, file, id } = await fixture(t);
  await store.updateNode(id, later, sourceHash(poem));
  const historical = (await store.listRevisions(id)).entries[0];
  await store.updateNode(id, poem, sourceHash(later));
  const { sources } = await store.scopeContext(id);
  const { changeSet } = await store.createChangeSet(id, { changes: [{ nodeId: id, edits: [{ find: 'held', replace: 'paused' }] }] }, sources);
  const read = store.node.bind(store);
  store.node = async (nodeId) => {
    if (nodeId === id && (await readFile(file, 'utf8')) === later) throw Object.assign(new Error('Simulated read lock after the proposal write.'), { code: 'EBUSY' });
    return read(nodeId);
  };
  try {
    const ambiguous = await store.decideChanges(id, changeSet.id, { decision: 'accept' });
    assert.ok(ambiguous.applying);
  } finally {
    store.node = read;
  }
  assert.equal(await readFile(file, 'utf8'), later);
  await store.updateNode(id, newest, sourceHash(poem));
  assert.equal((await store.contract(changeSet.id)).applying, undefined);
  const current = await store.listRevisions(id);
  const { revision } = await store.restoreRevision(id, historical.id, baseOf(current));
  assert.equal(revision.restoredFrom, historical.id);
  const reopened = new ProjectStore(root);
  await reopened.initialize();
  assert.deepEqual(await readFile(file), Buffer.from(later));
  assert.equal((await reopened.listRevisions(id)).currentRevisionId, revision.id);
});

test('a damaged snapshot or journal fails closed and leaves source bytes in place', async (t) => {
  const { store, file, id } = await fixture(t);
  await store.updateNode(id, later, sourceHash(poem));
  const listing = await store.listRevisions(id);
  const original = listing.entries[1];
  await writeFile(path.join(store.editorial.snapshots, `${original.hash}.md`), 'Damaged snapshot');
  await assert.rejects(store.restoreRevision(id, original.id, baseOf(listing)), { code: 'EDITORIAL_UNAVAILABLE' });
  assert.equal(await readFile(file, 'utf8'), later);
  await writeFile(store.editorial.file, '{');
  await assert.rejects(store.updateNode(id, newest, sourceHash(later)), { code: 'EDITORIAL_UNAVAILABLE' });
  assert.equal(await readFile(store.editorial.file, 'utf8'), '{');
  assert.equal(await readFile(file, 'utf8'), later);
});

test('invalid UTF-8 in an editorial decision fails closed without normalizing the journal', async (t) => {
  const { store, file, id } = await fixture(t);
  const initial = await store.listRevisions(id);
  await store.recordEditorialDecision(id, { ...baseOf(initial), reason: 'Synthetic reason.' });
  const bytes = await readFile(store.editorial.file);
  bytes[bytes.indexOf(Buffer.from('Synthetic reason.'))] = 0xff;
  await writeFile(store.editorial.file, bytes);
  await assert.rejects(store.listEditorialDecisions(id), { code: 'EDITORIAL_UNAVAILABLE' });
  await assert.rejects(store.updateNode(id, later, sourceHash(poem)), { code: 'EDITORIAL_UNAVAILABLE' });
  assert.deepEqual(await readFile(store.editorial.file), bytes);
  assert.deepEqual(await readFile(file), Buffer.from(poem));
});

test('linked snapshot directories cannot be used to read or restore historical source', async (t) => {
  const { store, root, file, id } = await fixture(t);
  await store.updateNode(id, later, sourceHash(poem));
  const listing = await store.listRevisions(id);
  const earlier = listing.entries[1].id;
  const destination = path.join(root, 'backed-up-snapshots');
  assert.equal(path.relative(root, store.editorial.snapshots), path.join('.texgraph', 'editorial', 'snapshots'));
  assert.equal(path.dirname(destination), root);
  await rename(store.editorial.snapshots, destination);
  await symlink(destination, store.editorial.snapshots, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(store.readRevision(id, earlier), { code: 'EDITORIAL_UNAVAILABLE' });
  await assert.rejects(store.restoreRevision(id, earlier, baseOf(listing)), { code: 'EDITORIAL_UNAVAILABLE' });
  assert.deepEqual(await readFile(file), Buffer.from(later));
});
