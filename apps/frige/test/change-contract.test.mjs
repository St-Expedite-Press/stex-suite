/**
 * Change contracts (`stex.frige.change-contract.v1`): the record a proposal is
 * stored as, its history, and the rollback of an accepted change.
 *
 * Every test builds a synthetic book in a temporary directory. No test reads
 * or writes a real manuscript.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ProjectStore, sourceHash } from '../src/project-store-vault.mjs';
import { buildBook } from '../src/book-assembler.mjs';
import { CHANGE_CONTRACT, MAX_EDITS_PER_CHANGE, applyEdits, changedOnlyWithin, conflictsWith, isContractId, lineStats, proofFor, resolvePassage } from '../src/change-contract.mjs';
import { designHash } from '../src/design-settings.mjs';

const hasLuaLaTeX = spawnSync('lualatex', ['--version'], { windowsHide: true }).status === 0;

const FIRST = '# First\n\nOne line,\n  one indented — with Unicode.\n';
const SECOND = '# Second\n\nTwo.\n';

/**
 * A two-section synthetic book: `01/First.md` then `02/Second.md`.
 *
 * @param {import('node:test').TestContext} context  Removes the book when the test ends.
 * @returns {Promise<{ root: string, store: ProjectStore, first: string, second: string, firstFile: string }>}
 *   `first` and `second` are node ids; `firstFile` is the path of the first piece.
 */
async function syntheticBook(context) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'frige-contract-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'manuscript', '01'), { recursive: true });
  await mkdir(path.join(root, 'manuscript', '02'), { recursive: true });
  await writeFile(path.join(root, 'manuscript', 'Programme.md'), '# Programme\n\n- [First](01/First.md)\n- [Second](02/Second.md)\n');
  const firstFile = path.join(root, 'manuscript', '01', 'First.md');
  await writeFile(firstFile, FIRST);
  await writeFile(path.join(root, 'manuscript', '02', 'Second.md'), SECOND);
  const store = new ProjectStore(root);
  const graph = await store.initialize();
  const [first, second] = graph.readingOrder;
  return { root, store, first, second, firstFile };
}

/**
 * Proposes one replacement of the first piece in its own conversation.
 *
 * @param {ProjectStore} store
 * @param {string} nodeId
 * @param {string} source  The proposed text.
 * @param {object} [provenance]
 */
async function propose(store, nodeId, source, provenance = {}) {
  const { sources } = await store.scopeContext(nodeId);
  const { changeSet } = await store.createChangeSet(nodeId, { commentary: 'A synthetic reason.', changes: [{ nodeId, source, summary: 'A synthetic change.' }] }, sources, provenance);
  return changeSet;
}

const pause = () => new Promise((resolve) => setTimeout(resolve, 5));

test('line statistics count added and removed lines and ignore a trailing newline', () => {
  assert.deepEqual(lineStats('a\nb\n', 'a\nb\nc\n'), { before: 2, after: 3, added: 1, removed: 0 });
  assert.deepEqual(lineStats('a\nb\n', 'a\n'), { before: 2, after: 1, added: 0, removed: 1 });
  assert.deepEqual(lineStats('a\r\nb\r\n', 'a\nB\n'), { before: 2, after: 2, added: 1, removed: 1 }, 'line endings alone are not a difference');
  assert.deepEqual(lineStats('', 'a\n'), { before: 0, after: 1, added: 1, removed: 0 });
  assert.deepEqual(lineStats('x\n\nx\n', 'x\n'), { before: 3, after: 1, added: 0, removed: 2 }, 'repeated lines are counted, not collapsed');
});

test('contract ids are checked before they can name a file', () => {
  assert.equal(isContractId(randomUUID()), true);
  for (const value of ['', '../escape', 'not-a-uuid', '00000000-0000-0000-0000-00000000000g', null, 42]) assert.equal(isContractId(value), false, String(value));
});

test('a build proves a contract only when it typeset every accepted change at its accepted text', () => {
  const record = { changes: [{ nodeId: 'node-a', status: 'accepted', afterHash: 'h1' }, { nodeId: 'node-b', status: 'rejected', afterHash: 'h2' }] };
  const build = { ok: true, completedAt: '2026-01-01T00:00:00.000Z', targetScope: { id: 'book' }, sourceHashes: { 'node-a': 'h1' }, pageMap: { mode: 'prefix', designHash: 'd', pagination: { verified: true } } };
  assert.deepEqual(proofFor(record, build), { completedAt: build.completedAt, scopeId: 'book', mode: 'prefix', paginationVerified: true, designHash: 'd', sourceHashes: { 'node-a': 'h1' } });
  assert.equal(proofFor(record, { ...build, ok: false }), null, 'a failed build proves nothing');
  assert.equal(proofFor(record, { ...build, sourceHashes: { 'node-a': 'other' } }), null, 'a build of different text proves nothing');
  assert.equal(proofFor(record, { ...build, sourceHashes: {} }), null, 'a build that left the piece out proves nothing');
  assert.equal(proofFor({ changes: [{ nodeId: 'node-a', status: 'pending', afterHash: 'h1' }] }, build), null, 'nothing accepted, nothing proved');
  assert.equal(proofFor(record, { ...build, pageMap: { pagination: { verified: false } } }).paginationVerified, false, 'an unverified page map is recorded as unverified');
});

test('a layout proof needs every affected piece still in the book, typeset under the resulting profile', () => {
  const record = { changes: [{ kind: 'set-layout', status: 'accepted', afterHash: 'profile-after', pieces: ['node-a', 'node-b'] }] };
  const build = (sourceHashes, designHash = 'profile-after') => ({ ok: true, completedAt: '2026-01-01T00:00:00.000Z', targetScope: { id: 'book' }, sourceHashes, pageMap: { mode: 'prefix', designHash, pagination: { verified: true } } });
  assert.equal(proofFor(record, build({ 'node-a': 'x' })), null, 'one of the two pieces is not enough');
  assert.equal(proofFor(record, build({ 'node-a': 'x', 'node-b': 'y' }, 'profile-before')), null, 'the right pieces under another profile prove nothing');
  assert.deepEqual(proofFor(record, build({ 'node-a': 'x', 'node-b': 'y' })).sourceHashes, {}, 'a layout proof records no text hashes');
  assert.ok(proofFor(record, build({ 'node-a': 'x' }), { readingOrder: ['node-a', 'node-c'] }), 'a piece that has left the book no longer has to be typeset');
  assert.equal(proofFor(record, build({}), { readingOrder: ['node-c'] }), null, 'with every piece gone, nothing can prove it');
});

test('conflicts name undecided changes to the same piece in other conversations only', () => {
  const records = [
    { id: 'c1', scopeId: 'scope-x', changes: [{ nodeId: 'node-a', status: 'pending' }, { nodeId: 'node-b', status: 'accepted' }] },
    { id: 'c2', scopeId: 'node-a', changes: [{ nodeId: 'node-a', status: 'pending' }] },
  ];
  assert.deepEqual(conflictsWith(records, [{ nodeId: 'node-a' }, { nodeId: 'node-b' }], 'node-a'), [{ contractId: 'c1', scopeId: 'scope-x', nodeId: 'node-a', target: 'node-a' }]);
  // A layout change conflicts only with another layout change to the same target, never with text.
  const layout = [{ id: 'c3', scopeId: 'scope-y', changes: [{ kind: 'set-layout', level: 'section', target: '01_A', nodeId: null, status: 'pending' }] }];
  assert.deepEqual(conflictsWith(layout, [{ kind: 'set-layout', level: 'section', target: '01_A' }], 'node-a'), [{ contractId: 'c3', scopeId: 'scope-y', nodeId: null, target: 'layout:section:01_A' }]);
  assert.deepEqual(conflictsWith(layout, [{ nodeId: '01_A' }], 'node-a'), []);
});

test('a proposal is stored as a contract with provenance and writes nothing', async (context) => {
  const { root, store, first, firstFile } = await syntheticBook(context);
  const before = await store.node(first);
  const proposed = `${FIRST}\nA proposed line.\n`;
  const contract = await propose(store, first, proposed, {
    request: 'Add a closing line.', userTurnId: 'turn-1', model: 'stex/test', transport: 'fake',
    withheld: [{ nodeId: 'node-withheld-000000', title: 'Too long' }], references: [{ id: 'ref-1', name: 'Notes.md' }], designHash: 'design-1',
  });

  assert.equal(contract.contract, CHANGE_CONTRACT); assert.equal(contract.schemaVersion, 3); assert.equal(contract.status, 'pending');
  assert.deepEqual(contract.scope, { id: first, kind: 'node', title: 'First' });
  assert.equal(contract.request, 'Add a closing line.'); assert.equal(contract.commentary, 'A synthetic reason.');
  assert.deepEqual(contract.origin, { userTurnId: 'turn-1', model: 'stex/test', transport: 'fake' });
  // Each kind of context keeps its own category; nothing is merged into one authority.
  assert.deepEqual(contract.context.offered, [{ nodeId: first, relativePath: '01/First.md', hash: before.hash, category: 'canonical-source' }]);
  assert.deepEqual(contract.context.references, [{ id: 'ref-1', name: 'Notes.md', category: 'approved-reference' }]);
  assert.deepEqual(contract.context.withheld, [{ nodeId: 'node-withheld-000000', title: 'Too long' }]);
  assert.equal(contract.context.designHash, 'design-1');
  const [change] = contract.changes;
  assert.equal(change.kind, 'replace-node-source'); assert.equal(change.before, FIRST); assert.equal(change.source, proposed);
  assert.equal(change.baseHash, before.hash); assert.equal(change.afterHash, sourceHash(proposed));
  assert.deepEqual(change.lines, { before: 4, after: 6, added: 2, removed: 0 });
  assert.equal(contract.effects[0].code, 'proof-stale'); assert.deepEqual(contract.conflicts, []);
  assert.deepEqual(contract.approval, { required: 'author', granularity: 'per-change' });
  assert.deepEqual(contract.rollback, { strategy: 'restore-before', requires: 'current-hash-equals-after-hash' });
  assert.equal(contract.proof, null);

  assert.equal(await readFile(firstFile, 'utf8'), FIRST, 'a pending contract changes nothing');
  // The per-scope file only points at the contract; the contract file is the record.
  assert.deepEqual(JSON.parse(await readFile(path.join(root, '.texgraph', 'proposals', `${first}.json`), 'utf8')), { schemaVersion: 3, contractId: contract.id });
  assert.deepEqual(await store.changeSet(first), contract);
  assert.deepEqual(await store.contract(contract.id), contract);
});

test('a newer proposal supersedes an undecided one, which stays readable in the history', async (context) => {
  const { store, first } = await syntheticBook(context);
  const earlier = await propose(store, first, `${FIRST}\nEarlier.\n`);
  await pause();
  const later = await propose(store, first, `${FIRST}\nLater.\n`);

  const kept = await store.contract(earlier.id);
  assert.equal(kept.status, 'resolved'); assert.equal(kept.changes[0].status, 'superseded'); assert.equal(kept.changes[0].supersededBy, later.id);
  assert.equal(kept.changes[0].source, `${FIRST}\nEarlier.\n`, 'the superseded text is not erased');
  assert.equal((await store.changeSet(first)).id, later.id);
  await assert.rejects(() => store.decideChanges(first, earlier.id, { decision: 'accept' }), /no longer current/);
  const note = (await store.turns(first)).at(-1);
  assert.equal(note.kind, 'changes-decided'); assert.equal(note.changeSetId, earlier.id); assert.equal(note.decisions[0].status, 'superseded');

  const history = await store.contracts({ scopeId: first });
  assert.deepEqual(history.map((entry) => entry.id), [later.id, earlier.id], 'newest first');
  for (const entry of history) for (const change of entry.changes) { assert.equal('before' in change, false); assert.equal('source' in change, false); }
  assert.deepEqual((await store.contracts({ nodeId: first })).map((entry) => entry.id), [later.id, earlier.id]);
  await assert.rejects(() => store.contracts({ scopeId: '../escape' }), /Invalid graph node id/);
});

