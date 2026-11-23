/** Frige's project-owned source revision and editorial decision journal. */
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { sourceHash, writeAtomic } from './project-store.mjs';

const schemaVersion = 'stex.frige.editorial.v1';
const hashPattern = /^[a-f0-9]{64}$/;
const nodePattern = /^node-[a-f0-9]{20}$/;
const uuidPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const isId = (value) => typeof value === 'string' && uuidPattern.test(value);
const isHash = (value) => typeof value === 'string' && hashPattern.test(value);
const isDate = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value));
const summaries = Object.freeze({
  baseline: 'Recorded the existing source.',
  observed: 'Recorded source that changed outside the revision journal.',
  save: 'Saved Markdown.',
  restore: 'Restored an earlier revision.',
});
const unavailable = () => Object.assign(new Error('The editorial journal is unavailable. Manuscript history could not be verified.'), { code: 'EDITORIAL_UNAVAILABLE', status: 503 });
const invalid = (message) => Object.assign(new Error(message), { code: 'INVALID_EDITORIAL_REQUEST', status: 400 });
const missing = () => Object.assign(new Error('Revision or page cursor not found for this piece.'), { code: 'REVISION_NOT_FOUND', status: 404 });
const stale = () => Object.assign(new Error('This source revision changed. Reload the piece and its history before continuing.'), { code: 'STALE_SOURCE', status: 409 });
const author = { role: 'author' };
const unattributed = { role: 'unattributed' };
const now = () => new Date().toISOString();
const emptyPiece = () => ({ revisions: [], decisions: [] });

/** Rejects linked, non-regular and out-of-project paths. */
export async function editorialPath(root, file, { directory = false, optional = false } = {}) {
  const relative = path.relative(root, file);
  if (!relative || path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) throw unavailable();
  const info = await lstat(file).catch((error) => {
    if (optional && error.code === 'ENOENT') return null;
    if (error.code === 'ENOENT') throw error;
    throw unavailable();
  });
  if (!info) return false;
  if (info.isSymbolicLink() || !(directory ? info.isDirectory() : info.isFile())) throw unavailable();
  const resolvedRoot = await realpath(root);
  if ((await lstat(root)).isSymbolicLink() || path.relative(path.resolve(resolvedRoot, relative), await realpath(file))) throw unavailable();
  return true;
}

function validRevision(record, parentId, ids) {
  if (!record || !Object.hasOwn(summaries, record.kind)) return false;
  const observed = record.kind === 'baseline' || record.kind === 'observed';
  return isId(record.id) && !ids.has(record.id) && isHash(record.hash)
    && record.parentId === parentId && (record.kind === 'baseline') === (parentId === null) && ids.get(parentId) !== record.hash
    && isDate(record.at) && record.provenance?.role === (observed ? 'unattributed' : 'author')
    && record.summary === summaries[record.kind]
    && (record.kind === 'restore' ? ids.get(record.restoredFrom) === record.hash : record.restoredFrom === undefined);
}

function validDecisionReason(reason) {
  return typeof reason === 'string' && reason.isWellFormed() && reason.length <= 4000 && Boolean(reason.trim());
}

function validateJournal(journal) {
  if (journal?.schemaVersion !== schemaVersion || !journal.pieces || typeof journal.pieces !== 'object' || Array.isArray(journal.pieces)) throw unavailable();
  const revisions = new Map();
  for (const [id, piece] of Object.entries(journal.pieces)) {
    if (!nodePattern.test(id) || !Array.isArray(piece?.revisions) || !Array.isArray(piece.decisions)) throw unavailable();
    const ids = new Map();
    let parentId = null;
    for (const record of piece.revisions) {
      if (!validRevision(record, parentId, ids)) throw unavailable();
      ids.set(record.id, record.hash);
      parentId = record.id;
    }
    const decisions = new Set();
    for (const decision of piece.decisions) {
      if (!isId(decision?.id) || decisions.has(decision.id) || !ids.has(decision.revisionId)
        || decision.provenance?.role !== 'author' || !isDate(decision.at) || !validDecisionReason(decision.reason)) throw unavailable();
      decisions.add(decision.id);
    }
    revisions.set(id, ids);
  }
  if (journal.pending === null) return;
  const { nodeId, event } = journal.pending || {};
  const head = revisions.has(nodeId) && journal.pieces[nodeId].revisions.at(-1);
  if (!head || !['save', 'restore'].includes(event?.kind) || !validRevision(event, head.id, revisions.get(nodeId)) || event.hash === head.hash) throw unavailable();
}

function makeRevision(kind, hash, head, restoredFrom) {
  const provenance = kind === 'save' || kind === 'restore' ? author : unattributed;
  return { id: randomUUID(), parentId: head?.id ?? null, hash, kind, at: now(), summary: summaries[kind], provenance, ...(restoredFrom ? { restoredFrom } : {}) };
}

function pageOf(records, before = null) {
  const index = before === null ? records.length : records.findIndex((record) => record.id === before);
  if (index < 0) throw missing();
  const start = Math.max(0, index - 50);
  const entries = records.slice(start, index).reverse();
  return { entries, nextBefore: start ? entries.at(-1).id : null };
}

/** Atomic metadata and content-addressed snapshots. Callers own the project write queue. */
export class EditorialJournal {
  constructor(root, stateDirectory) {
    this.root = root;
    this.stateDirectory = stateDirectory;
    this.directory = path.join(stateDirectory, 'editorial');
    this.file = path.join(this.directory, 'journal.json');
    this.snapshots = path.join(this.directory, 'snapshots');
  }

