/** Frige publishing engine source that owns book source, graph, editorial transactions and proof metadata. */
import { createHash, randomUUID } from 'node:crypto';
import { access, copyFile, mkdir, open, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { writeAtomic } from './project-store.mjs';
import { parseManuscript } from './document/parser.mjs';
import { designHash, normalizeDesign, resolveLayout, validateDesign } from './design-settings.mjs';
import { EditorialJournal, editorialPath } from './editorial-journal.mjs';
import { CONTRACT_SCHEMA_VERSION, LAYOUT_CHANGE, applyEdits, buildChange, changedOnlyWithin, buildContract, conflictsWith, hasPending, isContractId, isContractRecord, proofFor, proofStrength, sameTextIgnoringLineEndings, summarizeContract, supersede } from './change-contract.mjs';

const MAX_SOURCE = 400_000;
/** Most contracts a history listing returns; the journal itself is not truncated. */
const MAX_LISTED_CONTRACTS = 200;
/**
 * Most UTF-8 bytes of book outline offered with a turn. The inference service
 * counts a turn's whole context in bytes against its own budget (96,000), and
 * its adapter trims the outline further if the scope's sources and recent turns
 * leave less room; the contract records what was actually forwarded.
 */
const OUTLINE_BUDGET = 20_000;
/** Most accepted contracts offered with a turn as approved context. */
const MAX_APPROVED_CONTRACTS = 8;
const SCOPE_SOURCE_BUDGET = 60_000;
const NODE_ID = /^[a-z][a-z0-9-]{5,80}$/;
/** Computes the exact source revision digest. */
export const sourceHash = (value) => createHash('sha256').update(value, 'utf8').digest('hex');
/** Generates a stable identifier for a manuscript source node. */
const nodeIdFor = (relativePath) => `node-${sourceHash(relativePath.replaceAll('\\', '/').toLowerCase()).slice(0, 20)}`;

/** Checks whether the requested local path is accessible. */
async function exists(file) { try { await access(file, constants.F_OK); return true; } catch { return false; } }

/**
 * Reads a JSON state file.
 *
 * @param {string} file
 * @returns {Promise<any | null>}  `null` when the file does not exist. A file that
 *   exists but cannot be read or parsed throws, so damage is never mistaken for absence.
 */
async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

/**
 * Reads a JSON state file whose damage the caller can safely treat as
 * absence: a missing file and unparsable content both return `null`. Any
 * other failure (a lock held by a sync client or scanner, a permission error)
 * throws, because acting on a file that exists but could not be read can
 * orphan the record it holds.
 *
 * @param {string} file
 * @returns {Promise<any | null>}
 */
async function readJsonIfUsable(file) {
  try {
    return await readJson(file);
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

/**
 * Builds an error the HTTP layer can classify by `code` without parsing messages.
 *
 * @param {string} message  Safe to show to the author.
 * @param {string} code
 * @returns {Error & { code: string }}
 */
const codedError = (message, code) => Object.assign(new Error(message), { code });

function validateSourceWrite(source, baseHash) {
  if (typeof source !== 'string' || source.length > MAX_SOURCE) throw new Error('Source must be Markdown under 400 KB.');
  if (!source.isWellFormed()) throw codedError('Markdown source must be valid Unicode text.', 'INVALID_SOURCE');
  if (typeof baseHash !== 'string' || !baseHash) throw codedError('A save must carry the base hash of the text it replaces. Reload this piece and save again.', 'BASE_HASH_REQUIRED');
}

/**
 * The line a thread shows for one decided, superseded or rolled-back change.
 *
 * @param {{ nodeId: string, title: string, status: string, baseHash: string, afterHash: string }} change
 */
const decisionOf = (change) => ({ nodeId: change.nodeId, title: change.title, status: change.status, beforeHash: change.baseHash, afterHash: change.afterHash });

/** Piece kinds that open on a recto when the book's `rectoOpeners` rule is on. */
const OPENER_KINDS = ['front-matter', 'section-note', 'cycle-note'];

/**
 * The layout target of a conversation: a piece in the reading order is its own
 * target; a section's target is its folder, which covers every run of that
 * folder in the reading order. The whole book has no target.
 *
 * @param {{ readingOrder: string[], book: { sections: Array<{ folder: string, nodeIds: string[], anchorNodeId: string, title: string }> } }} graph
 * @param {{ id: string, kind: string, folder?: string }} scope
 * @returns {{ level: 'section' | 'node', field: 'sections' | 'nodes', key: string, nodeId: string | null, sectionKey: string | null, section: object | undefined, pieces: string[] } | null}
 */
function layoutTargetOf(graph, scope) {
  if (scope.kind === 'node' && graph.readingOrder.includes(scope.id)) {
    const section = graph.book.sections.find((entry) => entry.nodeIds.includes(scope.id));
    return { level: 'node', field: 'nodes', key: scope.id, nodeId: scope.id, sectionKey: section?.folder || null, section, pieces: [scope.id] };
  }
  if (scope.kind !== 'book' && scope.kind !== 'node' && scope.folder) {
    const runs = graph.book.sections.filter((entry) => entry.folder === scope.folder);
    return { level: 'section', field: 'sections', key: scope.folder, nodeId: null, sectionKey: scope.folder, section: runs[0], pieces: runs.flatMap((entry) => entry.nodeIds) };
  }
  return null;
}

/**
 * What applies to a layout target without its own override, as the assembler
 * would decide it. The recto opening assumes the section's first piece prints;
 * a note-only first piece hands the opening to the next piece when typeset.
 *
 * @param {{ nodes: Array<{ id: string, kind: string, title: string }> }} graph
 * @param {object} profile  The publication profile without the target's override.
 * @param {ReturnType<typeof layoutTargetOf>} target
 * @returns {{ fontSize: string, leading: string, sizeFrom: string, opensRecto: boolean, headText: string | null }}
 */
function inheritedLayout(graph, profile, target) {
  const resolved = resolveLayout(profile, { sectionKey: target.sectionKey, nodeId: target.nodeId });
  /** Selects the book-level layout defaults for the current node. */
  const bookRule = (kind) => Boolean(normalizeDesign(profile).rectoOpeners && OPENER_KINDS.includes(kind));
  /** Finds the applicable layout record for a node. */
  const nodeOf = (id) => graph.nodes.find((node) => node.id === id);
  const anchor = target.section ? nodeOf(target.section.anchorNodeId) : null;
  if (target.level === 'node') {
    const opensSection = target.section?.anchorNodeId === target.nodeId;
    const opensRecto = (opensSection ? resolved.sectionOpensRecto : undefined) ?? bookRule(nodeOf(target.nodeId)?.kind);
    return { fontSize: resolved.fontSize, leading: resolved.leading, sizeFrom: resolved.sizeFrom, opensRecto, headText: null };
  }
  // A section's head is its opener's own heading when it opens with a section note, else its title.
  const headText = anchor?.kind === 'section-note' ? anchor.title : target.section?.title || null;
  return { fontSize: resolved.fontSize, leading: resolved.leading, sizeFrom: resolved.sizeFrom, opensRecto: bookRule(anchor?.kind), headText };
}
/** Accepts a bounded relative path under the selected project. */
function safeRelative(value) {
  const normalized = String(value || '').replaceAll('\\', '/').replace(/^\/+/, '');
  if (!normalized || normalized.split('/').some((part) => part === '..' || !part)) throw new Error('Invalid project-relative path.');
  return normalized;
}
/** Checks whether a candidate resolves inside the selected root. */
function contained(root, relative) {
  const resolved = path.resolve(root, safeRelative(relative));
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) throw new Error('Path escapes the project.');
  return resolved;
}
/** Derives the displayed label from manuscript source or its filename. */
function titleOf(source, fallback) {
  const heading = /^#{1,3}\s+(.+)$/m.exec(source)?.[1]?.trim();
  return heading || fallback.replace(/\.md$/i, '').replaceAll(/[-_]/g, ' ');
}
/** Classifies a manuscript node for navigation and layout. */
function kindOf(relative) {
  const name = path.posix.basename(relative).toLowerCase();
  const folders = relative.toLowerCase();
  if (name === 'programme.md') return 'programme';
  if (folders.includes('front_matter') || folders.includes('front-matter')) return 'front-matter';
  if (folders.includes('back_matter') || folders.includes('back-matter')) return 'back-matter';
  if (name.includes('section_note') || name.includes('section note')) return 'section-note';
  if (name.includes('cycle_note') || name.includes('cycle note')) return 'cycle-note';
  return 'poem';
}
/** Finds eligible manuscript Markdown files for graph construction. */
async function markdownFiles(root, prefix = '') {
  const entries = await readdir(root, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const relative = `${prefix}${entry.name}`;
    if (entry.isDirectory()) result.push(...await markdownFiles(path.join(root, entry.name), `${relative}/`));
    if (entry.isFile() && /\.md$/i.test(entry.name)) result.push(relative.replaceAll('\\', '/'));
  }
  return result.sort((a, b) => a.localeCompare(b));
}
/** Resolves the ordered source references in the book programme. */
function programmeLinks(source, programmePath) {
  const links = [];
  const base = path.posix.dirname(programmePath);
  const matcher = /!?\[[^\]]*\]\((?:<([^>]+)>|([^\s)]+))(?:\s+[^)]*)?\)|\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]+)?\]\]/g;
  for (const match of source.matchAll(matcher)) {
    let target = (match[1] || match[2] || match[3] || '').replace(/^<|>$/g, '').split('#')[0];
    if (!target || /^(https?:|mailto:)/i.test(target)) continue;
    if (!/\.md$/i.test(target)) target += '.md';
    const resolved = path.posix.normalize(path.posix.join(base === '.' ? '' : base, target)).replace(/^\.\//, '');
    links.push(resolved);
  }
  return links;
}
/** Creates diagnostics for the current source graph. */
function diagnosticsFor(relative, source) {
  const diagnostics = [];
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(source)) diagnostics.push({ code: 'control-characters', nodePath: relative, message: 'Invisible control characters are present; the proof omits them.' });
  // Editorial sections print as footnotes; one without reviewer comments prints nothing.
  const emptyNotes = parseManuscript(source).blocks.filter((block) => block.type === 'note' && !block.entries.length).length;
  if (emptyNotes) diagnostics.push({ code: 'empty-editorial-note', nodePath: relative, message: 'An Editorial section has no reviewer comments in the expected form (**Name — score** followed by > quotes), so no footnote prints for it.' });
  return diagnostics;
}

/** Returns a string value in the form expected by this boundary. */
const text = (value) => typeof value === 'string' && value.length > 0;
/** Reports unsupported artifact metadata before any part is saved. */
function partShapeProblem(part) {
  if (!part || typeof part !== 'object') return 'A part must be an object.';
  if (part.type === 'text') return text(part.text) ? null : 'A text part needs text.';
  if (part.type === 'artifact') return ['code', 'document', 'data', 'image'].includes(part.kind) && typeof part.content === 'string' && text(part.title) ? null : 'An artifact needs a kind, a title and content.';
  if (part.type === 'choice') return text(part.id) && text(part.prompt) && Array.isArray(part.options) && part.options.length >= 2 && part.options.every((option) => text(option?.id) && text(option?.label)) ? null : 'A choice needs an id, a prompt and labelled options.';
  if (part.type === 'form') return text(part.id) && Array.isArray(part.fields) && part.fields.length > 0 && part.fields.every((field) => text(field?.id) && text(field?.label) && ['text', 'textarea', 'select', 'number', 'checkbox'].includes(field.kind) && (field.kind !== 'select' || (Array.isArray(field.options) && field.options.every(text)))) ? null : 'A form needs an id and labelled fields of known kinds.';
  return 'Unknown part type.';
}