test('rejecting a contract leaves the manuscript byte-identical and records the decision', async (context) => {
  const { store, first, firstFile } = await syntheticBook(context);
  const bytes = await readFile(firstFile);
  const contract = await propose(store, first, `${FIRST}\nRejected.\n`);
  const decided = await store.decideChanges(first, contract.id, { decision: 'reject' });
  assert.equal(decided.status, 'resolved'); assert.equal(decided.changes[0].status, 'rejected');
  assert.ok((await readFile(firstFile)).equals(bytes));
  assert.equal((await store.contract(contract.id)).changes[0].status, 'rejected');
  await assert.rejects(() => store.revertChanges(contract.id), { code: 'NOTHING_TO_REVERT' });
});

test('rolling back an accepted change restores the exact prior bytes, hash and identity', async (context) => {
  const { store, first, firstFile } = await syntheticBook(context);
  const original = await readFile(firstFile); const before = await store.node(first);
  const contract = await propose(store, first, `${FIRST}\nAccepted.\n`);
  const scope = await store.scope(first);
  const buildOf = (hash) => ({ ok: true, targetScope: scope, sourceHashes: { [first]: hash }, pageMap: { schemaVersion: 3, mode: 'prefix', pagination: { verified: true } }, log: '' });

  assert.deepEqual((await store.recordBuild(buildOf(contract.changes[0].afterHash))).provedContracts, [], 'a pending contract has nothing to prove');
  await store.decideChanges(first, contract.id, { decision: 'accept' });
  assert.match(await readFile(firstFile, 'utf8'), /Accepted\./);
  assert.deepEqual((await store.recordBuild(buildOf(before.hash))).provedContracts, [], 'a build of the earlier text does not prove the contract');
  const build = await store.recordBuild(buildOf(contract.changes[0].afterHash));
  assert.deepEqual(build.provedContracts, [contract.id]);
  const proved = await store.contract(contract.id);
  assert.equal(proved.proof.completedAt, build.completedAt); assert.equal(proved.proof.paginationVerified, true);
  assert.deepEqual(proved.proof.sourceHashes, { [first]: contract.changes[0].afterHash });

  const reverted = await store.revertChanges(contract.id);
  assert.equal(reverted.changes[0].status, 'reverted'); assert.ok(reverted.changes[0].revertedAt); assert.equal(reverted.proof, null);
  assert.ok((await readFile(firstFile)).equals(original), 'the prior bytes are restored exactly');
  const after = await store.node(first);
  assert.equal(after.id, first, 'the piece keeps its identity'); assert.equal(after.hash, before.hash);
  const note = (await store.turns(first)).at(-1);
  assert.equal(note.kind, 'changes-reverted'); assert.deepEqual(note.decisions.map((entry) => entry.status), ['reverted']);
  await assert.rejects(() => store.revertChanges(contract.id), { code: 'NOTHING_TO_REVERT' });
});

test('a rollback is refused, and writes nothing, when the piece changed after acceptance', async (context) => {
  const { store, first, firstFile } = await syntheticBook(context);
  const contract = await propose(store, first, `${FIRST}\nAccepted.\n`);
  await store.decideChanges(first, contract.id, { decision: 'accept' });
  const accepted = await store.node(first);
  const byHand = `${FIRST}\nAccepted.\n\nEdited by hand afterwards.\n`;
  await store.updateNode(first, byHand, accepted.hash);

  await assert.rejects(() => store.revertChanges(contract.id), { code: 'STALE_SOURCE' });
  assert.equal(await readFile(firstFile, 'utf8'), byHand, 'the later edit is not overwritten');
  assert.equal((await store.contract(contract.id)).changes[0].status, 'accepted', 'the contract still records what happened');
  await assert.rejects(() => store.revertChanges(randomUUID()), { code: 'CONTRACT_NOT_FOUND' });
  await assert.rejects(() => store.revertChanges('../../manuscript/01/First'), { code: 'CONTRACT_NOT_FOUND' });
});

test('a save without a base hash is refused', async (context) => {
  const { store, first, firstFile } = await syntheticBook(context);
  for (const baseHash of [undefined, null, '']) await assert.rejects(() => store.updateNode(first, 'Overwritten.\n', baseHash), { code: 'BASE_HASH_REQUIRED' });
  assert.equal(await readFile(firstFile, 'utf8'), FIRST);
});

test('a contract records undecided changes to the same piece from another conversation', async (context) => {
  const { store, first } = await syntheticBook(context);
  const graph = await store.graph();
  const section = graph.book.sections.find((entry) => entry.nodeIds.includes(first));
  const inPiece = await propose(store, first, `${FIRST}\nFrom the piece conversation.\n`);
  const { sources } = await store.scopeContext(section.id);
  const { changeSet: inSection } = await store.createChangeSet(section.id, { changes: [{ nodeId: first, source: `${FIRST}\nFrom the section conversation.\n` }] }, sources);
  assert.deepEqual(inSection.conflicts, [{ contractId: inPiece.id, scopeId: first, nodeId: first, target: first }]);
  assert.equal((await store.contract(inPiece.id)).changes[0].status, 'pending', 'another conversation does not supersede this one');
  // Whichever is accepted first makes the other stale; neither overwrites.
  await store.decideChanges(section.id, inSection.id, { decision: 'accept' });
  const late = await store.decideChanges(first, inPiece.id, { decision: 'accept' });
  assert.equal(late.changes[0].status, 'stale');
  assert.match((await store.node(first)).source, /From the section conversation/);
});

test('a change set from before contracts is still decidable and joins the history when decided', async (context) => {
  const { root, store, first, firstFile } = await syntheticBook(context);
  const node = await store.node(first); const source = `${FIRST}\nFrom an older change set.\n`;
  const legacy = { schemaVersion: 2, id: randomUUID(), scopeId: first, createdAt: '2026-01-01T00:00:00.000Z', commentary: '', status: 'pending', dropped: [], changes: [{ nodeId: first, relativePath: '01/First.md', title: 'First', baseHash: node.hash, afterHash: sourceHash(source), before: FIRST, source, summary: '', status: 'pending' }] };
  const pointerFile = path.join(root, '.texgraph', 'proposals', `${first}.json`);
  await writeFile(pointerFile, JSON.stringify(legacy));

  assert.equal((await store.changeSet(first)).id, legacy.id);
  assert.deepEqual(await store.contracts(), [], 'it is not in the history until it is decided');
  await store.decideChanges(first, legacy.id, { decision: 'accept' });
  assert.equal(await readFile(firstFile, 'utf8'), source);
  assert.deepEqual(JSON.parse(await readFile(pointerFile, 'utf8')), { schemaVersion: 3, contractId: legacy.id });
  const [listed] = await store.contracts();
  assert.equal(listed.id, legacy.id); assert.equal(listed.schemaVersion, 2); assert.equal(listed.changes[0].status, 'accepted');
  await store.revertChanges(legacy.id);
  assert.equal(await readFile(firstFile, 'utf8'), FIRST);
});

test('a damaged contract file does not hide the rest of the history', async (context) => {
  const { root, store, first } = await syntheticBook(context);
  const contract = await propose(store, first, `${FIRST}\nKept.\n`);
  await writeFile(path.join(root, '.texgraph', 'contracts', `${randomUUID()}.json`), '{ not json');
  assert.deepEqual((await store.contracts()).map((entry) => entry.id), [contract.id]);
});

test('a real LuaLaTeX proof of an accepted change is recorded on its contract', { skip: !hasLuaLaTeX && 'lualatex is not on PATH' }, async (context) => {
  const { store, first } = await syntheticBook(context);
  const contract = await propose(store, first, `${FIRST}\nTypeset after acceptance.\n`);
  await store.decideChanges(first, contract.id, { decision: 'accept' });
  const build = await store.recordBuild(await buildBook(store, { scopeId: first, mode: 'prefix' }));
  assert.equal(build.ok, true, build.error || build.log);
  assert.deepEqual(build.provedContracts, [contract.id]);
  const { proof } = await store.contract(contract.id);
  assert.equal(proof.paginationVerified, true); assert.equal(proof.mode, 'prefix'); assert.equal(proof.scopeId, first);
});

// --- Findings of the independent review (2026-11-13) --------------------------

/**
 * Proposes one change to each of the two pieces in the whole-section scope
 * that holds the first piece, after moving both pieces into one section.
 *
 * @param {import('node:test').TestContext} context
 */
async function twoPieceContract(context) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'frige-contract-pair-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'manuscript', '01'), { recursive: true });
  await writeFile(path.join(root, 'manuscript', 'Programme.md'), '# Programme\n\n- [First](01/First.md)\n- [Second](01/Second.md)\n');
  await writeFile(path.join(root, 'manuscript', '01', 'First.md'), FIRST);
  await writeFile(path.join(root, 'manuscript', '01', 'Second.md'), SECOND);
  const store = new ProjectStore(root);
  const graph = await store.initialize();
  const [first, second] = graph.readingOrder; const section = graph.book.sections[0];
  const { sources } = await store.scopeContext(section.id);
  const { changeSet } = await store.createChangeSet(section.id, { changes: [{ nodeId: first, source: `${FIRST}\nFirst revised.\n` }, { nodeId: second, source: `${SECOND}\nSecond revised.\n` }] }, sources);
  return { root, store, first, second, section, contract: changeSet };
}

const buildRecord = (scope, sourceHashes, pageMap = { schemaVersion: 3, mode: 'prefix', pagination: { verified: true } }) => ({ ok: true, targetScope: scope, sourceHashes, pageMap, log: '' });

test('a proof recorded before a further piece is accepted is cleared, not kept for the new piece', async (context) => {
  const { store, first, second, section, contract } = await twoPieceContract(context);
  const [changeFirst, changeSecond] = contract.changes;
  await store.decideChanges(section.id, contract.id, { nodeId: first, decision: 'accept' });
  const partial = await store.recordBuild(buildRecord(section, { [first]: changeFirst.afterHash, [second]: changeSecond.baseHash }));
  assert.deepEqual(partial.provedContracts, [contract.id]);
  assert.deepEqual((await store.contract(contract.id)).proof.sourceHashes, { [first]: changeFirst.afterHash });

  await store.decideChanges(section.id, contract.id, { nodeId: second, decision: 'accept' });
  assert.equal((await store.contract(contract.id)).proof, null, 'the earlier proof never typeset the second piece');
  const stale = await store.recordBuild(buildRecord(section, { [first]: changeFirst.afterHash, [second]: changeSecond.baseHash }));
  assert.deepEqual(stale.provedContracts, [], 'a build of the old second piece proves nothing');
  await store.recordBuild(buildRecord(section, { [first]: changeFirst.afterHash, [second]: changeSecond.afterHash }));
  assert.deepEqual((await store.contract(contract.id)).proof.sourceHashes, { [first]: changeFirst.afterHash, [second]: changeSecond.afterHash });
});