  async load() {
    if (!(await editorialPath(this.root, this.directory, { directory: true, optional: true }))) return { schemaVersion, pieces: {}, pending: null };
    if (!(await editorialPath(this.root, this.file, { optional: true }))) return { schemaVersion, pieces: {}, pending: null };
    try {
      const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
      const journal = JSON.parse(decoder.decode(await readFile(this.file)));
      validateJournal(journal);
      return journal;
    } catch { throw unavailable(); }
  }

  async #save(journal) {
    try {
      await editorialPath(this.root, this.stateDirectory, { directory: true });
      await mkdir(this.directory, { recursive: true });
      await editorialPath(this.root, this.directory, { directory: true });
      await editorialPath(this.root, this.file, { optional: true });
      await writeAtomic(this.file, `${JSON.stringify(journal)}\n`);
    } catch { throw unavailable(); }
  }

  async #snapshot(hash, optional = false) {
    if (!isHash(hash)) throw unavailable();
    const file = path.join(this.snapshots, `${hash}.md`);
    try {
      if (!(await editorialPath(this.root, file, { optional }))) return null;
      const bytes = await readFile(file);
      const source = bytes.toString('utf8');
      if (!Buffer.from(source, 'utf8').equals(bytes) || sourceHash(bytes) !== hash) throw unavailable();
      return source;
    } catch { throw unavailable(); }
  }

  async #retain(hash, source) {
    if (await this.#snapshot(hash, true) !== null) return;
    try {
      await editorialPath(this.root, this.stateDirectory, { directory: true });
      await mkdir(this.directory, { recursive: true });
      await editorialPath(this.root, this.directory, { directory: true });
      await mkdir(this.snapshots, { recursive: true });
      await editorialPath(this.root, this.snapshots, { directory: true });
      await writeAtomic(path.join(this.snapshots, `${hash}.md`), source);
    } catch { throw unavailable(); }
  }

  async #observe(journal, node) {
    const piece = journal.pieces[node.id] ??= emptyPiece();
    const head = piece.revisions.at(-1);
    if (head?.hash === node.hash) {
      await this.#snapshot(head.hash);
      return head;
    }
    await this.#retain(node.hash, node.source);
    const event = makeRevision(head ? 'observed' : 'baseline', node.hash, head);
    piece.revisions.push(event);
    return event;
  }

  /** Records the before and after bytes and the intent before the source is written. */
  async prepare(journal, node, source, restoredFrom) {
    const head = await this.#observe(journal, node);
    const hash = sourceHash(source);
    await this.#retain(hash, source);
    const event = makeRevision(restoredFrom ? 'restore' : 'save', hash, head, restoredFrom);
    journal.pending = { nodeId: node.id, event };
    await this.#save(journal);
    return event;
  }

  /** Settles the intent once. A later or absent source is never overwritten. */
  async settle(journal, currentHash) {
    const { nodeId, event } = journal.pending;
    if (currentHash === event.hash) {
      const piece = journal.pieces[nodeId];
      await this.#snapshot(piece.revisions.at(-1).hash);
      await this.#snapshot(event.hash);
      piece.revisions.push(event);
    }
    journal.pending = null;
    await this.#save(journal);
  }

  listing(journal, node, before) {
    const revisions = journal.pieces[node.id]?.revisions ?? [];
    const head = revisions.at(-1);
    return { schemaVersion, nodeId: node.id, currentHash: node.hash, currentRevisionId: head?.hash === node.hash ? head.id : null, ...pageOf(revisions, before) };
  }

  checkBase(journal, node, payload) {
    const { baseHash, baseRevisionId } = payload ?? {};
    if (!isHash(baseHash) || (baseRevisionId !== null && !isId(baseRevisionId))) throw invalid('Supply the current source hash and revision id, or null when no revision describes it.');
    const head = journal.pieces[node.id]?.revisions.at(-1);
    const currentId = head?.hash === node.hash ? head.id : null;
    if (baseHash !== node.hash || baseRevisionId !== currentId) throw stale();
  }

  async revision(journal, nodeId, id) {
    const event = journal.pieces[nodeId]?.revisions.find((entry) => entry.id === id);
    if (!event) throw missing();
    return { schemaVersion, nodeId, ...event, source: await this.#snapshot(event.hash) };
  }

  decisions(journal, nodeId, before) {
    return { schemaVersion, nodeId, ...pageOf(journal.pieces[nodeId]?.decisions ?? [], before) };
  }

  async decision(journal, node, payload) {
    const { reason } = payload ?? {};
    if (!validDecisionReason(reason)) throw invalid('An editorial decision needs a reason of 1 to 4,000 characters.');
    this.checkBase(journal, node, payload);
    const revision = await this.#observe(journal, node);
    const decisions = journal.pieces[node.id].decisions;
    const trimmed = reason.trim();
    const existing = decisions.find((entry) => entry.revisionId === revision.id && entry.reason === trimmed);
    if (existing) return { schemaVersion, nodeId: node.id, ...existing };
    const record = { id: randomUUID(), at: now(), revisionId: revision.id, reason: trimmed, provenance: author };
    decisions.push(record);
    await this.#save(journal);
    return { schemaVersion, nodeId: node.id, ...record };
  }
}