// The declared type of an image must match its file signature.
/** Identifies a supported binary image signature. */
function imageSignature(bytes) {
  if (bytes.length > 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length > 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (bytes.length > 6 && /^GIF8[79]a$/.test(bytes.toString('ascii', 0, 6))) return 'image/gif';
  return null;
}

/** Creates the structured refusal for an invalid review answer. */
const invalidAnswer = (message) => Object.assign(new Error(message), { code: 'INVALID_ANSWER' });
// Normalizes an answer against its prompt and writes the readable summary sent to Hermes.
/** Resolves the answer record associated with the reviewed input. */
function answerFor(prompt, values) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) throw invalidAnswer('An answer must be an object.');
  if (prompt.type === 'choice') {
    const selected = Array.isArray(values.selected) ? [...new Set(values.selected)] : [];
    const other = typeof values.other === 'string' ? values.other.trim().slice(0, 500) : '';
    if (selected.some((id) => !prompt.options.some((option) => option.id === id))) throw invalidAnswer('That option is not one of the choices.');
    if (other && !prompt.allowOther) throw invalidAnswer('This question does not take another answer.');
    if (!selected.length && !other) throw invalidAnswer('Choose an option.');
    if (!prompt.multiple && selected.length + (other ? 1 : 0) > 1) throw invalidAnswer('Choose one option.');
    const labels = selected.map((id) => prompt.options.find((option) => option.id === id).label);
    return { normalized: { selected, ...(other ? { other } : {}) }, summary: `${prompt.prompt} — ${[...labels, ...(other ? [`Other: ${other}`] : [])].join('; ')}` };
  }
  const normalized = {}; const lines = [];
  for (const key of Object.keys(values)) if (!prompt.fields.some((field) => field.id === key)) throw invalidAnswer(`Unknown field ${key}.`);
  for (const field of prompt.fields) {
    const raw = Object.hasOwn(values, field.id) ? values[field.id] : undefined;
    let value;
    if (field.kind === 'checkbox') value = raw === true;
    else if (field.kind === 'number') { if (raw === '' || raw === undefined || raw === null) value = null; else if (!Number.isFinite(Number(raw))) throw invalidAnswer(`${field.label} must be a number.`); else value = Number(raw); }
    else {
      value = typeof raw === 'string' ? raw.trim().slice(0, field.kind === 'textarea' ? 10_000 : 2_000) : '';
      if (field.kind === 'select' && value && !field.options.includes(value)) throw invalidAnswer(`${field.label} must be one of its options.`);
    }
    if (field.required && (value === '' || value === null || value === false)) throw invalidAnswer(`${field.label} is required.`);
    normalized[field.id] = value;
    if (value !== '' && value !== null) lines.push(`${field.label}: ${field.kind === 'checkbox' ? (value ? 'yes' : 'no') : value}`);
  }
  return { normalized, summary: `${prompt.title || 'Form'} — ${lines.join('; ') || 'no answers'}` };
}

/**
 * A section's stable id for a top-level folder. Folder names are compared
 * without case, as node ids are, so a case-only rename keeps the id. `slot` is
 * 1 for a folder's first id and 2, 3… for further runs of the same folder.
 *
 * @param {string} folder
 * @param {number} slot
 * @returns {string}
 */
const sectionId = (folder, slot) => `section-${createHash('sha256').update(folder.toLowerCase(), 'utf8').digest('hex').slice(0, 16)}${slot > 1 ? `-${slot}` : ''}`;

/**
 * Gives each run of one folder its id, keeping the ids earlier graphs gave.
 * Runs keep the ids of the runs they share the most pieces with, largest
 * overlaps first: the previous graph's runs, then runs remembered from before
 * (so a run that left the book and returns gets its id back, and a lost graph
 * recovers every id). A run of entirely new pieces keeps the id of a previous
 * run whose pieces have all left the book, only when they pair one for one,
 * which keeps a section's id when every piece in it is replaced. Any other run
 * gets an id never issued before, so it never inherits a retired run's
 * conversation or proposals. When runs merge, the records of the runs that
 * lose their id stay with that id until a run holding its pieces returns.
 *
 * @param {string} folder
 * @param {Array<{ nodeIds: string[] }>} runs   This graph's runs of the folder, in reading order.
 * @param {Array<{ id: string, nodeIds: string[] }>} earlier  The previous graph's runs of the folder.
 * @param {Array<{ id: string, nodeIds: string[] }>} [past]  Other ids issued for the folder, with their last pieces.
 * @returns {string[]}  One id per run, in the same order.
 */
function assignRunIds(folder, runs, earlier, past = []) {
  const ids = runs.map(() => null);
  const claimed = new Set();
  /** Checks whether two source runs share enough members to retain identity. */
  const shares = (left, right) => left.nodeIds.filter((id) => right.nodeIds.includes(id)).length;
  // 1. Shared pieces, largest overlaps first across all pairs, so one run's
  //    order in the book cannot let it take a better match from another. On a
  //    tie the previous graph's run wins over a remembered one.
  const pairs = [];
  runs.forEach((run, index) => {
    for (const [rank, candidates] of [earlier, past].entries()) {
      for (const candidate of candidates) { const shared = shares(run, candidate); if (shared) pairs.push({ index, candidate, shared, rank }); }
    }
  });
  pairs.sort((left, right) => right.shared - left.shared || left.rank - right.rank || left.index - right.index);
  for (const { index, candidate } of pairs) {
    if (ids[index] || claimed.has(candidate.id)) continue;
    ids[index] = candidate.id; claimed.add(candidate.id);
  }
  // 2. Runs whose pieces were all replaced: only between runs that share no
  //    pieces with anything on the other side, one for one, in order. A run
  //    whose pieces moved elsewhere is never given to a run of new pieces.
  const freshRuns = runs.map((_, index) => index).filter((index) => !ids[index] && [...earlier, ...past].every((candidate) => !shares(runs[index], candidate)));
  const goneRuns = earlier.filter((candidate) => !claimed.has(candidate.id) && runs.every((run) => !shares(run, candidate)));
  if (freshRuns.length && freshRuns.length === goneRuns.length && freshRuns.length === runs.filter((_, index) => !ids[index]).length) {
    freshRuns.forEach((index, order) => { ids[index] = goneRuns[order].id; claimed.add(goneRuns[order].id); });
  }
  // 3. Fresh ids, never one issued before, so a new run inherits no records.
  const taken = new Set([...earlier, ...past].map((candidate) => candidate.id).concat(ids.filter(Boolean)));
  let slot = 1;
  return ids.map((id) => {
    if (id) return id;
    while (taken.has(sectionId(folder, slot))) slot += 1;
    const fresh = sectionId(folder, slot);
    taken.add(fresh);
    return fresh;
  });
}

/**
 * Derives the book and its sections from the reading order.
 *
 * A section's id comes from its folder (see `sectionId` and `assignRunIds`),
 * so renaming, reordering or replacing its first piece keeps it. Each section
 * also lists `legacyIds`: `scope-<node id>` for every piece it contains, which
 * is the form section ids had before stable ids (named after a section's first
 * piece). Records made under such an id attach to the section that now holds
 * that piece. They are derived each time, so nothing is lost when the graph is
 * rebuilt, and no two sections can share one.
 *
 * @param {string} root
 * @param {Array<{ id: string, relativePath: string, kind: string }>} nodes
 * @param {string[]} readingOrder
 * @param {{ sections?: Array<{ id: string, folder: string, nodeIds?: string[] }> } | null} [prior]
 *   The previous graph's book. Only its stable (`section-…`) ids are carried
 *   forward; without it (and without `remembered`), runs take ids in reading order.
 * @param {Record<string, string[]>} [remembered]  Every section id issued before, with the
 *   pieces it last held, from `.texgraph/section-aliases.json` (see `assignRunIds`).
 * @returns {object}  The book: `{ id: 'book', kind, title, tableOfContentsNodeId, programmeNodeId, nodeIds, anchorNodeId, buildThroughNodeId, sections }`.
 */
function canonicalBook(root, nodes, readingOrder, prior = null, remembered = {}) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const ordered = readingOrder.map((id) => byId.get(id)).filter(Boolean);
  const programme = nodes.find((node) => node.kind === 'programme');
  const sections = [];
  let current = null;
  /** Chooses a section label from the canonical manuscript structure. */
  const sectionName = (node) => {
    const folder = node.relativePath.split('/')[0] || 'Manuscript';
    return folder.replace(/^\d+[_-]?/, '').replaceAll('_', ' ').replaceAll('-', ' ').trim() || 'Manuscript';
  };
  for (const node of ordered) {
    const folder = node.relativePath.split('/')[0] || '';
    if (!current || current.folder !== folder) {
      const title = node.kind === 'front-matter' ? 'Front matter' : node.kind === 'back-matter' ? 'Back matter' : sectionName(node);
      const kind = node.kind === 'back-matter' ? 'back-matter' : node.kind === 'front-matter' ? 'front-matter' : 'section';
      current = { id: null, kind, title, folder, anchorNodeId: node.id, nodeIds: [], buildThroughNodeId: node.id, legacyIds: [] };
      sections.push(current);
    }
    current.nodeIds.push(node.id);
    current.buildThroughNodeId = node.id;
  }
  // Ids, folder by folder, compared without case as `sectionId` hashes them.
  const earlier = (Array.isArray(prior?.sections) ? prior.sections : [])
    .filter((section) => typeof section.id === 'string' && section.id.startsWith('section-'));
  for (const key of new Set(sections.map((section) => section.folder.toLowerCase()))) {
    const runs = sections.filter((section) => section.folder.toLowerCase() === key);
    const before = earlier
      .filter((section) => String(section.folder).toLowerCase() === key)
      .map((section) => ({ id: section.id, nodeIds: Array.isArray(section.nodeIds) ? section.nodeIds : [] }));
    // Remembered ids of this folder are its own id or that id with a `-k` suffix.
    const own = sectionId(runs[0].folder, 1);
    const past = Object.entries(remembered)
      .filter(([id, nodeIds]) => (id === own || id.startsWith(`${own}-`)) && Array.isArray(nodeIds) && !before.some((section) => section.id === id))
      .map(([id, nodeIds]) => ({ id, nodeIds }));
    assignRunIds(runs[0].folder, runs, before, past).forEach((id, index) => { runs[index].id = id; });
  }
  for (const section of sections) section.legacyIds = section.nodeIds.map((id) => `scope-${id}`);
  const title = path.basename(root).replaceAll(/[-_]/g, ' ');
  return {
    id: 'book', kind: 'book', title,
    // The example calls its table of contents Programme.md. Keep the legacy
    // field for sidecar compatibility, but expose the product concept plainly.
    tableOfContentsNodeId: programme?.id || null, programmeNodeId: programme?.id || null,
    nodeIds: ordered.map((node) => node.id), anchorNodeId: programme?.id || ordered[0]?.id || null,
    buildThroughNodeId: ordered.at(-1)?.id || null, sections,
  };
}

/**
 * Finds a scope in a graph: `book`, a section by its current id or by one of
 * its `legacyIds`, or a piece by its node id. A current id always wins over an
 * alias.
 *
 * @param {object} graph
 * @param {string} [id]
 * @returns {object}
 * @throws `SCOPE_NOT_FOUND` when nothing in the graph has that id.
 */
function scopeFromGraph(graph, id = 'book') {
  if (id === 'book') return graph.book;
  // A section is also found by any id it had before (see `canonicalBook`).
  const section = graph.book?.sections?.find((entry) => entry.id === id)
    || graph.book?.sections?.find((entry) => entry.legacyIds?.includes(id));
  if (section) return section;
  const node = graph.nodes.find((entry) => entry.id === id);
  if (!node) throw codedError('Graph scope not found.', 'SCOPE_NOT_FOUND');
  return { id: node.id, kind: 'node', title: node.title, anchorNodeId: node.id, nodeIds: [node.id], buildThroughNodeId: node.id };
}

export class ProjectStore {
  #legacyRecoveryNeeded = true;

  /** Binds the store to one project and its local derived state. */
  constructor(root) {
    this.root = path.resolve(root);
    this.manuscriptDirectory = path.join(this.root, 'manuscript');
    this.stateDirectory = path.join(this.root, '.texgraph');
    this.editorial = new EditorialJournal(this.root, this.stateDirectory);
    this.graphPath = path.join(this.stateDirectory, 'graph.json');
    this.conversationsDirectory = path.join(this.stateDirectory, 'conversations');
    this.proposalsDirectory = path.join(this.stateDirectory, 'proposals');
    // Every change contract, one file per contract, kept after it is decided.
    this.contractsDirectory = path.join(this.stateDirectory, 'contracts');
    this.buildsDirectory = path.join(this.stateDirectory, 'builds');
    this.liveBuildsDirectory = path.join(this.stateDirectory, 'live-builds');
    this.refreshing = null;
    this.writes = Promise.resolve();
    this.answering = new Set();
  }

  // Manuscript writes, contract decisions, rollbacks and proof links run one at a time, so a hash check
  // and the write it guards can never interleave with another write.
  /** Queues a write behind earlier operations on the same store. */
  exclusive(task) {
    const run = this.writes.then(task, task);
    this.writes = run.catch(() => {});
    return run;
  }