test('a contract keeps its strongest proof: a piece typeset alone never displaces a verified book-order proof', async (context) => {
  const { store, first } = await syntheticBook(context);
  const contract = await propose(store, first, `${FIRST}\nAccepted.\n`);
  await store.decideChanges(first, contract.id, { decision: 'accept' });
  const scope = await store.scope(first); const hashes = { [first]: contract.changes[0].afterHash };
  const alone = { schemaVersion: 3, mode: 'isolated', pagination: { verified: false } };

  await store.recordBuild(buildRecord(scope, hashes, alone));
  assert.equal((await store.contract(contract.id)).proof.mode, 'isolated');
  const strong = await store.recordBuild(buildRecord(scope, hashes));
  const kept = (await store.contract(contract.id)).proof;
  assert.equal(kept.mode, 'prefix'); assert.equal(kept.completedAt, strong.completedAt, 'a stronger proof replaces a weaker one');
  await pause();
  const again = await store.recordBuild(buildRecord(scope, hashes));
  assert.deepEqual(again.provedContracts, [contract.id], 'the build still proves the contract');
  assert.equal((await store.contract(contract.id)).proof.completedAt, strong.completedAt, 'an equal proof rewrites nothing');
  // An equally strong proof under a different publication profile records the settings now in force.
  const redesigned = await store.recordBuild(buildRecord(scope, hashes, { schemaVersion: 3, mode: 'prefix', designHash: 'profile-2', pagination: { verified: true } }));
  const current = (await store.contract(contract.id)).proof;
  assert.equal(current.designHash, 'profile-2'); assert.equal(current.completedAt, redesigned.completedAt);
  await store.recordBuild(buildRecord(scope, hashes, alone));
  assert.equal((await store.contract(contract.id)).proof.mode, 'prefix', 'a weaker proof does not replace a stronger one');
});

test('a rollback can be limited to one piece, and one edited piece refuses the whole rollback', async (context) => {
  const { root, store, first, second, section, contract } = await twoPieceContract(context);
  await store.decideChanges(section.id, contract.id, { decision: 'accept' });
  const secondFile = path.join(root, 'manuscript', '01', 'Second.md'); const firstFile = path.join(root, 'manuscript', '01', 'First.md');

  const one = await store.revertChanges(contract.id, { nodeId: second });
  assert.deepEqual(one.changes.map((change) => change.status), ['accepted', 'reverted']);
  assert.equal(await readFile(secondFile, 'utf8'), SECOND); assert.match(await readFile(firstFile, 'utf8'), /First revised/);

  // Accept again through a fresh contract, then edit one of the two pieces by hand.
  const { sources } = await store.scopeContext(section.id);
  const { changeSet: both } = await store.createChangeSet(section.id, { changes: [{ nodeId: first, source: `${FIRST}\nFirst again.\n` }, { nodeId: second, source: `${SECOND}\nSecond again.\n` }] }, sources);
  await store.decideChanges(section.id, both.id, { decision: 'accept' });
  const edited = await store.node(second); await store.updateNode(second, `${edited.source}\nBy hand.\n`, edited.hash);
  await assert.rejects(() => store.revertChanges(both.id), { code: 'STALE_SOURCE' });
  assert.match(await readFile(firstFile, 'utf8'), /First again/, 'the unedited piece is not rolled back either');
  assert.deepEqual((await store.contract(both.id)).changes.map((change) => change.status), ['accepted', 'accepted']);
});

test('a piece that is not valid UTF-8 is never overwritten, by a save, an acceptance or a rollback', async (context) => {
  const { store, first, firstFile } = await syntheticBook(context);
  // "café" in Latin-1: the 0xE9 byte is not UTF-8 and decodes to a replacement character.
  const latin1 = Buffer.concat([Buffer.from('# First\n\ncaf', 'ascii'), Buffer.from([0xe9]), Buffer.from('\n', 'ascii')]);
  await writeFile(firstFile, latin1);
  await store.refreshGraph();
  const node = await store.node(first);
  await assert.rejects(() => store.updateNode(first, `${node.source}More.\n`, node.hash), { code: 'SOURCE_NOT_UTF8' });
  const contract = await propose(store, first, `${node.source}Proposed.\n`);
  const decided = await store.decideChanges(first, contract.id, { decision: 'accept' });
  assert.equal(decided.changes[0].status, 'failed'); assert.match(decided.changes[0].error, /not valid UTF-8/);
  assert.ok((await readFile(firstFile)).equals(latin1), 'the original bytes are untouched');
});

test('a byte-order mark, Windows line endings and a missing final newline survive accept and rollback', async (context) => {
  const { store, first, firstFile } = await syntheticBook(context);
  const original = Buffer.from('﻿# First\r\n\r\nOne line.\r\nNo final newline', 'utf8');
  await writeFile(firstFile, original);
  await store.refreshGraph();
  const node = await store.node(first);
  const contract = await propose(store, first, `${node.source}\nAdded.\n`);
  await store.decideChanges(first, contract.id, { decision: 'accept' });
  assert.match(await readFile(firstFile, 'utf8'), /Added\.\r\n$/, 'the proposal is written in the file\'s own line endings');
  await store.revertChanges(contract.id);
  assert.ok((await readFile(firstFile)).equals(original));
});

test('a reply that only changes line endings proposes nothing', async (context) => {
  const { store, first, firstFile } = await syntheticBook(context);
  // A piece with mixed endings: converting a reply to CRLF throughout would change
  // its bytes without changing a word, which is not a change the author asked for.
  await writeFile(firstFile, '# First\r\n\r\nOne line.\nAnother line.\n');
  await store.refreshGraph();
  const { sources } = await store.scopeContext(first);
  const { changeSet } = await store.createChangeSet(first, { changes: [{ nodeId: first, source: '# First\n\nOne line.\nAnother line.\n' }] }, sources);
  assert.equal(changeSet, null); assert.deepEqual(await store.contracts(), []);
});

test('a proposal that is not well-formed text, or too long once its line endings are converted, is refused', async (context) => {
  const { store, first, firstFile } = await syntheticBook(context);
  await writeFile(firstFile, '# First\r\n\r\nOne line.\r\n');
  await store.refreshGraph();
  const { sources } = await store.scopeContext(first);
  // 300,000 LF line breaks become 600,000 characters in this CRLF piece: over the 400 KB bound.
  const long = `# First\n\n${'\n'.repeat(300_000)}`;
  const lone = '# First\n\nA lone \uD800 surrogate.\n';
  const { changeSet, dropped } = await store.createChangeSet(first, { changes: [{ nodeId: first, source: long }] }, sources);
  assert.equal(changeSet, null); assert.match(dropped[0].reason, /longer than 400 KB/);
  const second = await store.createChangeSet(first, { changes: [{ nodeId: first, source: lone }] }, sources);
  assert.equal(second.changeSet, null); assert.match(second.dropped[0].reason, /invalid/);
});

test('a contract file that exists but cannot be read is an error, never a missing contract', async (context) => {
  const { root, store, first } = await syntheticBook(context);
  const contract = await propose(store, first, `${FIRST}\nPending.\n`);
  // A directory where the file should be stands in for a lock held by a sync client or scanner.
  const file = path.join(root, '.texgraph', 'contracts', `${contract.id}.json`);
  const saved = await readFile(file);
  await rm(file); await mkdir(file);
  await assert.rejects(() => store.changeSet(first));
  await assert.rejects(() => propose(store, first, `${FIRST}\nWould orphan the first.\n`), 'a new proposal does not replace a contract it could not read');
  await rm(file, { recursive: true }); await writeFile(file, saved);
  assert.equal((await store.changeSet(first)).id, contract.id, 'the pending contract is still the current one');
  assert.equal((await store.contract(contract.id)).status, 'pending');
});

test('unusable contract files are treated as absent and never reach the manuscript', async (context) => {
  const { root, store, first, firstFile } = await syntheticBook(context);
  const contracts = path.join(root, '.texgraph', 'contracts'); const pointer = path.join(root, '.texgraph', 'proposals', `${first}.json`);
  const good = await propose(store, first, `${FIRST}\nGood.\n`);
  await store.decideChanges(first, good.id, { decision: 'accept' });
  const accepted = await readFile(firstFile, 'utf8');

  // A record stored under another id: a rollback must not write its text.
  const forgedId = randomUUID();
  await writeFile(path.join(contracts, `${forgedId}.json`), JSON.stringify({ ...(await store.contract(good.id)), changes: [{ ...(await store.contract(good.id)).changes[0], before: 'FORGED\n' }] }));
  assert.equal(await store.contract(forgedId), null);
  await assert.rejects(() => store.revertChanges(forgedId), { code: 'CONTRACT_NOT_FOUND' });
  // Parsable records with unusable changes.
  await writeFile(path.join(contracts, `${randomUUID()}.json`), JSON.stringify({ id: 'x', scopeId: first, changes: [null] }));
  const shapeless = randomUUID();
  await writeFile(path.join(contracts, `${shapeless}.json`), JSON.stringify({ id: shapeless, scopeId: first }));
  await assert.rejects(() => store.revertChanges(shapeless), { code: 'CONTRACT_NOT_FOUND' });
  assert.equal(await readFile(firstFile, 'utf8'), accepted);
  assert.deepEqual((await store.contracts()).map((entry) => entry.id), [good.id], 'the usable history is still listed');

  // A damaged current contract, then a damaged pointer: the conversation still opens and a new proposal repairs it.
  await writeFile(path.join(contracts, `${good.id}.json`), '{ damaged');
  assert.equal(await store.changeSet(first), null);
  await writeFile(pointer, '{ damaged');
  assert.equal(await store.changeSet(first), null);
  const repaired = await propose(store, first, `${accepted}\nAfter repair.\n`);
  assert.equal((await store.changeSet(first)).id, repaired.id);
});

test('a change that did not write is never accepted, so its rollback cannot undo someone else\'s edit', async (context) => {
  const { store, first, firstFile } = await syntheticBook(context);
  const graph = await store.graph();
  const section = graph.book.sections.find((entry) => entry.nodeIds.includes(first));
  const target = `${FIRST}\nThe same proposed text.\n`;
  // Y, in the piece's conversation, is proposed against the original text.
  const y = await propose(store, first, target);
  // The author edits by hand; X, in the section conversation, proposes the same text against the edit.
  const original = await store.node(first); const byHand = `${FIRST}\nEdited by hand.\n`;
  await store.updateNode(first, byHand, original.hash);
  const { sources } = await store.scopeContext(section.id);
  const { changeSet: x } = await store.createChangeSet(section.id, { changes: [{ nodeId: first, source: target }] }, sources);
  await store.decideChanges(section.id, x.id, { decision: 'accept' });
  // Y's text is already there, but Y did not write it: Y is stale and cannot be rolled back.
  const decided = await store.decideChanges(first, y.id, { decision: 'accept' });
  assert.equal(decided.changes[0].status, 'stale');
  await assert.rejects(() => store.revertChanges(y.id), { code: 'NOTHING_TO_REVERT' });
  // X wrote it, and rolling X back restores the hand edit, not the original.
  await store.revertChanges(x.id);
  assert.equal(await readFile(firstFile, 'utf8'), byHand);
});

test('an undecided change set from before contracts is superseded and kept', async (context) => {
  const { root, store, first } = await syntheticBook(context);
  const node = await store.node(first); const source = `${FIRST}\nOlder.\n`;
  const legacy = { schemaVersion: 2, id: randomUUID(), scopeId: first, createdAt: '2026-01-01T00:00:00.000Z', commentary: '', status: 'pending', dropped: [], changes: [{ nodeId: first, relativePath: '01/First.md', title: 'First', baseHash: node.hash, afterHash: sourceHash(source), before: FIRST, source, summary: '', status: 'pending' }] };
  await writeFile(path.join(root, '.texgraph', 'proposals', `${first}.json`), JSON.stringify(legacy));
  const newer = await propose(store, first, `${FIRST}\nNewer.\n`);
  const kept = await store.contract(legacy.id);
  assert.equal(kept.changes[0].status, 'superseded'); assert.equal(kept.changes[0].supersededBy, newer.id);
});

