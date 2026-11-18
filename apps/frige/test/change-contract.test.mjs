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
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ProjectStore, sourceHash } from '../src/project-store-vault.mjs';
import { buildBook } from '../src/book-assembler.mjs';
import { CHANGE_CONTRACT, conflictsWith, isContractId, lineStats, proofFor } from '../src/change-contract.mjs';

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

test('conflicts name undecided changes to the same piece in other conversations only', () => {
  const records = [
    { id: 'c1', scopeId: 'scope-x', changes: [{ nodeId: 'node-a', status: 'pending' }, { nodeId: 'node-b', status: 'accepted' }] },
    { id: 'c2', scopeId: 'node-a', changes: [{ nodeId: 'node-a', status: 'pending' }] },
  ];
  assert.deepEqual(conflictsWith(records, ['node-a', 'node-b'], 'node-a'), [{ contractId: 'c1', scopeId: 'scope-x', nodeId: 'node-a' }]);
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
  assert.deepEqual(inSection.conflicts, [{ contractId: inPiece.id, scopeId: first, nodeId: first }]);
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

const SCHEMA_KEYWORDS = new Set(['$schema', '$id', 'title', 'description', 'type', 'required', 'properties', 'additionalProperties', 'enum', 'const', 'items', 'pattern', 'maxLength', 'minimum']);

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
  if ('const' in schema && value !== schema.const) found.push(`${at}: expected ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.includes(value)) found.push(`${at}: not one of ${JSON.stringify(schema.enum)}`);
  if (schema.type && ![schema.type].flat().includes(typeOf(value))) return [...found, `${at}: expected ${schema.type}, got ${typeOf(value)}`];
  if (typeof value === 'string') {
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) found.push(`${at}: does not match ${schema.pattern}`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) found.push(`${at}: longer than ${schema.maxLength}`);
  }
  if (typeof value === 'number' && schema.minimum !== undefined && value < schema.minimum) found.push(`${at}: below ${schema.minimum}`);
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