  /** Resolves and confines a manuscript source path. */
  sourcePath(relativePath) { return contained(this.manuscriptDirectory, relativePath); }
  /** Resolves the file for a known source node. */
  nodePath(id) { if (!NODE_ID.test(id)) throw new Error('Invalid graph node id.'); return id; }
  // Book, section and page conversations are separate threads keyed by scope id.
  /** Derives the storage key for the selected conversation scope. */
  scopeKey(scopeId) { return scopeId === 'book' ? 'book' : this.nodePath(scopeId); }
  /** Resolves the turn journal within the store's state area. */
  conversationPath(scopeId) { return path.join(this.conversationsDirectory, `${this.scopeKey(scopeId)}.jsonl`); }
  /** Resolves the change-set journal within the store's state area. */
  changeSetPath(scopeId) { return path.join(this.proposalsDirectory, `${this.scopeKey(scopeId)}.json`); }

  /** Prepares the store and loads or creates the required derived state. */
  async initialize() {
    if (!(await exists(this.manuscriptDirectory))) throw new Error('This project does not contain a manuscript directory.');
    await Promise.all([mkdir(this.conversationsDirectory, { recursive: true }), mkdir(this.proposalsDirectory, { recursive: true }), mkdir(this.contractsDirectory, { recursive: true }), mkdir(this.buildsDirectory, { recursive: true }), mkdir(this.liveBuildsDirectory, { recursive: true })]);
    const graph = await this.graph();
    // A graph written before stable section ids is rebuilt, so ids and aliases are current from the first request.
    const stableIds = graph.book?.sections?.every((section) => section.id?.startsWith('section-') && Array.isArray(section.legacyIds));
    const ready = graph.schemaVersion >= 4 && stableIds ? graph : await this.refreshGraph();
    // Once per store: undo any acceptance a stopped process left half applied.
    // The server initializes a store on every request, so this must not repeat.
    // A recovery that fails (a passing file lock) is tried again on the next call, not cached as failed.
    if (!this.recovery) this.recovery = this.exclusive(() => this.#settleLegacyWrites()).catch((error) => { this.recovery = null; throw error; });
    await this.recovery;
    return ready;
  }

  /**
   * Restores pieces written by an acceptance that never finished. Before an
   * acceptance writes, it records which pieces it is applying (`applying` on
   * the contract); a contract still carrying that record was interrupted.
   * Each such piece that holds the proposed text is restored to its prior
   * text, and every change in the interrupted acceptance is recorded as
   * failed, so the author decides again with the manuscript as it was.
   *
   * @returns {Promise<string[]>}  Ids of the contracts that were recovered.
   */
  async #recoverInterrupted() {
    const recovered = [];
    for (const record of await this.#journal()) {
      if (!record.applying) continue;
      await this.#settleInterrupted(record);
      recovered.push(record.id);
    }
    return recovered;
  }

  /** Checks again after a legacy acceptance that could not prove it settled. */
  async #settleLegacyWrites() {
    if (!this.#legacyRecoveryNeeded) return;
    await this.#recoverInterrupted();
    this.#legacyRecoveryNeeded = false;
  }

  /**
   * Settles one contract left mid-acceptance (`applying` set): each listed
   * pending text change whose piece holds the proposed text is restored to
   * its prior text, every such change is recorded as failed, and `applying`
   * is removed. Runs inside the store lock: from start-up recovery, and before
   * any decision, rollback or newer proposal touches the contract, so a later
   * operation can never act on a half-applied acceptance.
   *
   * A piece that cannot be read throws, leaving the record unchanged on disk,
   * so the operation fails and is retried rather than guessing what the piece
   * holds.
   *
   * @param {import('./change-contract.mjs').ChangeContract} record  Mutated in place and saved.
   * @returns {Promise<void>}
   */
  async #settleInterrupted(record) {
    const at = new Date().toISOString();
    // Without a usable list, every pending text change of the contract is checked.
    const listed = Array.isArray(record.applying.nodeIds) ? record.applying.nodeIds
      : record.changes.filter((entry) => entry.kind !== LAYOUT_CHANGE && entry.status === 'pending').map((entry) => entry.nodeId);
    const pending = listed.map((id) => record.changes.find((entry) => entry.kind !== LAYOUT_CHANGE && entry.nodeId === id && entry.status === 'pending')).filter(Boolean);
    // Read every piece before writing any, so an unreadable piece changes nothing.
    const held = [];
    for (const change of pending) held.push((await this.#nodeOrMissing(change.nodeId))?.hash ?? null);
    const outcomes = [];
    for (const [index, change] of pending.entries()) {
      let restored = false;
      if (held[index] === change.afterHash) { await this.#writeNode(change.nodeId, change.before, change.afterHash); restored = true; }
      change.status = 'failed'; change.decidedAt = at;
      change.error = restored
        ? 'The acceptance was interrupted before it finished; this piece was restored to its earlier text. Accept again to apply it.'
        : 'The acceptance was interrupted before it finished; this piece does not hold the proposed text, so it was left as it is. Accept again to apply it.';
      outcomes.push(change);
    }
    delete record.applying;
    record.status = hasPending(record) ? 'pending' : 'resolved';
    await this.#saveContract(record);
    const scopeExists = await this.scope(record.scopeId).then(() => true, () => false);
    if (outcomes.length && scopeExists) await this.appendTurn(record.scopeId, { role: 'system', kind: 'changes-decided', changeSetId: record.id, decisions: outcomes.map(decisionOf) });
  }

  /** Rebuilds the source graph under the store's serialization rules. */
  async refreshGraph() {
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.#refreshGraph();
    try {
      return await this.refreshing;
    } finally {
      this.refreshing = null;
    }
  }

  /** Rebuilds the manuscript graph while the caller owns the update lock. */
  async #refreshGraph() {
    const programmeRelative = 'Programme.md';
    const programmeFile = this.sourcePath(programmeRelative);
    if (!(await exists(programmeFile))) throw new Error('This example needs its Table of Contents (manuscript/Programme.md) to establish reading order.');
    let prior = null;
    try { prior = JSON.parse(await readFile(this.graphPath, 'utf8')); } catch { /* first map */ }
    const priorNodes = new Map((prior?.nodes || []).map((node) => [node.relativePath, node]));
    const files = await markdownFiles(this.manuscriptDirectory);
    const nodes = [];
    const diagnostics = [];
    for (const relativePath of files) {
      const source = await readFile(this.sourcePath(relativePath), 'utf8');
      const old = priorNodes.get(relativePath);
      const currentHash = sourceHash(source);
      const node = {
        id: old?.id || nodeIdFor(relativePath), relativePath, title: titleOf(source, path.posix.basename(relativePath)), kind: kindOf(relativePath),
        hash: currentHash, directory: path.posix.dirname(relativePath) === '.' ? '' : path.posix.dirname(relativePath),
        changedOnDisk: Boolean(old && old.hash !== currentHash),
      };
      nodes.push(node); diagnostics.push(...diagnosticsFor(relativePath, source));
    }
    const byPath = new Map(nodes.map((node) => [node.relativePath, node]));
    const programme = await readFile(programmeFile, 'utf8');
    const order = [];
    for (const target of programmeLinks(programme, programmeRelative)) {
      const node = byPath.get(target);
      if (!node) diagnostics.push({ code: 'unresolved-table-of-contents-link', nodePath: programmeRelative, target, message: `Table-of-contents link does not resolve: ${target}` });
      else if (!order.includes(node.id)) order.push(node.id);
    }
    const memory = await this.#sectionMemory();
    const book = canonicalBook(this.root, nodes, order, prior?.book, memory.sections);
    await this.#rememberSectionAliases(book, memory);
    const graph = {
      schemaVersion: 4, generatedAt: new Date().toISOString(),
      tableOfContentsPath: `manuscript/${programmeRelative}`, programmePath: `manuscript/${programmeRelative}`,
      nodes, readingOrder: order, diagnostics,
      book,
      rendered: prior?.rendered || { pages: [], spreads: [], buildId: null },
    };
    await writeAtomic(this.graphPath, `${JSON.stringify(graph, null, 2)}\n`);
    return graph;
  }

  /**
   * Reads `.texgraph/section-aliases.json`: `aliases` maps old-form section ids
   * to the section that claimed them, and `sections` maps every section id
   * ever issued to the pieces it last held. A missing or unparseable file reads
   * as empty (ids are then reissued in reading order, as for a new book).
   *
   * @returns {Promise<{ aliases: Record<string, string>, sections: Record<string, string[]> }>}
   */
  async #sectionMemory() {
    const stored = await readJsonIfUsable(path.join(this.stateDirectory, 'section-aliases.json'));
    const aliases = stored?.aliases && typeof stored.aliases === 'object' && !Array.isArray(stored.aliases) ? stored.aliases : {};
    const sections = {};
    const listed = stored?.sections && typeof stored.sections === 'object' && !Array.isArray(stored.sections) ? stored.sections : {};
    for (const [id, nodeIds] of Object.entries(listed)) {
      if (id.startsWith('section-') && Array.isArray(nodeIds)) sections[id] = nodeIds.filter((nodeId) => typeof nodeId === 'string');
    }
    return { aliases, sections };
  }