test('provenance from the gateway is stored as short labels or not at all', async (context) => {
  const { store, first } = await syntheticBook(context);
  const contract = await propose(store, first, `${FIRST}\nLabelled.\n`, { model: 'm'.repeat(400), transport: { not: 'a string' }, userTurnId: 7, designHash: ['x'] });
  assert.deepEqual(contract.origin, { userTurnId: null, model: 'm'.repeat(120), transport: null });
  assert.equal(contract.context.designHash, null);
});

// --- The published schema ------------------------------------------------------

const SCHEMA_KEYWORDS = new Set(['$schema', '$id', 'title', 'description', 'type', 'required', 'properties', 'additionalProperties', 'enum', 'const', 'items', 'pattern', 'maxLength', 'minimum', 'oneOf', 'minItems']);

/**
 * Validates a value against the subset of JSON Schema that the change-contract
 * schema uses. It refuses any keyword it does not implement, so the schema
 * cannot grow a constraint this check silently ignores.
 *
 * @param {object} schema
 * @param {unknown} value
 * @param {string} [at]  Path of the value, for messages.
 * @returns {string[]}  Violations; empty when the value conforms.
 */
function violations(schema, value, at = '$') {
  for (const keyword of Object.keys(schema)) assert.ok(SCHEMA_KEYWORDS.has(keyword), `the schema uses an unchecked keyword: ${keyword}`);
  const typeOf = (entry) => (entry === null ? 'null' : Array.isArray(entry) ? 'array' : Number.isInteger(entry) ? 'integer' : typeof entry);
  const found = [];
  // Exactly one alternative must hold; when none does, each alternative's first violation is reported.
  if (schema.oneOf) {
    const results = schema.oneOf.map((alternative) => violations(alternative, value, at));
    const holding = results.filter((result) => !result.length).length;
    if (holding === 0) found.push(`${at}: matches no alternative: ${results.map((result) => result[0]).join(' | ')}`);
    if (holding > 1) found.push(`${at}: matches ${holding} alternatives`);
  }
  if ('const' in schema && value !== schema.const) found.push(`${at}: expected ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.includes(value)) found.push(`${at}: not one of ${JSON.stringify(schema.enum)}`);
  if (schema.type && ![schema.type].flat().includes(typeOf(value))) return [...found, `${at}: expected ${schema.type}, got ${typeOf(value)}`];
  if (typeof value === 'string') {
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) found.push(`${at}: does not match ${schema.pattern}`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) found.push(`${at}: longer than ${schema.maxLength}`);
  }
  if (typeof value === 'number' && schema.minimum !== undefined && value < schema.minimum) found.push(`${at}: below ${schema.minimum}`);
  if (Array.isArray(value) && schema.minItems !== undefined && value.length < schema.minItems) found.push(`${at}: fewer than ${schema.minItems} items`);
  if (Array.isArray(value) && schema.items) value.forEach((entry, index) => found.push(...violations(schema.items, entry, `${at}[${index}]`)));
  if (typeOf(value) === 'object') {
    for (const key of schema.required || []) if (!(key in value)) found.push(`${at}: missing ${key}`);
    for (const [key, entry] of Object.entries(value)) {
      if (schema.properties?.[key]) found.push(...violations(schema.properties[key], entry, `${at}.${key}`));
      else if (schema.additionalProperties === false) found.push(`${at}: unexpected ${key}`);
    }
  }
  return found;
}

test('every state of a stored contract conforms to the published schema, and the schema rejects malformed records', async (context) => {
  const schema = JSON.parse(await readFile(new URL('../../../protocol/frige/change-contract.v1.schema.json', import.meta.url), 'utf8'));
  const { store, first, second, section, contract } = await twoPieceContract(context);
  const conforms = async (label) => assert.deepEqual(violations(schema, await store.contract(contract.id)), [], label);

  await conforms('pending, with provenance defaults');
  await store.decideChanges(section.id, contract.id, { nodeId: first, decision: 'accept' });
  await store.recordBuild(buildRecord(section, { [first]: contract.changes[0].afterHash }));
  await conforms('partly accepted, with a proof');
  await store.decideChanges(section.id, contract.id, { nodeId: second, decision: 'reject' });
  await store.revertChanges(contract.id);
  await conforms('resolved: one rolled back, one rejected');
  const superseded = await propose(store, first, `${FIRST}\nEarlier.\n`, { request: 'Ask.', userTurnId: 'turn-1', model: 'stex/test', transport: 'fake', references: [{ id: 'ref-1', name: 'Notes.md' }], withheld: [{ nodeId: second, title: 'Second' }], designHash: 'design-1' });
  await propose(store, first, `${FIRST}\nLater.\n`);
  assert.deepEqual(violations(schema, await store.contract(superseded.id)), [], 'superseded, with full provenance');

  // The check must be able to fail: each malformed record is refused for the stated reason.
  const record = await store.contract(contract.id);
  const refused = (mutate) => { const copy = structuredClone(record); mutate(copy); return violations(schema, copy).join('\n'); };
  assert.match(refused((copy) => { copy.changes[0].status = 'applied'; }), /changes\[0\]\.status: not one of/);
  assert.match(refused((copy) => { delete copy.rollback; }), /missing rollback/);
  assert.match(refused((copy) => { copy.note = 'extra'; }), /unexpected note/);
  assert.match(refused((copy) => { copy.changes[0].baseHash = 'short'; }), /baseHash: does not match/);
  assert.match(refused((copy) => { copy.context.offered[0].category = 'generated'; }), /category: expected "canonical-source"/);
  assert.match(refused((copy) => { copy.schemaVersion = 2; }), /schemaVersion: expected 3/);
});

// --- Layout changes (program Wave 3b) --------------------------------------------

/**
 * Proposes one layout change in a conversation, offering that scope's sources.
 *
 * @param {ProjectStore} store
 * @param {string} scopeId
 * @param {object} layout  As the simulator shapes it: `{ set }` or `{ clear: true }`.
 * @param {Array<{ nodeId: string, source: string }>} [changes]  Text changes in the same reply.
 */
async function proposeLayout(store, scopeId, layout, changes = []) {
  const { sources } = await store.scopeContext(scopeId);
  return store.createChangeSet(scopeId, { commentary: 'A synthetic layout reason.', changes, layout }, sources, { request: 'Change the layout.' });
}

const SCHEMA = JSON.parse(await readFile(new URL('../../../protocol/frige/change-contract.v1.schema.json', import.meta.url), 'utf8'));

test('a piece conversation proposes its own layout as a contract, accepted and rolled back through the profile hash', async (context) => {
  const { store, first } = await syntheticBook(context);
  const original = await store.design();
  const { changeSet: contract } = await proposeLayout(store, first, { set: { fontSize: '15pt', leading: '18pt' } });
  const [change] = contract.changes;
  assert.deepEqual({ kind: change.kind, level: change.level, target: change.target, nodeId: change.nodeId, before: change.before, after: change.after },
    { kind: 'set-layout', level: 'node', target: first, nodeId: first, before: null, after: { fontSize: '15pt', leading: '18pt' } });
  assert.deepEqual(change.inherited, { fontSize: '11pt', leading: '13.6pt', sizeFrom: 'book', opensRecto: false, headText: null }, 'the author sees what the override replaces');
  assert.equal(change.baseHash, designHash(original)); assert.match(contract.effects[0].message, /publication profile/);
  assert.deepEqual(violations(SCHEMA, contract), [], 'a layout contract conforms to the schema');
  assert.deepEqual(await store.design(), original, 'a proposal changes nothing');

  await store.decideChanges(first, contract.id, { decision: 'accept' });
  const applied = await store.design();
  assert.deepEqual(applied.nodes, { [first]: { fontSize: '15pt', leading: '18pt' } }); assert.equal(designHash(applied), change.afterHash);
  const scope = await store.scope(first);
  const pieceHash = (await store.node(first)).hash;
  const build = (profileHash, sourceHashes = { [first]: pieceHash }) => store.recordBuild({ ok: true, targetScope: scope, sourceHashes, pageMap: { schemaVersion: 3, mode: 'prefix', designHash: profileHash, pagination: { verified: true } }, log: '' });
  assert.deepEqual(change.pieces, [first], 'the override applies to this piece only');
  assert.deepEqual((await build(change.baseHash)).provedContracts, [], 'a build under the old profile proves nothing');
  assert.deepEqual((await build(change.afterHash, {})).provedContracts, [], 'a build that did not typeset the piece proves nothing, whatever its profile');
  assert.deepEqual((await build(change.afterHash)).provedContracts, [contract.id]);

  const reverted = await store.revertChanges(contract.id);
  assert.equal(reverted.changes[0].status, 'reverted'); assert.equal(reverted.proof, null);
  assert.deepEqual(await store.design(), original); assert.equal(designHash(await store.design()), change.baseHash);
  assert.deepEqual(violations(SCHEMA, await store.contract(contract.id)), []);
  assert.equal((await store.turns(first)).at(-1).kind, 'changes-reverted');
});

test('a section conversation proposes the section override; rejecting it leaves the profile untouched', async (context) => {
  const { store, first } = await syntheticBook(context);
  const section = (await store.graph()).book.sections.find((entry) => entry.nodeIds.includes(first));
  await store.saveDesign({ sections: { [section.folder]: { opensRecto: false } } });
  const before = await store.design();
  const { changeSet: contract } = await proposeLayout(store, section.id, { set: { opensRecto: true, headText: 'Section head' } });
  const [change] = contract.changes;
  assert.deepEqual([change.level, change.target, change.nodeId], ['section', section.folder, null]);
  assert.deepEqual(change.before, { opensRecto: false }); assert.deepEqual(change.after, { opensRecto: true, headText: 'Section head' }, 'set merges into the current override');
  await store.decideChanges(section.id, contract.id, { decision: 'reject' });
  assert.deepEqual(await store.design(), before);
  // Clearing is a change too.
  const { changeSet: clearing } = await proposeLayout(store, section.id, { clear: true });
  assert.equal(clearing.changes[0].after, null);
  await store.decideChanges(section.id, clearing.id, { decision: 'accept' });
  assert.equal((await store.design()).sections, undefined);
});

test('a layout change is refused, never applied, against a profile that changed after it was proposed or accepted', async (context) => {
  const { store, first } = await syntheticBook(context);
  const { changeSet: stale } = await proposeLayout(store, first, { set: { opensRecto: true } });
  await store.saveDesign({ folios: true });
  const decided = await store.decideChanges(first, stale.id, { decision: 'accept' });
  assert.equal(decided.changes[0].status, 'stale'); assert.equal((await store.design()).nodes, undefined);

  const { changeSet: accepted } = await proposeLayout(store, first, { set: { opensRecto: true } });
  await store.decideChanges(first, accepted.id, { decision: 'accept' });
  await store.saveDesign({ folios: false });
  const changed = await store.design();
  await assert.rejects(() => store.revertChanges(accepted.id), { code: 'STALE_SOURCE' });
  assert.deepEqual(await store.design(), changed, 'the later profile change is not overwritten');
});

test('layout proposals that cannot be a contract are set aside with a reason', async (context) => {
  const { store, first } = await syntheticBook(context);
  const book = await proposeLayout(store, 'book', { set: { opensRecto: true } });
  assert.equal(book.changeSet, null); assert.match(book.dropped[0].reason, /Design panel/);
  const invalid = await proposeLayout(store, first, { set: { fontSize: '40pt', leading: '50pt' } });
  assert.equal(invalid.changeSet, null); assert.match(invalid.dropped[0].reason, /not valid: .*Body size/);
  const notTex = await proposeLayout(store, first, { set: { trimSize: 'A4' } });
  assert.match(notTex.dropped[0].reason, /trimSize cannot be set for a piece/);
  const noOp = await proposeLayout(store, first, { set: { opensRecto: null } });
  assert.equal(noOp.changeSet, null, 'a proposal that changes nothing makes no contract'); assert.match(noOp.dropped[0].reason, /would change nothing/);
  assert.match((await proposeLayout(store, first, JSON.parse('{"set":{"__proto__":{"opensRecto":true}}}'))).dropped[0].reason, /invalid/, 'a prototype key is not a setting');
  const flood = Object.fromEntries(Array.from({ length: 5000 }, (_, index) => [`key${index}`, 1]));
  assert.ok((await proposeLayout(store, first, { set: flood })).dropped[0].reason.length <= 1000, 'a stored reason is bounded');
  // Text and layout together: the text changes are kept, the layout change set aside.
  const mixed = await proposeLayout(store, first, { set: { opensRecto: true } }, [{ nodeId: first, source: `${FIRST}\nText.\n` }]);
  assert.deepEqual(mixed.changeSet.changes.map((change) => change.kind), ['replace-node-source']);
  assert.match(mixed.dropped[0].reason, /either text changes or one layout change/);
});

test('a section layout change is proved only by a build of all its pieces, and is refused once its target leaves the book', async (context) => {
  const { store, first, second } = await syntheticBook(context);
  const graph = await store.graph();
  const section = graph.book.sections.find((entry) => entry.nodeIds.includes(first));
  const { changeSet: contract } = await proposeLayout(store, section.id, { set: { fontSize: '10pt', leading: '12pt' } });
  const [change] = contract.changes;
  assert.deepEqual(change.pieces, section.nodeIds);
  assert.deepEqual([change.inherited.opensRecto, change.inherited.headText], [false, section.title], 'a section shows the recto rule and running head it would otherwise have');
  await store.decideChanges(section.id, contract.id, { decision: 'accept' });
  const scope = await store.scope(section.id);
  const build = (sourceHashes) => store.recordBuild({ ok: true, targetScope: scope, sourceHashes, pageMap: { schemaVersion: 3, mode: 'isolated', designHash: change.afterHash, pagination: { verified: true } }, log: '' });
  assert.deepEqual((await build({ [second]: 'other' })).provedContracts, [], 'a build of another section under the same profile proves nothing');
  assert.deepEqual((await build(Object.fromEntries(section.nodeIds.map((id) => [id, 'typeset'])))).provedContracts, [contract.id]);
  assert.deepEqual(violations(SCHEMA, await store.contract(contract.id)), []);

  // A proposal for a piece that then leaves the table of contents is not applied.
  const { changeSet: orphan } = await proposeLayout(store, first, { set: { opensRecto: true } });
  await writeFile(path.join(store.manuscriptDirectory, 'Programme.md'), '# Programme\n\n- [Second](02/Second.md)\n');
  const decided = await store.decideChanges(first, orphan.id, { decision: 'accept' });
  assert.equal(decided.changes[0].status, 'stale'); assert.match(decided.changes[0].error, /no longer in the table of contents/);
  assert.equal((await store.design()).nodes, undefined);
  assert.deepEqual(violations(SCHEMA, decided), [], 'a stale layout change conforms to the schema');
});

test('a profile save made from an outdated form cannot undo an accepted layout change', async (context) => {
  const { store, first } = await syntheticBook(context);
  // The Design panel is filled in from the profile as it is now ...
  const formHash = designHash(await store.design());
  // ... then a layout change is accepted in the conversation beside it.
  const { changeSet: contract } = await proposeLayout(store, first, { set: { opensRecto: true } });
  await store.decideChanges(first, contract.id, { decision: 'accept' });
  // The form still shows no override for the piece; saving it would clear the accepted one.
  await assert.rejects(() => store.saveDesign({ folios: true, nodes: { [first]: null }, baseHash: formHash }), { code: 'STALE_DESIGN' });
  assert.deepEqual((await store.design()).nodes, { [first]: { opensRecto: true } }, 'the accepted change is intact');
  assert.equal((await store.revertChanges(contract.id)).changes[0].status, 'reverted', 'and can still be rolled back');
  // A save from a current form goes through, and `baseHash` is never stored.
  const saved = await store.saveDesign({ folios: true, baseHash: designHash(await store.design()) });
  assert.equal(saved.folios, true); assert.equal('baseHash' in saved, false);
});

test('a layout proposal supersedes a pending text proposal in the same conversation and conflicts only with layout elsewhere', async (context) => {
  const { store, first } = await syntheticBook(context);
  const text = await propose(store, first, `${FIRST}\nText.\n`);
  const { changeSet: layout } = await proposeLayout(store, first, { set: { opensRecto: true } });
  assert.equal((await store.contract(text.id)).changes[0].status, 'superseded');
  assert.deepEqual(violations(SCHEMA, await store.contract(text.id)), []);
  const section = (await store.graph()).book.sections.find((entry) => entry.nodeIds.includes(first));
  const { changeSet: sectionText } = await proposeLayout(store, section.id, null, [{ nodeId: first, source: `${FIRST}\nFrom the section.\n` }]);
  assert.deepEqual(sectionText.conflicts, [], 'a text change does not conflict with a pending layout change');
  const { changeSet: otherPiece } = await (async () => { const graph = await store.graph(); return proposeLayout(store, graph.readingOrder[1], { set: { opensRecto: true } }); })();
  assert.deepEqual(otherPiece.conflicts, [], 'layout changes to different targets do not conflict');
  assert.equal(layout.changes[0].status, 'pending');
  assert.deepEqual(violations(SCHEMA, sectionText), []);
});

// --- All-or-nothing acceptance and crash recovery (program Wave 3d) ---------------

test('a failed write part-way through accepting several pieces restores the pieces already written', async (context) => {
  const { root, store, first, second } = await syntheticBook(context);
  const secondFile = path.join(root, 'manuscript', '02', 'Second.md');
  // The second piece is not valid UTF-8, so Frige refuses to overwrite it: a write that fails after the first succeeded.
  const latin1 = Buffer.concat([Buffer.from('# Second\n\ncaf', 'ascii'), Buffer.from([0xe9]), Buffer.from('\n', 'ascii')]);
  await writeFile(secondFile, latin1); await store.refreshGraph();
  const graph = await store.graph();
  const offered = [...(await store.scopeContext(graph.readingOrder[0])).sources, ...(await store.scopeContext(graph.readingOrder[1])).sources];
  const { changeSet } = await store.createChangeSet('book', { changes: [{ nodeId: first, source: `${FIRST}\nFirst together.\n` }, { nodeId: second, source: '# Second\n\nReplaced.\n' }] }, offered);
  const decided = await store.decideChanges('book', changeSet.id, { decision: 'accept' });
  assert.deepEqual(decided.changes.map((change) => change.status), ['failed', 'failed']);
  assert.match(decided.changes[0].error, /none was/); assert.match(decided.changes[1].error, /not valid UTF-8/);
  assert.equal((await store.node(first)).source, FIRST, 'the piece written first was restored');
  assert.ok((await readFile(secondFile)).equals(latin1));
  assert.equal('applying' in (await store.contract(changeSet.id)), false, 'no intent record is left behind');
  assert.deepEqual(violations(SCHEMA, await store.contract(changeSet.id)), []);
});

test('an acceptance interrupted by a stop is undone when the store next starts', async (context) => {
  const { root, store, first, firstFile } = await syntheticBook(context);
  const contract = await propose(store, first, `${FIRST}\nWritten before the stop.\n`);
  // Simulate a stop after the intent was recorded and the piece written, before the record was completed.
  const file = path.join(root, '.texgraph', 'contracts', `${contract.id}.json`);
  const record = JSON.parse(await readFile(file, 'utf8'));
  record.applying = { startedAt: '2026-01-01T00:00:00.000Z', nodeIds: [first] };
  await writeFile(file, JSON.stringify(record)); await writeFile(firstFile, contract.changes[0].source);

  const restarted = new ProjectStore(root); await restarted.initialize();
  assert.equal(await readFile(firstFile, 'utf8'), FIRST, 'the half-applied piece is restored');
  const recovered = await restarted.contract(contract.id);
  assert.equal(recovered.changes[0].status, 'failed'); assert.match(recovered.changes[0].error, /interrupted/);
  assert.equal('applying' in recovered, false);
  assert.equal((await restarted.turns(first)).at(-1).kind, 'changes-decided');
  assert.deepEqual(violations(SCHEMA, recovered), []);
  // Recovery runs once per store; the author can propose and accept again.
  const again = await propose(restarted, first, `${FIRST}\nAccepted after recovery.\n`);
  assert.equal((await restarted.decideChanges(first, again.id, { decision: 'accept' })).changes[0].status, 'accepted');
});

test('an interrupted acceptance whose piece was never written is recorded as failed and changes nothing', async (context) => {
  const { root, first, firstFile } = await syntheticBook(context);
  const store = new ProjectStore(root);
  const contract = await propose(store, first, `${FIRST}\nNever written.\n`);
  const file = path.join(root, '.texgraph', 'contracts', `${contract.id}.json`);
  const record = JSON.parse(await readFile(file, 'utf8')); record.applying = { startedAt: '2026-01-01T00:00:00.000Z', nodeIds: [first] };
  await writeFile(file, JSON.stringify(record));
  const restarted = new ProjectStore(root); await restarted.initialize();
  assert.equal(await readFile(firstFile, 'utf8'), FIRST);
  const recovered = await restarted.contract(contract.id);
  assert.equal(recovered.changes[0].status, 'failed'); assert.match(recovered.changes[0].error, /left as it is/);
  assert.equal('applying' in recovered, false); assert.equal((await restarted.turns(first)).at(-1).kind, 'changes-decided');
});

test('recovery leaves alone a piece edited after the stop, and a record carrying `applying` conforms to the schema', async (context) => {
  const { root, store, first, firstFile } = await syntheticBook(context);
  const contract = await propose(store, first, `${FIRST}\nProposed.\n`);
  const file = path.join(root, '.texgraph', 'contracts', `${contract.id}.json`);
  const record = JSON.parse(await readFile(file, 'utf8')); record.applying = { startedAt: '2026-01-01T00:00:00.000Z', nodeIds: [first] };
  assert.deepEqual(violations(SCHEMA, record), [], 'a record mid-acceptance is valid');
  await writeFile(file, JSON.stringify(record));
  const byHand = `${FIRST}\nEdited outside Frige after the stop.\n`;
  await writeFile(firstFile, byHand);
  const restarted = new ProjectStore(root); await restarted.initialize();
  assert.equal(await readFile(firstFile, 'utf8'), byHand, 'an edit made after the stop is never overwritten');
  assert.equal((await restarted.contract(contract.id)).changes[0].status, 'failed');
});

test('a write that reaches the file and then throws is still restored, and recorded by what the piece holds', async (context) => {
  const { root, store, first, second } = await syntheticBook(context);
  const graph = await store.graph();
  const offered = [...(await store.scopeContext(graph.readingOrder[0])).sources, ...(await store.scopeContext(graph.readingOrder[1])).sources];
  const { changeSet } = await store.createChangeSet('book', { changes: [{ nodeId: first, source: `${FIRST}\nOne.\n` }, { nodeId: second, source: `${SECOND}\nTwo.\n` }] }, offered);
  // The second piece's write replaces the file, then the graph refresh after it throws.
  const refresh = store.refreshGraph.bind(store); let calls = 0;
  store.refreshGraph = async () => { calls += 1; if (calls === 2) throw Object.assign(new Error('Simulated lock during refresh.'), { code: 'EBUSY' }); return refresh(); };
  const decided = await store.decideChanges('book', changeSet.id, { decision: 'accept' });
  store.refreshGraph = refresh;
  assert.deepEqual(decided.changes.map((change) => change.status), ['failed', 'failed']);
  assert.match(decided.changes[1].error, /Simulated lock/);
  assert.equal(await readFile(path.join(root, 'manuscript', '01', 'First.md'), 'utf8'), FIRST);
  assert.equal(await readFile(path.join(root, 'manuscript', '02', 'Second.md'), 'utf8'), SECOND, 'the piece whose write threw after reaching the file is restored too');
  assert.equal('applying' in (await store.contract(changeSet.id)), false);
});

test('a failure to save the contract during acceptance never leaves `applying` on disk', async (context) => {
  const { root, store, first, firstFile } = await syntheticBook(context);
  const contract = await propose(store, first, `${FIRST}\nProposed.\n`);
  // The contract file can be written but the scope's pointer cannot (a lock outlasting the retries).
  // A read-only file blocks the atomic rename on Windows; on POSIX systems a rename
  // ignores the file's own mode, so the proposals directory is made read-only too
  // (this does not hold when the tests run as root, which bypasses both).
  const proposals = path.join(root, '.texgraph', 'proposals');
  const pointer = path.join(proposals, `${first}.json`);
  await chmod(pointer, 0o444); await chmod(proposals, 0o555);
  try { await assert.rejects(() => store.decideChanges(first, contract.id, { decision: 'accept' })); }
  finally { await chmod(proposals, 0o755); await chmod(pointer, 0o644); }
  const stored = await store.contract(contract.id);
  assert.equal('applying' in stored, false, 'the record saved afterwards does not claim an acceptance in progress');
  assert.equal(stored.changes[0].status, 'pending'); assert.equal(await readFile(firstFile, 'utf8'), FIRST);
  // So a later, legitimate write of the same text is never undone by a restart.
  await store.updateNode(first, contract.changes[0].source, (await store.node(first)).hash);
  await new ProjectStore(root).initialize();
  assert.equal(await readFile(firstFile, 'utf8'), contract.changes[0].source);
});

/**
 * Leaves a contract as an acceptance does when it could not read a piece to
 * settle it: `applying` set, the change still pending, the piece holding the
 * proposed text. The store's start-up recovery has already run.
 *
 * @param {import('node:test').TestContext} context
 */
async function halfApplied(context) {
  const book = await syntheticBook(context);
  await book.store.initialize();
  const contract = await propose(book.store, book.first, `${FIRST}\nWritten, not settled.\n`);
  const file = path.join(book.root, '.texgraph', 'contracts', `${contract.id}.json`);
  const record = JSON.parse(await readFile(file, 'utf8')); record.applying = { startedAt: '2026-01-01T00:00:00.000Z', nodeIds: [book.first] };
  await writeFile(file, JSON.stringify(record)); await writeFile(book.firstFile, contract.changes[0].source);
  return { ...book, contract };
}

test('a half-applied acceptance is settled before a later decision, so accepting again cannot make it permanent', async (context) => {
  const { store, first, firstFile, contract } = await halfApplied(context);
  await assert.rejects(() => store.decideChanges(first, contract.id, { decision: 'accept' }), /No pending change/);
  assert.equal(await readFile(firstFile, 'utf8'), FIRST, 'the piece is restored, not left holding the proposed text');
  const settled = await store.contract(contract.id);
  assert.equal(settled.changes[0].status, 'failed'); assert.equal('applying' in settled, false);
});

test('a half-applied acceptance is settled before a newer proposal supersedes it, and before a rollback', async (context) => {
  const { store, first, firstFile, contract } = await halfApplied(context);
  await propose(store, first, `${FIRST}\nNewer.\n`);
  assert.equal(await readFile(firstFile, 'utf8'), FIRST);
  assert.equal((await store.contract(contract.id)).changes[0].status, 'failed', 'settled, then nothing left to supersede');

  const again = await halfApplied(context);
  await assert.rejects(() => again.store.revertChanges(again.contract.id), { code: 'NOTHING_TO_REVERT' });
  assert.equal(await readFile(again.firstFile, 'utf8'), FIRST);
});

test('recovery that cannot read a piece fails and is retried, never guessing that the piece was left alone', async (context) => {
  const { root, store, first, firstFile } = await syntheticBook(context);
  const contract = await propose(store, first, `${FIRST}\nWritten before the stop.\n`);
  const file = path.join(root, '.texgraph', 'contracts', `${contract.id}.json`);
  const record = JSON.parse(await readFile(file, 'utf8')); record.applying = { startedAt: '2026-01-01T00:00:00.000Z', nodeIds: [first] };
  await writeFile(file, JSON.stringify(record)); await writeFile(firstFile, contract.changes[0].source);
  const restarted = new ProjectStore(root);
  const read = restarted.node.bind(restarted); let locked = true;
  restarted.node = async (id) => { if (locked && id === first) throw Object.assign(new Error('Simulated lock.'), { code: 'EBUSY' }); return read(id); };
  await assert.rejects(() => restarted.initialize(), /Simulated lock/);
  assert.equal('applying' in (await restarted.contract(contract.id)), true, 'nothing is settled while the piece cannot be read');
  assert.equal(await readFile(firstFile, 'utf8'), contract.changes[0].source);
  locked = false;
  await restarted.initialize();
  assert.equal(await readFile(firstFile, 'utf8'), FIRST, 'the retried recovery restores the piece');
  assert.equal((await restarted.contract(contract.id)).changes[0].status, 'failed');
});

test('accepting three pieces with a failure on the second leaves all three unchanged', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'frige-contract-three-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'manuscript', '01'), { recursive: true });
  const files = { A: '# A\n\nOne.\n', B: Buffer.concat([Buffer.from('# B\n\ncaf', 'ascii'), Buffer.from([0xe9]), Buffer.from('\n', 'ascii')]), C: '# C\n\nThree.\n' };
  for (const [name, content] of Object.entries(files)) await writeFile(path.join(root, 'manuscript', '01', `${name}.md`), content);
  await writeFile(path.join(root, 'manuscript', 'Programme.md'), '- [A](01/A.md)\n- [B](01/B.md)\n- [C](01/C.md)\n');
  const store = new ProjectStore(root); const graph = await store.initialize();
  const section = graph.book.sections[0];
  const { sources } = await store.scopeContext(section.id);
  const { changeSet } = await store.createChangeSet(section.id, { changes: graph.readingOrder.map((nodeId) => ({ nodeId, source: `# Replaced ${nodeId}\n` })) }, sources);
  const decided = await store.decideChanges(section.id, changeSet.id, { decision: 'accept' });
  assert.deepEqual(decided.changes.map((change) => change.status), ['failed', 'failed', 'failed']);
  for (const [name, content] of Object.entries(files)) assert.ok((await readFile(path.join(root, 'manuscript', '01', `${name}.md`))).equals(Buffer.from(content)), `${name} unchanged`);
});

// --- Context from the levels around a scope (program Wave 3c) ---------------------

test('every scope is offered the outline, the settings in force and relevant approved contracts, with no manuscript text', async (context) => {
  const { store, first, second } = await syntheticBook(context);
  const graph = await store.graph({ refresh: true });
  const sectionOf = (id) => graph.book.sections.find((entry) => entry.nodeIds.includes(id));
  // A section override and three accepted changes at different levels.
  await store.saveDesign({ sections: { [sectionOf(first).folder]: { fontSize: '10pt', leading: '12pt' } } });
  const inPiece = await propose(store, first, `${FIRST}\nAccepted in the piece.\n`);
  await store.decideChanges(first, inPiece.id, { decision: 'accept' });
  const otherPiece = await propose(store, second, `${SECOND}\nAccepted elsewhere.\n`);
  await store.decideChanges(second, otherPiece.id, { decision: 'accept' });
  const rejected = await propose(store, first, `${FIRST}\nRejected.\n`);
  await store.decideChanges(first, rejected.id, { decision: 'reject' });
  const current = await store.graph({ refresh: true });
  const scopeOf = async (id) => store.scope(id);

  for (const scopeId of ['book', sectionOf(first).id, first]) {
    const scope = await scopeOf(scopeId);
    const offered = await store.hierarchy(scope, current);
    assert.deepEqual([offered.outline.category, offered.settings.category, offered.contracts.category], ['outline', 'document-settings', 'approved-contract']);
    // The outline lists every piece by hash, in reading order, and holds no text.
    assert.deepEqual(offered.outline.entries.map((entry) => [entry.nodeId, entry.hash]), current.readingOrder.map((id) => [id, current.nodes.find((node) => node.id === id).hash]));
    assert.equal(offered.outline.truncated, false);
    const serialized = JSON.stringify(offered);
    for (const text of ['Accepted in the piece', 'Accepted elsewhere', 'One line,', 'Two.']) assert.equal(serialized.includes(text), false, `${scopeId}: no manuscript text (${text})`);
    assert.equal(offered.settings.designHash, designHash(await store.design()));
    assert.equal(offered.contracts.entries.some((entry) => entry.contractId === rejected.id), false, 'a rejected proposal is not approved context');
  }
  // What each level sees of the settings in force.
  assert.equal((await store.hierarchy(await scopeOf('book'), current)).settings.scope, null);
  assert.deepEqual((await store.hierarchy(await scopeOf(sectionOf(first).id), current)).settings.scope, { level: 'section', fontSize: '10pt', leading: '12pt', sizeFrom: 'section', own: { fontSize: '10pt', leading: '12pt' } });
  assert.deepEqual((await store.hierarchy(await scopeOf(first), current)).settings.scope, { level: 'element', fontSize: '10pt', leading: '12pt', sizeFrom: 'section', own: null, section: { fontSize: '10pt', leading: '12pt' } });
  // Which accepted changes each level is shown.
  const contractsFor = async (id) => (await store.hierarchy(await scopeOf(id), current)).contracts.entries.map((entry) => entry.contractId);
  assert.deepEqual(await contractsFor('book'), [], 'piece conversations are not book decisions');
  assert.deepEqual(await contractsFor(first), [inPiece.id], 'a piece sees the changes made to it');
  assert.deepEqual(await contractsFor(second), [otherPiece.id]);
});