  /**
   * Keeps old-form section ids (`scope-<node id>`) attached after the piece
   * they were named after leaves the section or is renamed.
   *
   * `.texgraph/section-aliases.json` maps each old-form id that has recorded
   * data (a conversation thread or a proposal pointer) to the section it
   * belonged to when first seen. It only grows: the first claim stands, so
   * two sections never share an alias, and an id is never moved to another
   * section. Each section's `legacyIds` become its derived aliases (its current
   * pieces) plus the ids the map gives it, less any the map gives elsewhere.
   * If the map is lost, the derived aliases still cover every current piece.
   *
   * The same file keeps every section id ever issued with the pieces it last
   * held (`sections`): a run that returns gets its id back by those pieces,
   * and a new run never reuses a retired id (see `assignRunIds`).
   *
   * @param {{ sections: Array<{ id: string, nodeIds: string[], legacyIds: string[] }> }} book  Mutated in place.
   * @param {{ aliases: Record<string, string>, sections: Record<string, string[]> }} memory  As read by `#sectionMemory`.
   * @returns {Promise<void>}
   */
  async #rememberSectionAliases(book, memory) {
    const file = path.join(this.stateDirectory, 'section-aliases.json');
    const map = { ...memory.aliases };
    const issued = { ...memory.sections };
    let changed = false;
    // Every section id issued is remembered with its current pieces; retired ids keep their last.
    for (const section of book.sections) {
      if (JSON.stringify(issued[section.id]) !== JSON.stringify(section.nodeIds)) { issued[section.id] = [...section.nodeIds]; changed = true; }
    }
    const recorded = new Set();
    for (const directory of [this.conversationsDirectory, this.proposalsDirectory]) {
      for (const name of await readdir(directory).catch(() => [])) {
        const match = /^(scope-[a-z0-9-]+)\.(?:jsonl|json)$/.exec(name);
        if (match) recorded.add(match[1]);
      }
    }
    for (const section of book.sections) {
      for (const alias of section.legacyIds) {
        if (recorded.has(alias) && !Object.hasOwn(map, alias)) { map[alias] = section.id; changed = true; }
      }
    }
    if (changed) await writeAtomic(file, `${JSON.stringify({ aliases: map, sections: Object.fromEntries(Object.entries(issued).sort(([left], [right]) => left.localeCompare(right))) }, null, 2)}\n`);
    for (const section of book.sections) {
      const kept = section.legacyIds.filter((alias) => !Object.hasOwn(map, alias) || map[alias] === section.id);
      const claimed = Object.keys(map).filter((alias) => map[alias] === section.id);
      section.legacyIds = [...new Set([...kept, ...claimed])];
    }
  }

  /** Returns the current publishing graph. */
  async graph({ refresh = false } = {}) { return refresh || !(await exists(this.graphPath)) ? this.refreshGraph() : JSON.parse(await readFile(this.graphPath, 'utf8')); }
  /** Resolves an offered book, section or piece scope from the graph. */
  async scope(id = 'book') {
    const graph = await this.graph();
    return scopeFromGraph(graph, id === 'book' ? id : this.nodePath(id));
  }
  /** Returns the publishing setup ticket for the selected project. */
  async settingsTicket() { try { return JSON.parse(await readFile(path.join(this.root, 'texgraph', 'settings.json'), 'utf8')); } catch { return {}; } }
  /** Looks up the engine-owned source address in the graph. */
  async #nodeSummary(id) {
    const graph = await this.graph();
    const summary = graph.nodes.find((entry) => entry.id === this.nodePath(id));
    if (!summary) throw codedError('Graph node not found.', 'NODE_NOT_FOUND');
    return summary;
  }
  /** Reads the current source and metadata for a selected graph node. */
  async node(id) {
    const summary = await this.#nodeSummary(id);
    const source = await readFile(this.sourcePath(summary.relativePath), 'utf8');
    return { ...summary, source, hash: sourceHash(source) };
  }
  /** Validates the expected source revision before saving an edit. */
  updateNode(id, source, baseHash) {
    return this.exclusive(async () => {
      validateSourceWrite(source, baseHash);
      const journal = await this.#editorialState();
      const current = await this.#readWritableSource(id, { baseHash, editorial: true });
      const result = await this.#commitRevision(journal, current, source);
      return result.node;
    });
  }

  /** Uses exact bytes for the base check and the source that can be restored. */
  async #readWritableSource(id, { baseHash, editorial = false } = {}) {
    const node = await this.#nodeSummary(id);
    const file = this.sourcePath(node.relativePath);
    if (editorial) await editorialPath(this.root, file);
    const bytes = await readFile(file);
    const source = bytes.toString('utf8');
    const hash = sourceHash(source);
    if (baseHash !== undefined && baseHash !== hash) throw codedError('This manuscript node changed on disk. Reload it before saving.', 'STALE_SOURCE');
    // Hashes are taken over decoded text, so they cannot see bytes that are not
    // valid UTF-8: those decode to a replacement character and would be lost on
    // the first write, beyond any rollback. Refuse rather than destroy them.
    if (!Buffer.from(source, 'utf8').equals(bytes)) throw codedError(`“${node.title}” is not valid UTF-8 text, so Frige will not overwrite it: its original bytes could not be restored. Convert the file to UTF-8 first.`, 'SOURCE_NOT_UTF8');
    return { ...node, source, hash };
  }

  /** Writes a validated node revision and refreshes its derived state. */
  async #writeNode(id, source, baseHash, { prepared = false } = {}) {
    // Legacy acceptance and rollback use the same queue. Resolve any earlier
    // editorial write before they can move a piece past its recoverable hash.
    if (!prepared) {
      validateSourceWrite(source, baseHash);
      await this.#loadEditorial();
    }
    const current = await this.#readWritableSource(id, { baseHash, editorial: prepared });
    await writeAtomic(this.sourcePath(current.relativePath), source);
    await this.refreshGraph();
    const saved = await this.node(id);
    if (saved.source !== source) throw codedError('This manuscript node changed while saving. Reload it before saving again.', 'STALE_SOURCE');
    return saved;
  }

  /** Reconciles a stopped source write before another writer uses its base. */
  async #loadEditorial() {
    const journal = await this.editorial.load();
    if (journal.pending) {
      let current = null;
      try { current = await this.#readWritableSource(journal.pending.nodeId, { editorial: true }); }
      catch (error) { if (!['ENOENT', 'NODE_NOT_FOUND'].includes(error.code)) throw error; }
      await this.editorial.settle(journal, current?.hash);
    }
    return journal;
  }

  async #editorialState() {
    // Legacy recovery can undo matching proposal bytes. Finish it before a
    // new author operation can intentionally write those same bytes later.
    await this.#settleLegacyWrites();
    return this.#loadEditorial();
  }

  async #commitRevision(journal, current, source, restoredFrom) {
    // The caller supplied a validated save or a byte-verified snapshot. A
    // legacy source can exceed the new-save limit and still be restorable.
    if (source === current.source) return { node: current, revision: null };
    const revision = await this.editorial.prepare(journal, current, source, restoredFrom);
    // A failed source write leaves its intent for the next operation to settle
    // against the actual bytes, including a write that reached disk before a
    // derived graph refresh failed.
    const node = await this.#writeNode(current.id, source, current.hash, { prepared: true });
    await this.editorial.settle(journal, node.hash);
    return { node, revision };
  }

  /** Reads metadata for the current piece and its historical revisions. */
  listRevisions(id, before) {
    return this.exclusive(async () => {
      const journal = await this.#editorialState();
      const node = await this.#readWritableSource(id, { editorial: true });
      return this.editorial.listing(journal, node, before);
    });
  }

  /** Reads one exact historical source from this piece's journal. */
  readRevision(id, revisionId) {
    return this.exclusive(async () => {
      await this.#nodeSummary(id);
      return this.editorial.revision(await this.#editorialState(), id, revisionId);
    });
  }

  /** Restores the requested bytes as a new author-approved revision. */
  restoreRevision(id, revisionId, payload) {
    return this.exclusive(async () => {
      const journal = await this.#editorialState();
      const current = await this.#readWritableSource(id, { editorial: true });
      this.editorial.checkBase(journal, current, payload);
      const target = await this.editorial.revision(journal, id, revisionId);
      return this.#commitRevision(journal, current, target.source, revisionId);
    });
  }

  listEditorialDecisions(id, before) {
    return this.exclusive(async () => {
      await this.#nodeSummary(id);
      return this.editorial.decisions(await this.#editorialState(), id, before);
    });
  }

  /** Records a reason against the current piece without changing its source. */
  recordEditorialDecision(id, payload) {
    return this.exclusive(async () => {
      const journal = await this.#editorialState();
      const current = await this.#readWritableSource(id, { editorial: true });
      return this.editorial.decision(journal, current, payload);
    });
  }
  /**
   * The ids a scope is known by: its current id, and for a section every id it
   * had before. Records written under any of them belong to the same scope.
   *
   * @param {{ id: string, legacyIds?: string[] }} scope
   * @returns {string[]}
   */
  static aliasesOf(scope) { return [scope.id, ...(Array.isArray(scope.legacyIds) ? scope.legacyIds : [])]; }

  /** Appends the accepted turn to the local conversation history. */
  async appendTurn(scopeId, turn) {
    // Always recorded under the scope's current id, even when addressed by an earlier one.
    const { id } = await this.scope(scopeId);
    const record = { id: randomUUID(), at: new Date().toISOString(), ...turn, scopeId: id };
    await writeFile(this.conversationPath(id), `${JSON.stringify(record)}\n`, { encoding: 'utf8', flag: 'a' });
    return record;
  }
  /** Reads the conversation history for the requested target. */
  async turns(scopeId, limit = 40) {
    const scope = await this.scope(scopeId);
    const aliases = ProjectStore.aliasesOf(scope);
    // `tolerant` skips lines that do not parse. It is used for other pieces' own
    // files, read only for old section turns, so damage there cannot break this thread.
    /** Decodes one stored turn record from the journal. */
    const parse = (line, tolerant) => { try { return JSON.parse(line); } catch (error) { if (tolerant) return null; throw error; } };
    /** Reads the appropriate stored conversation log. */
    const read = async (key, tolerant = false) => {
      try { return (await readFile(this.conversationPath(key), 'utf8')).trim().split('\n').filter(Boolean).map((line) => parse(line, tolerant)).filter(Boolean); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    };
    // A section's turns may be filed under any id it has had (see `canonicalBook`).
    const own = [];
    for (const key of aliases) own.push(...(await read(key)).filter((turn) => !turn.scopeId || aliases.includes(turn.scopeId)));
    // Earlier versions saved book and section turns in their anchor node's file, tagged with the scope id.
    const anchorFiles = scope.kind === 'node' ? [] : [...new Set([scope.anchorNodeId, ...aliases.map((alias) => /^scope-(node-[a-z0-9-]+)$/.exec(alias)?.[1])].filter(Boolean))];
    const legacy = [];
    for (const anchor of anchorFiles) legacy.push(...(await read(anchor, true)).filter((turn) => aliases.includes(turn?.scopeId)));
    const unique = new Map([...legacy, ...own].map((turn) => [turn.id ?? `${turn.at}${turn.message ?? ''}`, turn]));
    return [...unique.values()].sort((left, right) => left.at.localeCompare(right.at)).slice(-limit);
  }
  // Artifacts from Hermes replies are product state: metadata and content under
  // .texgraph/artifacts, referenced from turns by id so threads stay small.
  /** Resolves an artifact identifier inside the project's state directory. */
  artifactPath(id, extension) { if (!/^art-[a-f0-9]{16}$/.test(id)) throw new Error('Invalid artifact id.'); return path.join(this.stateDirectory, 'artifacts', `${id}.${extension}`); }
  /** Persists validated assistant artifact parts and their metadata. */
  async storeParts(addressedScopeId, parts = [], meta = null) {
    // Artifacts are recorded under the scope's current id, even when addressed by an earlier one.
    const scopeId = (await this.scope(addressedScopeId)).id;
    const stored = []; const dropped = [];
    for (const [index, part] of parts.entries()) {
      // The gateway validates parts; the product still refuses shapes it cannot render.
      const shapeProblem = partShapeProblem(part);
      if (shapeProblem) { dropped.push({ index, reason: shapeProblem }); continue; }
      if (part?.type !== 'artifact') {
        // Interactive prompts get a product id, so an answer can be traced to exactly one prompt.
        stored.push(part?.type === 'choice' || part?.type === 'form' ? { ...part, promptId: `prompt-${randomUUID().replaceAll('-', '').slice(0, 16)}` } : part);
        continue;
      }
      const content = part.kind === 'image' ? Buffer.from(part.content, 'base64') : Buffer.from(String(part.content), 'utf8');
      if (part.kind === 'image' && imageSignature(content) !== part.mediaType) { dropped.push({ index, reason: 'The image data does not match its declared type.' }); continue; }
      const id = `art-${randomUUID().replaceAll('-', '').slice(0, 16)}`;
      const record = { id, kind: part.kind, title: part.title, language: part.language || null, mediaType: part.kind === 'image' ? part.mediaType : 'text/plain', bytes: content.length, sha256: createHash('sha256').update(content).digest('hex'), createdAt: new Date().toISOString(), scopeId, model: meta?.model || null };
      await mkdir(path.join(this.stateDirectory, 'artifacts'), { recursive: true });
      await writeAtomic(this.artifactPath(id, 'data'), content);
      await writeAtomic(this.artifactPath(id, 'json'), `${JSON.stringify(record, null, 2)}\n`);
      stored.push({ type: 'artifact', artifactId: id, kind: record.kind, title: record.title, language: record.language, mediaType: record.mediaType, bytes: record.bytes });
    }
    return { parts: stored, dropped };
  }
  /** Reads the metadata of a project artifact. */
  async artifact(id) { try { return JSON.parse(await readFile(this.artifactPath(id, 'json'), 'utf8')); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }
  /** Reads the content for a validated artifact target. */
  async artifactContent(id) { const record = await this.artifact(id); return record ? { record, content: await readFile(this.artifactPath(id, 'data')) } : null; }
  /** Lists artifacts available to the selected conversation scope. */
  async artifacts() {
    const directory = path.join(this.stateDirectory, 'artifacts');
    const names = await readdir(directory).catch(() => []);
    const records = await Promise.all(names.filter((name) => /^art-[a-f0-9]{16}\.json$/.test(name)).map((name) => this.artifact(name.slice(0, -5))));
    return records.filter(Boolean).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }
  // An answer must match a stored prompt in this scope's thread, once, with valid values.
  // It is reserved while Hermes replies and recorded only once Hermes has it, so a
  // failed turn leaves the question open to answer again.
  /** Reserves a reviewed answer before issuing its turn. */
  reserveAnswer(scopeId, promptId, values) {
    return this.exclusive(async () => {
      const thread = await this.turns(scopeId, 100_000);
      const prompt = thread.flatMap((turn) => turn.parts || []).find((part) => part.promptId === promptId);
      if (!prompt) throw Object.assign(new Error('This question is not part of the conversation.'), { code: 'UNKNOWN_PROMPT' });
      const key = `${(await this.scope(scopeId)).id}::${promptId}`;
      if (this.answering.has(key) || thread.some((turn) => turn.kind === 'answer' && turn.promptId === promptId)) throw Object.assign(new Error('This question has already been answered.'), { code: 'ALREADY_ANSWERED' });
      const { normalized, summary } = answerFor(prompt, values);
      this.answering.add(key);
      return { scopeId, promptId, key, partId: prompt.id, values: normalized, message: summary };
    });
  }
  // Committing runs under the same lock as reserving, so a concurrent reservation always
  // sees the answer either as reserved or as written, never as neither.
  /** Finalizes a reserved answer after the turn is accepted. */
  commitAnswer(reservation) {
    return this.exclusive(async () => {
      try { return await this.appendTurn(reservation.scopeId, { role: 'user', kind: 'answer', promptId: reservation.promptId, partId: reservation.partId, values: reservation.values, message: reservation.message }); }
      finally { this.answering.delete(reservation.key); }
    });
  }
  /** Clears a reserved answer when the turn cannot finish. */
  releaseAnswer(reservation) { this.answering.delete(reservation.key); }
  /** Records the answer to a reviewed prompt. */
  async recordAnswer(scopeId, promptId, values) { return this.commitAnswer(await this.reserveAnswer(scopeId, promptId, values)); }
  // What the director is shown for a scope: the book offers its table of contents,
  // a section or page each of its nodes, within a size budget.
  /** Builds the bounded source and design context for a turn. */
  async scopeContext(scopeId) {
    const graph = await this.graph({ refresh: true }); const scope = scopeFromGraph(graph, scopeId === 'book' ? 'book' : this.nodePath(scopeId));
    const ids = scope.kind === 'book' ? [graph.book.tableOfContentsNodeId].filter(Boolean) : scope.nodeIds;
    const sources = []; const withheld = []; let budget = SCOPE_SOURCE_BUDGET;
    for (const id of ids) {
      const node = await this.node(id);
      if (node.source.length > budget) { withheld.push({ nodeId: node.id, title: node.title }); continue; }
      budget -= node.source.length;
      sources.push({ nodeId: node.id, relativePath: node.relativePath, title: node.title, kind: node.kind, hash: node.hash, source: node.source });
    }
    return { graph, scope, sources, withheld };
  }

  /**
   * Context from the levels around a conversation (program Wave 3c), offered
   * beside its own sources. Each part carries its category, and none contains
   * manuscript text: piece text is offered only as the scope's own sources.
   *
   * - `outline` (`outline`): pieces in reading order with title, path, kind,
   *   hash and section, and book pages only from a current verified proof, so a
   *   conversation can reason about the whole book's structure without its
   *   text. Bounded; `truncated` says when pieces were left out. Titles are the
   *   pieces' headings, offered as identifying metadata.
   * - `settings` (`document-settings`): the publication profile and, for a
   *   section or piece, the size and leading in force there with where they
   *   come from, and the scope's own override.
   * - `contracts` (`approved-contract`): the most recent accepted changes
   *   relevant to the scope (see `relevant`), as targets. The author's request
   *   is included only for contracts written in this same conversation, since
   *   it may quote any piece. If the contract history cannot be read, it is
   *   left out of this turn with `unavailable: true`.
   *
   * @param {{ id: string, kind: string, folder?: string }} scope
   * @param {{ readingOrder: string[], nodes: Array<{ id: string, title: string, kind: string, relativePath: string, hash: string }>, book: { sections: Array<{ id: string, folder: string, title: string, nodeIds: string[] }> } }} graph
   * @returns {Promise<{
   *   outline: { category: 'outline', entries: object[], truncated: boolean },
   *   settings: { category: 'document-settings', designHash: string, book: object, scope: object | null },
   *   contracts: { category: 'approved-contract', entries: object[], unavailable?: true },
   * }>}
   */
  async hierarchy(scope, graph) {
    /** Locates the section that owns a selected unit. */
    const sectionOf = (id) => graph.book.sections.find((section) => section.nodeIds.includes(id));
    const design = await this.design();
    // Pages are offered only from a verified book-order proof that still matches
    // the book: the same profile, the same reading order through the proof's end,
    // and each piece's typeset hash equal to its current one. Anything else would
    // present an old layout's page numbers as the book's.
    const reference = await this.referenceMap().catch(() => null);
    const included = Array.isArray(reference?.includedNodeIds) ? reference.includedNodeIds : [];
    const referenceCurrent = Boolean(reference) && reference.designHash === designHash(design)
      && JSON.stringify(graph.readingOrder.slice(0, included.length)) === JSON.stringify(included);
    /** Collects page references associated with the selected node. */
    const pagesOf = (node) => {
      if (!referenceCurrent || reference.sourceHashes?.[node.id] !== node.hash) return null;
      const entry = reference.nodes?.find((mapped) => mapped.nodeId === node.id && mapped.firstPage);
      return entry ? { first: entry.firstBookPage ?? entry.firstPage, last: entry.lastBookPage ?? entry.lastPage } : null;
    };
    // The budget counts UTF-8 bytes, as the inference service does, including each entry's separating comma.
    const entries = []; let size = 2; let truncated = false;
    for (const id of graph.readingOrder) {
      const node = graph.nodes.find((entry) => entry.id === id);
      if (!node) continue;
      const entry = { nodeId: id, title: node.title, relativePath: node.relativePath, kind: node.kind, hash: node.hash, section: sectionOf(id)?.title ?? null, pages: pagesOf(node) };
      const cost = Buffer.byteLength(JSON.stringify(entry), 'utf8') + 1;
      // One piece with an unusually long title is left out without dropping the pieces after it.
      if (size + cost > OUTLINE_BUDGET) { truncated = true; continue; }
      size += cost; entries.push(entry);
    }

    const { sections = {}, nodes = {}, ...book } = design;
    /** Checks whether the selected node owns the scoped settings. */
    const own = (map, key) => (key && Object.hasOwn(map, key) ? map[key] : null);
    let inScope = null;
    if (scope.kind === 'node') {
      const folder = sectionOf(scope.id)?.folder || null;
      const resolved = resolveLayout(design, { sectionKey: folder, nodeId: scope.id });
      inScope = { level: 'element', fontSize: resolved.fontSize, leading: resolved.leading, sizeFrom: resolved.sizeFrom, own: own(nodes, scope.id), section: own(sections, folder) };
    } else if (scope.kind !== 'book' && scope.folder) {
      const resolved = resolveLayout(design, { sectionKey: scope.folder });
      inScope = { level: 'section', fontSize: resolved.fontSize, leading: resolved.leading, sizeFrom: resolved.sizeFrom, own: own(sections, scope.folder) };
    }

    const sectionScope = scope.kind === 'node' ? sectionOf(scope.id) : scope.kind === 'book' ? null : scope;
    // Records written under any id this scope has had are its own.
    const ownScope = ProjectStore.aliasesOf(scope);
    /**
     * Whether an accepted change is approved context for this scope: for the
     * book, contracts made in the book's conversation; for a section, those made
     * in the book's or this section run's conversation, and layout changes to its
     * folder; for a piece, changes made to it at any level and its section's
     * layout changes.
     *
     * @param {{ scopeId: string }} record
     * @param {{ kind?: string, nodeId?: string | null, level?: string, target?: string }} change
     * @returns {boolean}
     */
    const relevant = (record, change) => {
      if (scope.kind === 'book') return record.scopeId === 'book';
      if (scope.kind !== 'node') return record.scopeId === 'book' || ownScope.includes(record.scopeId) || (change.kind === LAYOUT_CHANGE && change.level === 'section' && change.target === scope.folder);
      return change.nodeId === scope.id || (change.kind === LAYOUT_CHANGE && change.level === 'section' && change.target === sectionScope?.folder);
    };
    // Approved context is a convenience: an unreadable contract file (a passing
    // lock) leaves it out for this turn rather than failing the conversation.
    const journal = await this.#journal().catch(() => null);
    const contracts = [];
    for (const record of journal || []) {
      const accepted = record.changes.filter((change) => change.status === 'accepted' && relevant(record, change));
      if (!accepted.length) continue;
      contracts.push({
        contractId: record.id, scopeId: record.scopeId,
        // The author's request can quote any piece, so it goes only back to the conversation that wrote it.
        ...(ownScope.includes(record.scopeId) ? { request: String(record.request || '').slice(0, 280) } : {}),
        decidedAt: accepted.map((change) => change.decidedAt || '').sort().at(-1) || null,
        changes: accepted.map((change) => ({ kind: change.kind || 'replace-node-source', title: change.title, nodeId: change.nodeId ?? null, ...(change.kind === LAYOUT_CHANGE ? { level: change.level, target: change.target, after: change.after } : {}) })),
      });
    }
    contracts.sort((left, right) => String(right.decidedAt).localeCompare(String(left.decidedAt)));

    return {
      outline: { category: 'outline', entries, truncated },
      settings: { category: 'document-settings', designHash: designHash(design), book, scope: inScope },
      contracts: { category: 'approved-contract', entries: contracts.slice(0, MAX_APPROVED_CONTRACTS), ...(journal ? {} : { unavailable: true }) },
    };
  }
  // ---------------------------------------------------------------------------
  // Change contracts (stex.frige.change-contract.v1)
  //
  // A proposal from the director is stored as a contract and changes nothing
  // until the author accepts it. Each contract lives in its own file under
  // .texgraph/contracts and is kept after it is decided, so the history of what
  // was proposed, accepted, refused and rolled back stays readable. The
  // per-scope file under .texgraph/proposals only points at the scope's current
  // contract. Record rules are in change-contract.mjs; this class owns the
  // files, the lock and every manuscript write.
  // ---------------------------------------------------------------------------

  /**
   * @param {string} id
   * @returns {string}  The contract's file. Throws for a malformed id, which could otherwise name any path.
   */
  contractPath(id) {
    if (!isContractId(id)) throw codedError('Change contract not found.', 'CONTRACT_NOT_FOUND');
    return path.join(this.contractsDirectory, `${id}.json`);
  }

  /**
   * Reads one contract in full, including the prior and proposed text. This is
   * the only reader of contract files. A file that is missing, cannot be
   * parsed, is stored under another id, or lacks the fields a decision or
   * rollback acts on is treated as absent: a rollback writes a record's prior
   * text into the manuscript, so a record is never trusted merely for existing.
   *
   * @param {string} id
   * @returns {Promise<import('./change-contract.mjs').ChangeContract | null>}
   *   The record (schema 3, or a schema-2 change set that was journaled), or `null`.
   * @throws `CONTRACT_NOT_FOUND` for a malformed id; the file system's error when
   *   the file exists but cannot be read, so a transient lock is never taken for absence.
   */
  async contract(id) {
    const record = await readJsonIfUsable(this.contractPath(id));
    return isContractRecord(record, id) ? record : null;
  }

  /**
   * Reads every usable stored contract. A damaged record is skipped, so it
   * does not hide the rest of the history. A file that cannot be read at all
   * makes the whole read fail: a proposal that missed an undecided contract
   * would leave it pending and undecidable. Every file is parsed on each
   * call; the journal has no index yet.
   *
   * @returns {Promise<import('./change-contract.mjs').ChangeContract[]>}
   */
  async #journal() {
    const names = await readdir(this.contractsDirectory).catch((error) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    const records = [];
    for (const name of names) {
      const id = name.endsWith('.json') ? name.slice(0, -'.json'.length) : '';
      if (!isContractId(id)) continue;
      const record = await this.contract(id);
      if (record) records.push(record);
    }
    return records;
  }

  /**
   * Writes a contract, and optionally makes it its scope's current proposal.
   * The contract file is written first: if the process stops between the two
   * writes the record still exists in the journal, and the next proposal for
   * the scope supersedes it.
   *
   * @param {{ id: string, scopeId: string }} record  A record that passed `isContractRecord`.
   * @param {{ current?: boolean }} [options]
   */
  async #saveContract(record, { current = false } = {}) {
    const body = `${JSON.stringify(record, null, 2)}\n`;
    await writeAtomic(this.contractPath(record.id), body);
    if (current) {
      const pointer = { schemaVersion: CONTRACT_SCHEMA_VERSION, contractId: record.id };
      await writeAtomic(this.changeSetPath(record.scopeId), `${JSON.stringify(pointer, null, 2)}\n`);
    }
  }

  /**
   * Lists contracts, newest first, without manuscript text.
   *
   * @param {{ scopeId?: string | null, nodeId?: string | null }} [filter]
   *   `scopeId` keeps contracts proposed in that conversation; `nodeId` keeps
   *   contracts that change that piece, whichever conversation proposed them.
   * @returns {Promise<object[]>}  At most {@link MAX_LISTED_CONTRACTS} summaries.
   */
  async contracts({ scopeId = null, nodeId = null } = {}) {
    // A section's contracts may have been proposed under any id it has had.
    const key = scopeId ? this.scopeKey(scopeId) : null;
    const aliases = key ? await this.scope(key).then(ProjectStore.aliasesOf, (error) => { if (error.code === 'SCOPE_NOT_FOUND') return [key]; throw error; }) : null;
    const node = nodeId ? this.nodePath(nodeId) : null;
    return (await this.#journal())
      .filter((record) => !aliases || aliases.includes(record.scopeId))
      .filter((record) => !node || record.changes.some((change) => change.nodeId === node))
      .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
      .slice(0, MAX_LISTED_CONTRACTS)
      .map(summarizeContract);
  }

  /**
   * Records the director's proposed replacements as one pending contract for
   * the scope. A change is kept only if it replaces a node whose exact text
   * was offered this turn. It gives either the piece's whole new text
   * (`source`) or anchored `edits`, which Frige resolves against the offered
   * text (see `applyEdits`); either way the contract records the full prior
   * and proposed text. An undecided earlier proposal for the same scope is
   * marked superseded and kept.
   *
   * @param {string} scopeId
   * @param {{
   *   commentary?: string,
   *   changes?: Array<{ nodeId: string, source?: string, edits?: import('./change-contract.mjs').SourceEdit[], summary?: string }>,
   *   layout?: { clear?: boolean, set?: Record<string, unknown>, summary?: string } | null,
   *   bounds?: { nodeId: string, start: number, end: number } | null,
   * }} proposal  Untrusted reply content: text replacements, or one layout change for the scope's own section or piece.
   *   `bounds` is not from the reply: it is the selected passage the engine resolved for this turn
   *   (offsets into the offered source), and limits every change to it.
   * @param {import('./change-contract.mjs').OfferedSource[]} offered  The sources this turn offered.
   * @param {import('./change-contract.mjs').ContractProvenance} [provenance]
   * @returns {Promise<{ changeSet: import('./change-contract.mjs').ChangeContract | null, dropped: Array<{ nodeId: string, reason: string }> }>}
   */
  createChangeSet(scopeId, proposal, offered, provenance = {}) { return this.exclusive(() => this.#createChangeSet(scopeId, proposal, offered, provenance)); }

  /** Validates and saves the offered revision proposal without applying it. */
  async #createChangeSet(scopeId, { commentary = '', changes = [], layout, bounds = null }, offered, provenance) {
    const kept = []; const dropped = [];
    const outsidePassage = 'A turn about a selected passage may change only that passage; this change reached outside it.';
    for (const change of Array.isArray(changes) ? changes : []) {
      const base = offered.find((entry) => entry.nodeId === change?.nodeId);
      if (!base) { dropped.push({ nodeId: String(change?.nodeId || '').slice(0, 100), reason: 'This node was not offered in the conversation scope.' }); continue; }
      if (bounds && base.nodeId !== bounds.nodeId) { dropped.push({ nodeId: base.nodeId, reason: outsidePassage }); continue; }
      const anchored = change.edits !== undefined;
      if (anchored && change.source !== undefined) { dropped.push({ nodeId: base.nodeId, reason: 'A change gives either the whole new text or edits to it, not both.' }); continue; }
      // Text that is not well-formed Unicode (a lone surrogate) cannot be stored exactly as proposed.
      if (!anchored && (typeof change.source !== 'string' || !change.source.isWellFormed())) { dropped.push({ nodeId: base.nodeId, reason: 'The proposed source is invalid.' }); continue; }
      if (kept.some((entry) => entry.nodeId === base.nodeId)) { dropped.push({ nodeId: base.nodeId, reason: 'Only one change per node is kept.' }); continue; }
      let source;
      if (anchored) {
        // Frige resolves the edits against the offered text (F5-B); the result is already in
        // the file's convention, and no byte outside the replaced spans is touched, so it is
        // not converted again: a piece with mixed line endings keeps them outside the spans.
        // A passage turn's anchors are looked for only inside the passage, so every span lies within it.
        const resolved = applyEdits(base.source, change.edits, bounds ? { within: bounds } : {});
        if ('reason' in resolved) { dropped.push({ nodeId: base.nodeId, reason: resolved.reason }); continue; }
        source = resolved.source;
      } else {
        // Keep the file's own line endings; a reply in another convention would otherwise rewrite every line unseen.
        source = base.source.includes('\r\n') ? change.source.replace(/\r?\n/g, '\r\n') : change.source.replace(/\r\n/g, '\n');
      }
      // Checked after line endings are converted: that is the text an acceptance would write.
      if (source.length > MAX_SOURCE) { dropped.push({ nodeId: base.nodeId, reason: 'The proposed source is longer than 400 KB.' }); continue; }
      // A reply that differs only in line endings proposes nothing the author asked for; say so,
      // because the director's prose may announce a change that the thread then never shows.
      if (sameTextIgnoringLineEndings(source, base.source)) { dropped.push({ nodeId: base.nodeId, reason: 'The proposed change would leave the piece’s text as it is.' }); continue; }
      // A whole-text reply in a passage turn must leave every byte outside the passage as it was.
      if (bounds && !changedOnlyWithin(base.source, source, bounds)) { dropped.push({ nodeId: base.nodeId, reason: outsidePassage }); continue; }
      kept.push(buildChange(base, source, sourceHash(source), change.summary));
    }
    const scope = await this.scope(scopeId);
    // A contract holds either text changes or one layout change, so each
    // decision and rollback acts on one kind of canonical state.
    if (layout !== undefined && layout !== null) {
      if (bounds) dropped.push({ nodeId: '', reason: 'A turn about a selected passage proposes only text changes inside it; the layout change was set aside.' });
      else if (kept.length) dropped.push({ nodeId: '', reason: 'A contract holds either text changes or one layout change; the layout change was set aside.' });
      else {
        const result = await this.#layoutChange(scope, layout);
        if (result.reason) dropped.push({ nodeId: '', reason: result.reason });
        else if (result.change) kept.push(result.change);
      }
    }
    if (!kept.length) return { changeSet: null, dropped };

    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const journal = await this.#journal();

    // Undecided earlier proposals for this scope: those in the journal, and a
    // current change set from before contracts that was never journaled.
    const aliases = ProjectStore.aliasesOf(scope);
    const earlier = new Map(journal.filter((record) => aliases.includes(record.scopeId) && hasPending(record)).map((record) => [record.id, record]));
    const current = await this.changeSet(scopeId);
    if (hasPending(current) && !earlier.has(current.id)) earlier.set(current.id, current);
    for (const prior of earlier.values()) {
      // Settled first, so superseding never leaves a half-applied acceptance in place.
      if (prior.applying) await this.#settleInterrupted(prior);
      const replaced = supersede(prior, id, createdAt);
      await this.#saveContract(prior);
      await this.appendTurn(scopeId, { role: 'system', kind: 'changes-decided', changeSetId: prior.id, decisions: replaced.map(decisionOf) });
    }

    const record = buildContract({
      id, createdAt, scope, commentary, changes: kept, dropped, offered, provenance,
      conflicts: conflictsWith(journal, kept, aliases),
    });
    await this.#saveContract(record, { current: true });
    return { changeSet: record, dropped };
  }

  /**
   * Builds a layout change for the conversation's own scope from an untrusted
   * proposal. A piece's conversation changes that piece's override and a
   * section's conversation that section's; the whole book's settings are
   * changed in the Design panel.
   *
   * @param {{ id: string, kind: string, title: string, folder?: string }} scope
   * @param {{ clear?: boolean, set?: Record<string, unknown>, summary?: string }} proposal
   *   `set` merges into the target's current override (a `null` value removes
   *   that key); `clear: true` removes the override.
   * @returns {Promise<{ change?: import('./change-contract.mjs').LayoutChange, reason?: string }>}
   *   A change, or the reason none was made (including that it would change nothing).
   */
  async #layoutChange(scope, proposal) {
    const graph = await this.graph({ refresh: true });
    const target = layoutTargetOf(graph, scope);
    if (!target) return { reason: 'A layout change applies to a section or a piece in the table of contents; the whole book’s settings are changed in the Design panel.' };
    if (!proposal || typeof proposal !== 'object') return { reason: 'The proposed layout change is invalid.' };

    const current = await this.design();
    /** Checks whether the object itself supplies the requested key. */
    const own = (map) => (map && Object.hasOwn(map, target.key) ? map[target.key] : null);
    const before = own(current[target.field]);
    let after = null;
    if (!proposal.clear) {
      if (!proposal.set || typeof proposal.set !== 'object' || Array.isArray(proposal.set)) return { reason: 'The proposed layout change is invalid.' };
      after = { ...(before || {}) };
      for (const [key, value] of Object.entries(proposal.set)) {
        // A JSON key such as `__proto__` would set the object's prototype, not a setting.
        if (['__proto__', 'constructor', 'prototype'].includes(key)) return { reason: 'The proposed layout change is invalid.' };
        if (value === null) delete after[key]; else after[key] = value;
      }
      if (!Object.keys(after).length) after = null;
    }
    const next = { ...current, [target.field]: { ...(current[target.field] || {}) } };
    if (after) next[target.field][target.key] = after; else delete next[target.field][target.key];
    const { design, errors } = validateDesign(next);
    // Bounded: a reply's reasons are stored in the conversation and shown to the author.
    if (!design) return { reason: `The proposed layout change is not valid: ${errors.join(' ')}`.slice(0, 1000) };
    const validated = own(design[target.field]);
    if (JSON.stringify(validated) === JSON.stringify(before)) return { reason: 'The proposed layout change would change nothing.' };

    const without = { ...current, [target.field]: { ...(current[target.field] || {}) } }; delete without[target.field][target.key];
    return {
      change: {
        kind: LAYOUT_CHANGE, level: target.level, target: target.key, nodeId: target.nodeId,
        title: `Layout · ${scope.title}`, before, after: validated,
        baseHash: designHash(current), afterHash: designHash(design),
        pieces: target.pieces, inherited: inheritedLayout(graph, without, target),
        summary: String(proposal.summary || '').slice(0, 500), status: 'pending',
      },
    };
  }

  /**
   * Writes one target's override, only if the profile still has the expected
   * hash. Runs inside the store lock (from a decision or a rollback).
   *
   * @param {import('./change-contract.mjs').LayoutChange} change
   * @param {object | null} override  The override to write; `null` removes it.
   * @param {string} expectedHash      The profile hash the write is valid against.
   * @param {{ requireTarget?: boolean }} [options]  `requireTarget` (on acceptance)
   *   refuses a target that has left the table of contents, as a direct save would;
   *   a rollback may always restore.
   * @throws `STALE_SOURCE` when the profile changed since, or the target is gone.
   */
  async #writeLayout(change, override, expectedHash, { requireTarget = false } = {}) {
    const current = await this.design();
    if (designHash(current) !== expectedHash) throw codedError('The publication profile changed after this suggestion, so it was not applied.', 'STALE_SOURCE');
    if (requireTarget) {
      const graph = await this.graph({ refresh: true });
      const present = change.level === 'node' ? graph.readingOrder.includes(change.target) : graph.book.sections.some((section) => section.folder === change.target);
      if (!present) throw codedError(`${change.level === 'node' ? 'This piece' : 'This section'} is no longer in the table of contents, so the change was not applied.`, 'STALE_SOURCE');
    }
    const field = change.level === 'node' ? 'nodes' : 'sections';
    const next = { ...current, [field]: { ...(current[field] || {}) } };
    if (override) next[field][change.target] = override; else delete next[field][change.target];
    const { design, errors } = validateDesign(next);
    if (!design) throw codedError(errors.join(' '), 'INVALID_DESIGN');
    await writeAtomic(path.join(this.stateDirectory, 'design.json'), `${JSON.stringify(design, null, 2)}\n`);
  }

  /**
   * The scope's current contract, or `null` when it has none. A missing or
   * damaged pointer or contract counts as none: the conversation still opens,
   * and the next proposal replaces the pointer. A file that exists but cannot
   * be read throws instead, so a passing lock never orphans a contract.
   *
   * @param {string} scopeId
   * @returns {Promise<import('./change-contract.mjs').ChangeContract | null>}
   *   A schema-3 contract, or a schema-2 change set from before contracts.
   * @throws For a malformed scope id.
   */
  async changeSet(scopeId) {
    // A section's pointer may be filed under an earlier id; the current id is checked first.
    const scope = await this.scope(scopeId).catch((error) => { if (error.code === 'SCOPE_NOT_FOUND') return null; throw error; });
    for (const key of scope ? ProjectStore.aliasesOf(scope) : [scopeId]) {
      const pointer = await readJsonIfUsable(this.changeSetPath(key));
      if (isContractId(pointer?.contractId)) {
        const record = await this.contract(pointer.contractId);
        if (record) return record;
        continue;
      }
      // A full record here is a change set from before contracts. A file without
      // changes is an older single-page proposal, which cannot be reviewed as a diff.
      if (isContractRecord(pointer, pointer?.id)) return pointer;
    }
    return null;
  }

  /**
   * Applies the author's decision to the scope's current contract.
   *
   * Accepting text changes is all-or-nothing across the pieces decided
   * together: every piece is checked against its base hash before any is
   * written. If any has changed since the proposal, that change is marked
   * stale and nothing is written; the others stay pending to decide again.
   * If a write fails part-way, the pieces already written are restored. An
   * `applying` record saved before the first write lets a restarted process
   * undo an acceptance that a stop interrupted (see `#recoverInterrupted`).
   *
   * @param {string} scopeId
   * @param {string} changeSetId  Must be the scope's current contract.
   * @param {{ nodeId?: string | null, decision: 'accept' | 'reject' }} choice  `nodeId` limits the decision to one piece.
   * @returns {Promise<import('./change-contract.mjs').ChangeContract>}
   * @throws When the contract is no longer the scope's current one, or nothing is pending.
   */
  decideChanges(scopeId, changeSetId, choice) { return this.exclusive(() => this.#decideChanges(scopeId, changeSetId, choice)); }

  /** Applies approved changes under the serialized revision transaction. */
  async #decideChanges(scopeId, changeSetId, { nodeId = null, decision }) {
    if (!['accept', 'reject'].includes(decision)) throw new Error('Decision must be accept or reject.');
    await this.#settleLegacyWrites();
    const record = await this.changeSet(scopeId);
    if (!record || record.id !== changeSetId) throw new Error('This change set is no longer current.');
    // A half-applied earlier acceptance is settled before anything is decided on top of it.
    if (record.applying) await this.#settleInterrupted(record);
    const targets = record.changes.filter((change) => change.status === 'pending' && (!nodeId || change.nodeId === nodeId));
    if (!targets.length) throw new Error('No pending change matches.');
    let decided = targets;
    try {
      const at = new Date().toISOString();
      if (decision === 'reject') for (const change of targets) { change.decidedAt = at; change.status = 'rejected'; }
      else if (targets[0].kind === LAYOUT_CHANGE) {
        // A layout contract holds one change.
        const [change] = targets; change.decidedAt = at;
        try { await this.#writeLayout(change, change.after, change.baseHash, { requireTarget: true }); change.status = 'accepted'; }
        catch (error) { change.status = error.code === 'STALE_SOURCE' ? 'stale' : 'failed'; change.error = error.message; }
      } else {
        await this.#loadEditorial();
        decided = await this.#acceptText(record, targets, at);
      }
    } finally {
      // A proof recorded before this decision did not typeset a piece accepted now.
      if (targets.some((change) => change.status === 'accepted')) record.proof = null;
      // Saved even if a step threw. Each status already follows what reached the manuscript, and
      // `applying` is still set only when a piece could not be read, for recovery to settle.
      record.status = hasPending(record) ? 'pending' : 'resolved';
      await this.#saveContract(record, { current: true });
      if (!record.applying) this.#legacyRecoveryNeeded = false;
    }
    await this.appendTurn(scopeId, { role: 'system', kind: 'changes-decided', changeSetId, decisions: decided.map(decisionOf) });
    return record;
  }

  /**
   * Accepts text changes all-or-nothing. Runs inside the store lock.
   *
   * A change is recorded as accepted only when this acceptance wrote it. A
   * piece that already holds the proposed text was written by something else
   * (another contract or a hand edit), so its change is stale and can never be
   * rolled back: its `before` would undo that other write.
   *
   * Outcomes are decided from what each piece holds on disk, never from
   * whether a write threw: a write can reach the file and still throw
   * afterwards (while the graph refreshes), so an exception proves nothing
   * about the manuscript. The `applying` record is removed before this
   * returns or throws, except when a piece's state could not be read, in which
   * case it stays for `#recoverInterrupted` to settle on the next start.
   *
   * @param {import('./change-contract.mjs').ChangeContract} record  Mutated in place; the caller saves it.
   * @param {import('./change-contract.mjs').ContractChange[]} targets  Pending text changes to accept together.
   * @param {string} at  ISO timestamp of the decision.
   * @returns {Promise<import('./change-contract.mjs').ContractChange[]>}  The changes whose status this decided.
   * @throws A read error during the first check, or a failure to record the intent; nothing was written then.
   */
  async #acceptText(record, targets, at) {
    // 1. Check every piece first; one that changed since the proposal, or that is
    // no longer part of the conversation's scope, stops all writes.
    const scope = await this.scope(record.scopeId).catch((error) => { if (error.code === 'SCOPE_NOT_FOUND') return null; throw error; });
    const graph = await this.graph();
    // The whole book's conversation may change any piece and the table of contents.
    const inScope = !scope ? new Set() : scope.kind === 'book' ? new Set([...graph.readingOrder, graph.book.tableOfContentsNodeId]) : new Set(scope.nodeIds);
    const stale = [];
    for (const change of targets) {
      const node = await this.#nodeOrMissing(change.nodeId);
      if (node?.hash !== change.baseHash || !inScope.has(change.nodeId)) stale.push(change);
    }
    if (stale.length) {
      for (const change of stale) {
        change.status = 'stale'; change.decidedAt = at;
        change.error = inScope.has(change.nodeId)
          ? 'This piece changed after the suggestion, so it was not applied.'
          : 'This piece is no longer part of this conversation’s section or book, so it was not applied.';
      }
      // The rest were not written either; with several decided together they stay pending.
      return stale;
    }

    // 2. Record the intent before the first write, so a stop part-way can be undone on restart.
    this.#legacyRecoveryNeeded = true;
    record.applying = { startedAt: at, nodeIds: targets.map((change) => change.nodeId) };
    try {
      await this.#saveContract(record, { current: true });
    } catch (error) {
      // Nothing was written; the record must not be left claiming an acceptance in progress.
      // The save may have reached the contract file before failing, so try once to clear it there.
      delete record.applying;
      await this.#saveContract(record).catch(() => {});
      throw error;
    }

    // 3. Write each piece in order, stopping at the first failure.
    let failure = null; let failedIndex = -1;
    for (const [index, change] of targets.entries()) {
      try {
        await this.#writeNode(change.nodeId, change.source, change.baseHash);
      } catch (error) {
        failure = error; failedIndex = index;
        break;
      }
    }

    // 4. On a failure, restore every piece that holds the proposed text, whether or not its write threw.
    if (failure) {
      for (const change of [...targets].reverse()) {
        const node = await this.#nodeOrMissing(change.nodeId).catch(() => null);
        if (node?.hash !== change.afterHash) continue;
        // A restore that throws may still have reached the file; step 5 reads what it holds.
        await this.#writeNode(change.nodeId, change.before, change.afterHash).catch(() => {});
      }
    }

    // 5. Each status follows what the piece now holds.
    let settled = true;
    for (const [index, change] of targets.entries()) {
      let hash;
      try { hash = (await this.#nodeOrMissing(change.nodeId))?.hash ?? null; }
      catch { settled = false; continue; } // Unreadable: leave it pending under `applying` for recovery.
      change.decidedAt = at;
      if (!failure && hash === change.afterHash) { change.status = 'accepted'; continue; }
      if (hash === change.afterHash) {
        // Never claim less than what reached the manuscript: it is accepted, and rollback can undo it.
        change.status = 'accepted';
        change.error = `Another piece of this change could not be written, and this one could not be restored: ${failure.message}`;
      } else if (hash === change.baseHash) {
        change.status = 'failed';
        // The piece whose write failed carries that error; the others say why they were not applied.
        change.error = !failure ? 'The write did not take effect, so this piece was not changed.'
          : index === failedIndex ? failure.message : 'Not applied: another piece of this change could not be written, so none was.';
      } else {
        change.status = 'failed';
        change.error = 'Not applied: this piece holds neither its earlier text nor the proposed text, so it was left as it is.';
      }
    }
    if (settled) delete record.applying;
    return targets;
  }

  /**
   * Reads a piece, or `null` when it is no longer in the manuscript. Any other
   * failure (a lock held by a sync client or scanner) is thrown, so a passing
   * lock is never mistaken for a changed or missing piece.
   *
   * @param {string} id
   * @returns {Promise<{ hash: string, source: string } | null>}
   */
  async #nodeOrMissing(id) {
    try { return await this.node(id); }
    catch (error) {
      if (error.code === 'ENOENT' || error.code === 'NODE_NOT_FOUND') return null;
      throw error;
    }
  }

  /**
   * Rolls back accepted changes of a contract by restoring the exact prior
   * text, or for a layout change the prior override. Each piece must still
   * hold the text the contract wrote (the profile, the hash the change
   * produced); if any has changed since, nothing is restored, so a later edit
   * is never overwritten. The node keeps its identity and its restored hash
   * equals the contract's base hash.
   *
   * @param {string} contractId
   * @param {{ nodeId?: string | null }} [options]  `nodeId` limits the rollback to one piece.
   * @returns {Promise<import('./change-contract.mjs').ChangeContract>}
   * @throws `CONTRACT_NOT_FOUND`, `NOTHING_TO_REVERT`, or `STALE_SOURCE` when a piece changed after acceptance.
   */
  revertChanges(contractId, options = {}) { return this.exclusive(() => this.#revertChanges(contractId, options)); }

  /** Restores exact prior content when the current revision still permits rollback. */
  async #revertChanges(contractId, { nodeId = null } = {}) {
    await this.#settleLegacyWrites();
    const record = await this.contract(contractId);
    if (!record) throw codedError('Change contract not found.', 'CONTRACT_NOT_FOUND');
    if (record.applying) await this.#settleInterrupted(record);
    const targets = record.changes.filter((change) => change.status === 'accepted' && (!nodeId || change.nodeId === nodeId));
    if (!targets.length) throw codedError('This contract has no accepted change to roll back.', 'NOTHING_TO_REVERT');

    // Check every piece before writing any, so a rollback of several pieces is
    // not left half done because one of them was edited afterwards. A layout
    // change is checked against the whole profile.
    for (const change of targets) {
      if (change.kind === LAYOUT_CHANGE) {
        if (designHash(await this.design()) !== change.afterHash) throw codedError('The publication profile changed after this change was accepted. Rolling back would overwrite that change, so nothing was restored.', 'STALE_SOURCE');
        continue;
      }
      const node = await this.node(change.nodeId).catch(() => null);
      if (!node) throw codedError(`“${change.title}” is no longer in the manuscript, so it cannot be rolled back.`, 'STALE_SOURCE');
      if (node.hash !== change.afterHash) throw codedError(`“${change.title}” changed after this change was accepted. Rolling back would overwrite that edit, so nothing was restored.`, 'STALE_SOURCE');
    }

    const revertedAt = new Date().toISOString();
    const reverted = [];
    try {
      for (const change of targets) {
        if (change.kind === LAYOUT_CHANGE) await this.#writeLayout(change, change.before, change.afterHash);
        else await this.#writeNode(change.nodeId, change.before, change.afterHash);
        change.status = 'reverted'; change.revertedAt = revertedAt;
        reverted.push(change);
      }
    } catch (error) {
      // The pre-check makes this unlikely (a disk failure, or an edit made
      // outside Frige in the moment between check and write). Record why.
      const failed = targets[reverted.length];
      if (failed) failed.error = error.message;
      throw error;
    } finally {
      // A proof of the accepted text no longer describes the manuscript.
      if (reverted.length) record.proof = null;
      await this.#saveContract(record);
      // The thread note is a convenience; the contract is the record. A section
      // conversation can disappear when its first piece changes, so do not fail on it.
      const scopeExists = await this.scope(record.scopeId).then(() => true, () => false);
      if (reverted.length && scopeExists) await this.appendTurn(record.scopeId, { role: 'system', kind: 'changes-reverted', changeSetId: record.id, decisions: reverted.map(decisionOf) });
    }
    return record;
  }

  /**
   * Records a successful build on every contract it proves: one whose accepted
   * changes were all typeset at exactly their accepted text. A contract keeps
   * its strongest proof, so a later build replaces the recorded one only if it
   * is stronger (see `proofStrength`), or as strong but typeset under a
   * different publication profile; a repeat build of the same text under the
   * same profile rewrites nothing, and a piece typeset alone never displaces a verified book-order
   * proof. Linking never fails the build: a problem is returned as
   * `proofLinkError` and stored in the build record.
   *
   * @param {object} build  A build record as written by `recordBuild`.
   * @returns {Promise<{ provedContracts: string[], proofLinkError?: string }>}
   *   Ids of every contract this build proves, whether or not its record changed.
   */
  async #linkProof(build) {
    const provedContracts = [];
    try {
      const { readingOrder } = await this.graph();
      for (const record of await this.#journal()) {
        const proof = proofFor(record, build, { readingOrder });
        if (!proof) continue;
        provedContracts.push(record.id);
        // A proof of equal strength replaces the recorded one only when it was typeset
        // under a different profile, so the record names the settings now in force.
        const stronger = proofStrength(proof) > proofStrength(record.proof);
        const resettled = proofStrength(proof) === proofStrength(record.proof) && proof.designHash !== record.proof?.designHash;
        if (!stronger && !resettled) continue;
        record.proof = proof;
        await this.#saveContract(record);
      }
      return { provedContracts };
    } catch (error) {
      return { provedContracts, proofLinkError: error.message };
    }
  }

  /** Reads the same bounded excerpt for preview, approval and forwarding. */
  async attachmentExcerpt(entry) {
    if (typeof entry?.id !== 'string' || !/^[a-f0-9]{16}$/.test(entry.id) || entry.extraction !== `extractions/${entry.id}.txt`) return null;
    const file = path.join(this.stateDirectory, entry.extraction);
    try {
      if (!(await editorialPath(this.root, file, { optional: true }))) return null;
      const input = await open(file, 'r');
      try {
        const size = (await input.stat()).size;
        if (!size || size > 600_000) return null;
        const buffer = Buffer.alloc(Math.min(size, 18_003));
        const { bytesRead } = await input.read(buffer);
        if (bytesRead !== buffer.length) return null;
        let excerpt = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer, { stream: bytesRead < size }).slice(0, 6000);
        if (!excerpt.isWellFormed()) excerpt = excerpt.slice(0, -1);
        if (!excerpt.trim()) return null;
        return { id: entry.id, name: entry.name, excerpt, hash: sourceHash(excerpt) };
      } finally { await input.close(); }
    } catch { return null; }
  }

  /** Resolves excerpts whose exact bytes were approved by the author. */
  async approvedSourceExcerpts() {
    try {
      const documents = JSON.parse(await readFile(path.join(this.stateDirectory, 'documents.json'), 'utf8'));
      if (!Array.isArray(documents)) return [];
      const approved = documents.filter((entry) => entry?.contextState === 'approved' && typeof entry.approvalHash === 'string')
        .sort((left, right) => String(right.reviewedAt ?? '').localeCompare(String(left.reviewedAt ?? '')));
      const resolved = [];
      for (const entry of approved.slice(0, 32)) {
        const excerpt = await this.attachmentExcerpt(entry);
        if (excerpt?.hash !== entry.approvalHash) continue;
        resolved.push(excerpt);
        if (resolved.length === 8) break;
      }
      return resolved;
    } catch { return []; }
  }
  /** Resolves the build artifact directory for the selected project or page. */
  buildDirectory() { return this.buildsDirectory; }
  /** Resolves a mounted preview path without allowing traversal. */
  previewPath() { return path.join(this.buildsDirectory, 'current.pdf'); }
  /** Reads the current proof status and its revision markers. */
  async buildStatus() { try { return JSON.parse(await readFile(path.join(this.buildsDirectory, 'last.json'), 'utf8')); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }
  /** Promotes an accepted proof result to the current preview. */
  async activateBuild(directory, manifest) { const staged = path.join(this.buildsDirectory, `current-${randomUUID()}`); await copyFile(path.join(directory, 'document.pdf'), `${staged}.pdf`); await writeAtomic(`${staged}.json`, `${JSON.stringify(manifest, null, 2)}\n`); await rename(`${staged}.pdf`, this.previewPath()); await rename(`${staged}.json`, path.join(this.buildsDirectory, 'page-map.json')); }
  /**
   * Records the outcome of a build as the project's latest, and links a
   * successful one to the change contracts it proves.
   *
   * @param {object} result  The result of `buildBook`.
   * @returns {Promise<object>}  The stored record, with `provedContracts` when the build succeeded.
   */
  async recordBuild(result) {
    const record = { completedAt: new Date().toISOString(), lastSuccessful: await exists(this.previewPath()), ...result, log: String(result.log || '').slice(-60000) };
    // Linking takes the write lock: it must not interleave with a decision or a rollback.
    if (record.ok) Object.assign(record, await this.exclusive(() => this.#linkProof(record)));
    await writeAtomic(path.join(this.buildsDirectory, 'last.json'), `${JSON.stringify(record, null, 2)}\n`);
    return record;
  }
  // The book's publication profile is product state, kept beside the proofs, not in the vault.
  /** Reads the publishing profile and its layout overrides. */
  async design() { try { return normalizeDesign(JSON.parse(await readFile(path.join(this.stateDirectory, 'design.json'), 'utf8'))); } catch { return normalizeDesign({}); } }
  /**
   * Validates and saves the publication profile.
   *
   * Fields left out keep their saved values. Overrides merge by key:
   * `sections: { <folder>: {...} }` or `nodes: { <id>: {...} }` replaces that
   * one override, and `null` clears it. A new or changed override must name a
   * section folder or piece in the book's current reading order, so a typo
   * cannot create a setting nothing will ever read. An override whose target
   * has since been renamed is kept until it is cleared.
   *
   * @param {object} input  Settings to change, and optionally `baseHash`: the
   *   profile hash the form was filled from.
   * @returns {Promise<object>}  The saved profile.
   * @throws `INVALID_DESIGN` with every validation message; `STALE_DESIGN` when
   *   `baseHash` is given and the profile has changed since.
   */
  saveDesign(input) {
    return this.exclusive(async () => {
      /** Constructs the failure returned for rejected inputs at this boundary. */
      const invalid = (message) => codedError(message, 'INVALID_DESIGN');
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalid('A design profile must be an object of settings.');
      const current = await this.design();
      // A save that names the profile it was edited from is refused if the profile
      // has changed since (an accepted layout change, another window), so it can
      // never silently undo that change. Saves without it keep the old behaviour.
      const { baseHash, ...settings } = input;
      if (baseHash !== undefined && baseHash !== designHash(current)) throw codedError('The saved profile changed after this form was filled in, so it was not saved. Close and reopen the panel to edit the saved settings.', 'STALE_DESIGN');
      input = settings;
      const merged = { ...current, ...input, margins: { ...current.margins, ...(input.margins && typeof input.margins === 'object' ? input.margins : {}) } };
      const errors = [];
      // Checked against the table of contents as it is now, not a cached reading of it.
      const graph = (input.sections !== undefined || input.nodes !== undefined) ? await this.graph({ refresh: true }) : null;
      /** Derives a display label for the selected source piece. */
      const pieceTitle = (key) => graph.nodes.find((node) => node.id === key)?.title || key;
      for (const [level, field, exists, name] of [
        ['section', 'sections', (key) => graph.book.sections.some((section) => section.folder === key), (key) => key],
        ['piece', 'nodes', (key) => graph.readingOrder.includes(key), pieceTitle],
      ]) {
        if (input[field] === undefined) continue;
        if (!input[field] || typeof input[field] !== 'object' || Array.isArray(input[field])) { errors.push(`${level === 'piece' ? 'Piece' : 'Section'} overrides must be an object.`); continue; }
        const next = { ...(current[field] || {}) };
        for (const [key, value] of Object.entries(input[field])) {
          if (value === null) { delete next[key]; continue; }
          // Resending an override unchanged is not setting it, so a kept override
          // whose target has left the table of contents does not block other saves.
          const unchanged = Object.hasOwn(next, key) && JSON.stringify(next[key]) === JSON.stringify(value);
          if (!unchanged && !exists(key)) { errors.push(`“${name(key)}” is not a ${level} in this book's table of contents.`); continue; }
          next[key] = value;
        }
        merged[field] = next;
      }
      const { design, errors: found } = validateDesign(merged);
      errors.push(...found);
      if (errors.length || !design) throw invalid(errors.join(' '));
      await writeAtomic(path.join(this.stateDirectory, 'design.json'), `${JSON.stringify(design, null, 2)}\n`);
      return design;
    });
  }
  // The latest verified book-order page map: book page numbers for isolated proofs and for the book tree.
  /** Reads the pinned reference edition's page mappings. */
  async referenceMap() {
    for (const name of ['reference-map.json', 'page-map.json']) {
      try {
        const map = JSON.parse(await readFile(path.join(this.buildsDirectory, name), 'utf8'));
        if (map?.schemaVersion >= 3 && (map.mode ?? 'prefix') === 'prefix' && map.pagination?.verified) return map;
      } catch { /* try the next */ }
    }
    return null;
  }
  /** Validates and persists updated reference page mappings. */
  async saveReferenceMap(manifest) { await writeAtomic(path.join(this.buildsDirectory, 'reference-map.json'), `${JSON.stringify(manifest, null, 2)}\n`); }
  /** Reads the current live proof build state. */
  async liveBuildStatus() { try { return JSON.parse(await readFile(path.join(this.liveBuildsDirectory, 'latest.json'), 'utf8')); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }
  /** Schedules a proof build using the submitted revision and settings. */
  async queueLiveBuild(scopeId = 'book') {
    const [proof, graph] = await Promise.all([this.buildStatus(), this.graph({ refresh: true })]);
    const scope = scopeFromGraph(graph, scopeId);
    if (!proof?.ok || !ProjectStore.aliasesOf(scope).includes(proof.targetScope?.id)) {
      const error = new Error('Create a successful proof for this exact scope before sending it to the live-build queue.'); error.code = 'LIVE_BUILD_REQUIRES_PROOF'; throw error;
    }
    for (const [nodeId, hash] of Object.entries(proof.sourceHashes || {})) {
      if (graph.nodes.find((node) => node.id === nodeId)?.hash !== hash) {
        const error = new Error('The manuscript changed after this proof. Typeset it again before sending it to the live-build queue.'); error.code = 'STALE_BUILD'; throw error;
      }
    }
    if (!Object.keys(proof.sourceHashes || {}).length) {
      const error = new Error('This proof has no source manifest. Typeset it again before sending it to the live-build queue.'); error.code = 'LIVE_BUILD_REQUIRES_PROOF'; throw error;
    }
    if (proof.pageMap?.mode === 'isolated') {
      const error = new Error('This is a proof of the section alone. Typeset it in book order before sending it to the live-build queue.'); error.code = 'LIVE_BUILD_REQUIRES_BOOK_ORDER'; throw error;
    }
    if ((proof.pageMap?.designHash ?? designHash({})) !== designHash(await this.design())) {
      const error = new Error('The design profile changed after this proof. Typeset it again before sending it to the live-build queue.'); error.code = 'STALE_BUILD'; throw error;
    }
    // The table of contents is source too: an added, removed or reordered node changes the book.
    const current = graph.readingOrder.slice(0, graph.readingOrder.indexOf(scope.buildThroughNodeId) + 1);
    if (JSON.stringify(current) !== JSON.stringify(proof.includedNodeIds || [])) {
      const error = new Error('The table of contents changed after this proof. Typeset it again before sending it to the live-build queue.'); error.code = 'STALE_BUILD'; throw error;
    }
    if (!(proof.pageMap?.schemaVersion >= 3 && proof.pageMap.pagination?.verified === true)) {
      const error = new Error('This proof has no compiler-verified page map. Resolve the pagination warnings and typeset it again.'); error.code = 'PAGINATION_UNVERIFIED'; throw error;
    }
    const id = `handoff-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const artifact = { pdf: `${id}.pdf`, pageMap: `${id}.page-map.json` };
    await copyFile(this.previewPath(), path.join(this.liveBuildsDirectory, artifact.pdf));
    await writeAtomic(path.join(this.liveBuildsDirectory, artifact.pageMap), `${JSON.stringify(proof.pageMap || {}, null, 2)}\n`);
    const record = { schemaVersion: 1, id, status: 'queued-locally', queuedAt: new Date().toISOString(), targetScope: scope, sourceHashes: proof.sourceHashes, proofCompletedAt: proof.completedAt, artifact, note: 'A verified local proof is staged for the configured live-build delivery adapter. No remote build was claimed or started.' };
    await writeAtomic(path.join(this.liveBuildsDirectory, `${id}.json`), `${JSON.stringify(record, null, 2)}\n`);
    await writeAtomic(path.join(this.liveBuildsDirectory, 'latest.json'), `${JSON.stringify(record, null, 2)}\n`);
    return record;
  }
}