test('approved context keeps requests in their own conversation, skips reverted changes, and shows a section layout to its pieces', async (context) => {
  const { store, first } = await syntheticBook(context);
  const graph = await store.graph({ refresh: true });
  const section = graph.book.sections.find((entry) => entry.nodeIds.includes(first));
  // A section conversation accepts a change whose request quotes text.
  const { sources } = await store.scopeContext(section.id);
  const { changeSet: quoted } = await store.createChangeSet(section.id, { changes: [{ nodeId: first, source: `${FIRST}\nQuoted.\n` }] }, sources, { request: 'Make it echo "SECRET LINE" from elsewhere.' });
  await store.decideChanges(section.id, quoted.id, { decision: 'accept' });
  // A section layout change, and a piece change that is then rolled back.
  const { changeSet: layout } = await proposeLayout(store, section.id, { set: { opensRecto: true } });
  await store.decideChanges(section.id, layout.id, { decision: 'accept' });
  const reverted = await propose(store, first, `${(await store.node(first)).source}\nUndone.\n`);
  await store.decideChanges(first, reverted.id, { decision: 'accept' }); await store.revertChanges(reverted.id);
  const current = await store.graph({ refresh: true });

  const forSection = (await store.hierarchy(await store.scope(section.id), current)).contracts.entries;
  assert.deepEqual(forSection.map((entry) => entry.contractId).sort(), [quoted.id, layout.id].sort());
  assert.match(forSection.find((entry) => entry.contractId === quoted.id).request, /SECRET LINE/, 'the conversation that wrote a request sees it');
  const forPiece = (await store.hierarchy(await store.scope(first), current)).contracts.entries;
  assert.deepEqual(forPiece.map((entry) => entry.contractId).sort(), [quoted.id, layout.id].sort(), 'the piece sees the change made to it and its section layout, not the reverted one');
  assert.equal(JSON.stringify(forPiece).includes('SECRET LINE'), false, 'a request written elsewhere is not offered');
  assert.equal(forPiece.some((entry) => 'request' in entry), false);
});

test('outline pages come only from a proof that still matches the text, the profile and the reading order', async (context) => {
  const { store, first, second } = await syntheticBook(context);
  const graph = await store.graph({ refresh: true });
  const hashes = Object.fromEntries(graph.readingOrder.map((id) => [id, graph.nodes.find((node) => node.id === id).hash]));
  const pageMap = { schemaVersion: 3, mode: 'prefix', designHash: designHash(await store.design()), includedNodeIds: graph.readingOrder, sourceHashes: hashes, pagination: { verified: true }, nodes: [{ nodeId: first, firstPage: 1, lastPage: 1 }, { nodeId: second, firstPage: 2, lastPage: 3 }] };
  await store.saveReferenceMap(pageMap);
  const pages = async () => Object.fromEntries((await store.hierarchy(await store.scope('book'), await store.graph({ refresh: true }))).outline.entries.map((entry) => [entry.nodeId, entry.pages]));
  assert.deepEqual(await pages(), { [first]: { first: 1, last: 1 }, [second]: { first: 2, last: 3 } });
  await store.updateNode(first, `${FIRST}\nEdited since the proof.\n`, hashes[first]);
  assert.deepEqual(await pages(), { [first]: null, [second]: { first: 2, last: 3 } }, 'a piece edited since the proof has no pages');
  await store.saveDesign({ folios: true });
  assert.deepEqual(await pages(), { [first]: null, [second]: null }, 'a profile changed since the proof gives no pages');
});

test('the outline budget counts UTF-8 bytes, so multi-byte titles cannot overrun it', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'frige-outline-bytes-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'manuscript', '01'), { recursive: true });
  const title = '詩'.repeat(60);
  for (let index = 0; index < 150; index += 1) await writeFile(path.join(root, 'manuscript', '01', `P${index}.md`), `# ${title} ${index}\n\nA line.\n`);
  await writeFile(path.join(root, 'manuscript', 'Programme.md'), Array.from({ length: 150 }, (_, index) => `- [P](01/P${index}.md)`).join('\n'));
  const store = new ProjectStore(root); const graph = await store.initialize();
  const { outline } = await store.hierarchy(await store.scope('book'), graph);
  assert.equal(outline.truncated, true);
  assert.ok(Buffer.byteLength(JSON.stringify(outline.entries), 'utf8') <= 20_000);
});

test('a book outline longer than its budget is cut short and says so', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'frige-outline-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'manuscript', '01'), { recursive: true });
  const titles = Array.from({ length: 220 }, (_, index) => `Piece ${String(index).padStart(3, '0')} ${'with a long title '.repeat(2)}`);
  for (const [index, title] of titles.entries()) await writeFile(path.join(root, 'manuscript', '01', `P${index}.md`), `# ${title}\n\nA line.\n`);
  await writeFile(path.join(root, 'manuscript', 'Programme.md'), titles.map((_, index) => `- [P](01/P${index}.md)`).join('\n'));
  const store = new ProjectStore(root); const graph = await store.initialize();
  const { outline } = await store.hierarchy(await store.scope('book'), graph);
  assert.equal(outline.truncated, true);
  assert.ok(outline.entries.length > 0 && outline.entries.length < 220);
  assert.ok(JSON.stringify(outline.entries).length <= 20_000, 'the outline stays within its budget');
});

test('a contract records the context categories it was offered, without their content', async (context) => {
  const { store, first } = await syntheticBook(context);
  const contract = await propose(store, first, `${FIRST}\nProposed.\n`, { hierarchy: { outline: 2, outlineTruncated: false, settingsHash: 'abc', contracts: [randomUUID(), 'not-a-contract-id'] } });
  assert.deepEqual(contract.context.outline, { category: 'outline', count: 2, truncated: false });
  assert.deepEqual(contract.context.settings, { category: 'document-settings', designHash: 'abc' });
  assert.equal(contract.context.contracts.length, 1, 'only well-formed contract ids are recorded');
  assert.equal(contract.context.contracts[0].category, 'approved-contract');
  assert.deepEqual(violations(SCHEMA, contract), []);
  assert.deepEqual(violations(SCHEMA, await propose(store, first, `${FIRST}\nWithout it.\n`)), [], 'turns without such context still conform');
});

test('a proof records the hash of the text it typeset, not the hash the graph held', async (context) => {
  const { store, first, firstFile } = await syntheticBook(context);
  const { assembleBook } = await import('../src/book-assembler.mjs');
  const stale = await store.node(first);
  // The file changes after the graph was last refreshed by a reader of the cached graph.
  const design = store.design.bind(store);
  store.design = async () => { await writeFile(firstFile, `${FIRST}\nSaved during assembly.\n`); store.design = design; return design(); };
  const assembled = await assembleBook(store, { scopeId: first });
  assert.match(assembled.document, /Saved during assembly/);
  assert.notEqual(assembled.sourceHashes[first], stale.hash);
  assert.equal(assembled.sourceHashes[first], sourceHash(`${FIRST}\nSaved during assembly.\n`));
});

// --- Anchored edits (Frige product wave F5-B) ---------------------------------
//
// A director proposes a localized change as edits that quote the exact text
// they replace. Frige resolves them against the offered source; the contract
// still records the whole prior and proposed text, so acceptance, staleness
// and rollback are unchanged.

test('anchored edits resolve to exactly one span each, and any unusable edit refuses the whole set', () => {
  const base = 'alpha\nbeta\ngamma\ndelta\n';
  // Out of order on input, applied in source order; an empty replacement deletes.
  assert.deepEqual(applyEdits(base, [{ find: 'delta', replace: 'DELTA' }, { find: 'beta\n', replace: '' }]), { source: 'alpha\ngamma\nDELTA\n', spans: [{ start: 6, end: 11 }, { start: 17, end: 22 }] });
  // Adjacent spans do not overlap.
  assert.equal(applyEdits('ab', [{ find: 'a', replace: 'A' }, { find: 'b', replace: 'B' }]).source, 'AB');

  const refused = (edits, pattern, text = base) => {
    const result = applyEdits(text, edits);
    assert.ok('reason' in result, `expected a refusal for ${JSON.stringify(edits)}`);
    assert.match(result.reason, pattern);
  };
  refused(undefined, /missing/);
  refused([], /missing/);
  refused(Array.from({ length: MAX_EDITS_PER_CHANGE + 1 }, () => ({ find: 'alpha', replace: 'x' })), /at most 40/);
  refused([{ find: 'alpha' }], /exact text to replace and its replacement/);
  refused([{ find: 3, replace: 'x' }], /exact text to replace/);
  refused(['alpha'], /exact text to replace/);
  refused([{ find: '', replace: 'x' }], /does not say which text/);
  refused([{ find: 'omega', replace: 'x' }], /not in the piece as it was offered/);
  refused([{ find: 'a', replace: 'x' }], /occurs more than once/);
  refused([{ find: 'aa', replace: 'x' }], /occurs more than once/, 'aaa');
  refused([{ find: 'alpha', replace: 'alpha' }], /changes nothing/);
  refused([{ find: 'beta\ngamma', replace: 'x' }, { find: 'gamma\ndelta', replace: 'y' }], /overlap/);
  refused([{ find: 'alpha', replace: 'x' }, { find: 'pha\nbe', replace: 'y' }], /overlap/);
  refused([{ find: 'alpha', replace: '\uD800' }], /not valid text/);
  refused([{ find: 'alpha', replace: 'x'.repeat(20_001) }], /longer than 20000/);
  // Edit 2 is the culprit, and the message names it.
  refused([{ find: 'alpha', replace: 'x' }, { find: 'omega', replace: 'y' }], /^Edit 2:/);

  // A director writes \n; a CRLF piece gets CRLF in both the anchor and the replacement.
  const windows = 'one\r\ntwo\r\nthree\r\n';
  assert.equal(applyEdits(windows, [{ find: 'one\ntwo', replace: 'one\nand two' }]).source, 'one\r\nand two\r\nthree\r\n');
  // A span may not end between \r and \n. (A leading \n is converted to \r\n, so a span cannot begin there.)
  refused([{ find: 'one\r', replace: 'ONE' }], /divide a line ending/, windows);
  refused([{ find: 'two\r', replace: 'x' }], /divide a line ending/, 'one\ntwo\r\n');
  assert.equal(applyEdits(windows, [{ find: '\ntwo', replace: '\nTWO' }]).source, 'one\r\nTWO\r\nthree\r\n');
  // A carriage return that ends no line would, at a span's edge, form a CRLF that no diff shows (review finding 3).
  refused([{ find: 'beta', replace: 'BETA\r' }], /carriage return that does not end a line/);
  refused([{ find: 'two', replace: 'T\rWO' }], /carriage return that does not end a line/, windows);
});

test('a proposal that would leave a piece’s text as it is creates no contract and says so', async (context) => {
  const { store, first, firstFile } = await syntheticBook(context);
  const { sources } = await store.scopeContext(first);
  // Two edits that cancel out, and a whole-piece reply that only re-ends its lines (review finding 4).
  for (const change of [
    { edits: [{ find: '# First\n', replace: '# Fir' }, { find: '\nOne line,', replace: 'st\n\nOne line,' }] },
    { source: FIRST.replace(/\n/g, '\r\n') },
  ]) {
    const { changeSet, dropped } = await store.createChangeSet(first, { changes: [{ nodeId: first, ...change }] }, sources);
    assert.equal(changeSet, null, JSON.stringify(change));
    assert.deepEqual(dropped, [{ nodeId: first, reason: 'The proposed change would leave the piece’s text as it is.' }]);
  }
  assert.equal(await readFile(firstFile, 'utf8'), FIRST);
});

/**
 * A synthetic book with one long piece: a byte-order mark, indentation, em
 * spaces, typographic quotes and a character outside the Basic Multilingual
 * Plane on most lines, longer than a whole-piece reply's 20,000-character
 * output budget but within the 60,000 characters a piece conversation offers.
 *
 * @param {import('node:test').TestContext} context
 */
async function longPieceBook(context) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'frige-anchored-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'manuscript', '01'), { recursive: true });
  await writeFile(path.join(root, 'manuscript', 'Programme.md'), '# Programme\n\n- [Long](01/Long.md)\n');
  const lines = ['# Long'];
  for (let index = 1; index <= 1200; index += 1) {
    lines.push(index % 7 === 0 ? '' : `${index % 3 === 0 ? '    ' : ''}${index}. Ælfric’s “line” — 𝔉 ends here`);
  }
  const text = `﻿${lines.join('\n')}\n`;
  const file = path.join(root, 'manuscript', '01', 'Long.md');
  await writeFile(file, text);
  const store = new ProjectStore(root);
  const graph = await store.initialize();
  return { store, file, text, node: graph.readingOrder[0] };
}

test('a localized edit to a long piece is proposed without the whole piece, and written and rolled back byte-exact', async (context) => {
  const { store, file, text, node } = await longPieceBook(context);
  assert.ok(text.length > 20_000 && text.length < 60_000, `fixture length ${text.length}`);
  const original = await readFile(file);
  const { sources, withheld } = await store.scopeContext(node);
  assert.deepEqual(withheld, [], 'the long piece is offered whole');

  const edits = [
    { find: '600. Ælfric’s “line” — 𝔉 ends here', replace: '600. Ælfric’s revised “line” — 𝔉 ends here' },
    { find: '    1194. Ælfric’s “line”', replace: '    1194. Ælfric’s “last line”' },
  ];
  const { changeSet, dropped } = await store.createChangeSet(node, { commentary: 'Two localized revisions.', changes: [{ nodeId: node, edits, summary: 'Revise two lines.' }] }, sources);
  assert.deepEqual(dropped, []);
  const [change] = changeSet.changes;
  assert.equal(change.kind, 'replace-node-source');
  assert.equal(change.before, sources[0].source, 'the contract records the exact prior text');
  assert.deepEqual(change.lines, { before: 1201, after: 1201, added: 2, removed: 2 });
  assert.deepEqual(await readFile(file), original, 'nothing is written before acceptance');

  await store.decideChanges(node, changeSet.id, { decision: 'accept' });
  const written = await readFile(file);
  const expected = Buffer.from(text.replace(edits[0].find, edits[0].replace).replace(edits[1].find, edits[1].replace));
  assert.deepEqual(written, expected);
  // Every byte before the first span and after the last is the original's.
  const firstSpan = original.indexOf(Buffer.from(edits[0].find));
  const lastSpanEnd = original.indexOf(Buffer.from(edits[1].find)) + Buffer.byteLength(edits[1].find);
  assert.deepEqual(written.subarray(0, firstSpan), original.subarray(0, firstSpan), 'the byte-order mark and every line before the first edit are untouched');
  assert.deepEqual(written.subarray(written.length - (original.length - lastSpanEnd)), original.subarray(lastSpanEnd), 'every byte after the last edit is untouched');

  await store.revertChanges(changeSet.id);
  assert.deepEqual(await readFile(file), original, 'rollback restores the exact prior bytes');
});

test('an anchored edit that cannot be placed exactly proposes nothing and writes nothing', async (context) => {
  const { store, first, firstFile } = await syntheticBook(context);
  const { sources } = await store.scopeContext(first);
  const attempt = (change) => store.createChangeSet(first, { commentary: 'r', changes: [{ nodeId: first, ...change }] }, sources);

  for (const [change, pattern] of [
    [{ edits: [{ find: 'Not in the piece', replace: 'x' }] }, /not in the piece as it was offered/],
    [{ edits: [{ find: 'n', replace: 'N' }] }, /occurs more than once/],
    [{ edits: [{ find: 'One line,', replace: 'x' }, { find: 'line,\n  one', replace: 'y' }] }, /overlap/],
    [{ edits: 'One line, => x' }, /missing/],
    [{ source: `${FIRST}\nWhole.\n`, edits: [{ find: 'One line,', replace: 'x' }] }, /either the whole new text or edits/],
  ]) {
    const { changeSet, dropped } = await attempt(change);
    assert.equal(changeSet, null, JSON.stringify(change));
    assert.equal(dropped.length, 1); assert.equal(dropped[0].nodeId, first); assert.match(dropped[0].reason, pattern);
  }
  assert.equal(await readFile(firstFile, 'utf8'), FIRST);
  assert.equal(await store.changeSet(first), null, 'no contract is current for the piece');
  assert.deepEqual(await store.contracts(), []);
});

test('an anchored edit keeps a piece’s mixed line endings outside its span', async (context) => {
  const { store, first, firstFile } = await syntheticBook(context);
  const mixed = '# First\r\n\r\nOne line,\n  one indented — with Unicode.\r\nLast.\n';
  const node = await store.node(first);
  await store.updateNode(first, mixed, node.hash);
  const { sources } = await store.scopeContext(first);
  const { changeSet } = await store.createChangeSet(first, { changes: [{ nodeId: first, edits: [{ find: 'Last.', replace: 'Last of all.' }] }] }, sources);
  await store.decideChanges(first, changeSet.id, { decision: 'accept' });
  // A whole-piece reply would have been converted to CRLF throughout; anchored edits touch only their span.
  assert.equal(await readFile(firstFile, 'utf8'), '# First\r\n\r\nOne line,\n  one indented — with Unicode.\r\nLast of all.\n');
});

test('an anchored edit is stale, and writes nothing, once the piece changes after the proposal', async (context) => {
  const { store, first, firstFile } = await syntheticBook(context);
  const { sources } = await store.scopeContext(first);
  const { changeSet } = await store.createChangeSet(first, { changes: [{ nodeId: first, edits: [{ find: 'One line,', replace: 'A single line,' }] }] }, sources);
  const byHand = `${FIRST}Added by hand.\n`;
  await store.updateNode(first, byHand, sources[0].hash);
  const decided = await store.decideChanges(first, changeSet.id, { decision: 'accept' });
  assert.equal(decided.changes[0].status, 'stale');
  assert.equal(await readFile(firstFile, 'utf8'), byHand, 'the author’s edit is not overwritten, even though the anchor text is still present');
});

test('anchored edits to several pieces form one contract that is accepted all-or-nothing', async (context) => {
  const { store, first, second, section } = await twoPieceContract(context);
  const { sources } = await store.scopeContext(section.id);
  const { changeSet, dropped } = await store.createChangeSet(section.id, { changes: [
    { nodeId: first, edits: [{ find: 'One line,', replace: 'One line, revised,' }] },
    { nodeId: second, edits: [{ find: 'Two.', replace: 'Two, revised.' }] },
    { nodeId: second, edits: [{ find: 'Two.', replace: 'Again.' }] },
  ] }, sources);
  assert.deepEqual(dropped.map((entry) => entry.reason), ['Only one change per node is kept.']);
  assert.deepEqual(changeSet.changes.map((change) => change.nodeId), [first, second]);
  await store.decideChanges(section.id, changeSet.id, { decision: 'accept' });
  assert.equal((await store.node(first)).source, FIRST.replace('One line,', 'One line, revised,'));
  assert.equal((await store.node(second)).source, SECOND.replace('Two.', 'Two, revised.'));
});

// --- Selected passages (Frige interface wave, increment 1) ----------------------
//
// The workstation sends a selection in the editor's coordinates (every line
// ending one `\n`); the engine maps it to the canonical bytes, checks the text
// is exactly what was selected, and limits any proposal to it.

test('a selected passage resolves to the canonical bytes it covers, in the editor’s coordinates', () => {
  const source = '﻿# Title\r\n\r\nThe river ran.\r\n  The river ran again — 𝔉.\r\nA bell.\r\n';
  const editor = source.replace(/\r\n?/g, '\n');
  const text = '  The river ran again — 𝔉.\n';
  const start = editor.indexOf(text); const end = start + text.length;
  const resolved = resolvePassage(source, { start, end, text });
  // The passage keeps its CRLF and its line, and maps past every CRLF before it.
  assert.equal(resolved.text, '  The river ran again — 𝔉.\r\n');
  assert.equal(source.slice(resolved.start, resolved.end), resolved.text);
  assert.deepEqual([resolved.startLine, resolved.endLine], [4, 4], 'a passage that ends with its line break ends on that line');
  const across = resolvePassage(source, { start: editor.indexOf('ran.'), end: editor.indexOf('A bell') + 1, text: editor.slice(editor.indexOf('ran.'), editor.indexOf('A bell') + 1) });
  assert.deepEqual([across.startLine, across.endLine], [3, 5]);
  // A lone carriage return is one editor character too.
  assert.equal(resolvePassage('a\rb\nc', { start: 2, end: 3, text: 'b' }).text, 'b');

  const refused = (selection, pattern) => { const result = resolvePassage(source, selection); assert.ok('reason' in result, JSON.stringify(selection)); assert.match(result.reason, pattern); };
  refused({ start: 3, end: 3, text: '' }, /no valid range/);
  refused({ start: -1, end: 2, text: 'ab' }, /no valid range/);
  refused({ start: 1.5, end: 3, text: 'ab' }, /no valid range/);
  refused({ start, end, text: text.replace('river', 'rivet') }, /no longer at that place/);
  refused({ start, end, text: text.replace('river', 'stream') }, /match its range/);
  refused({ start: start + 1, end: end + 1, text }, /no longer at that place/);
  refused({ start: editor.length - 1, end: editor.length + 1, text: 'xx' }, /past the end/);
  refused({ start: 0, end: 2, text: 'abc' }, /match its range/);
  refused({ start: 0, end: 1, text: '\uD800' }, /not valid text/);
  refused({ start: 0, end: 12_001, text: 'x'.repeat(12_001) }, /under 12000/);
});

test('a change is inside a passage only when every byte outside it is unchanged', () => {
  const before = 'one\ntwo\nthree\n';
  const range = { start: 4, end: 8 }; // "two\n"
  assert.equal(changedOnlyWithin(before, 'one\nTWO\nthree\n', range), true);
  assert.equal(changedOnlyWithin(before, 'one\ntwo, and more\nthree\n', range), true);
  assert.equal(changedOnlyWithin(before, 'one\nthree\n', range), true, 'deleting the passage is inside it');
  assert.equal(changedOnlyWithin(before, 'one\nextra\ntwo\nthree\n', range), true, 'inserting at its edge is inside it');
  assert.equal(changedOnlyWithin(before, 'ONE\ntwo\nthree\n', range), false);
  assert.equal(changedOnlyWithin(before, 'one\ntwo\nthree!\n', range), false);
  assert.equal(changedOnlyWithin(before, 'one\n', range), false, 'removing text after the passage is outside it');
});

test('within a passage, an anchor is looked for only there, so a phrase repeated elsewhere can still anchor', () => {
  const base = 'The river ran.\nThe river ran again.\nThe river ran.\n';
  const within = { start: 15, end: 36 }; // "The river ran again.\n"
  assert.equal(applyEdits(base, [{ find: 'The river ran', replace: 'The stream ran' }], { within }).source, 'The river ran.\nThe stream ran again.\nThe river ran.\n');
  assert.match(applyEdits(base, [{ find: 'river ran.', replace: 'x' }], { within }).reason, /not in the selected passage/);
  assert.match(applyEdits('aXaYa', [{ find: 'a', replace: 'b' }], { within: { start: 0, end: 3 } }).reason, /more than once in the selected passage/);
});

test('a turn about a selected passage may propose changes only inside it', async (context) => {
  const { store, first, second, section } = await twoPieceContract(context);
  const { sources } = await store.scopeContext(section.id);
  const base = sources.find((entry) => entry.nodeId === first).source;
  const passage = 'One line,';
  const bounds = { nodeId: first, start: base.indexOf(passage), end: base.indexOf(passage) + passage.length };
  const propose = (proposal) => store.createChangeSet(section.id, { commentary: 'r', ...proposal, bounds }, sources);

  const inside = await propose({ changes: [{ nodeId: first, edits: [{ find: 'line', replace: 'verse' }] }] });
  assert.equal(inside.changeSet.changes[0].source, base.replace('One line,', 'One verse,'));
  for (const [proposal, pattern] of [
    [{ changes: [{ nodeId: first, edits: [{ find: 'one indented', replace: 'x' }] }] }, /not in the selected passage/],
    [{ changes: [{ nodeId: first, source: `${base}Appended.\n` }] }, /reached outside it/],
    [{ changes: [{ nodeId: second, source: `${SECOND}More.\n` }] }, /reached outside it/],
    [{ layout: { set: { fontSize: '12pt', leading: '14pt' } } }, /layout change was set aside/],
  ]) {
    const { changeSet, dropped } = await propose(proposal);
    assert.equal(changeSet, null, JSON.stringify(proposal)); assert.match(dropped[0].reason, pattern);
  }
  // A whole-text reply that changes only the passage is kept.
  const whole = await propose({ changes: [{ nodeId: first, source: base.replace('One line,', 'A single line,') }] });
  assert.equal(whole.changeSet.changes[0].source, base.replace('One line,', 'A single line,'));
});
