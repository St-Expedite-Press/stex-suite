import { createHash, randomUUID } from 'node:crypto';
import { access, copyFile, mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { writeAtomic } from './project-store.mjs';
import { parseManuscript } from './document/parser.mjs';
import { designHash, normalizeDesign, validateDesign } from './design-settings.mjs';

const MAX_SOURCE = 400_000;
const SCOPE_SOURCE_BUDGET = 60_000;
const NODE_ID = /^[a-z][a-z0-9-]{5,80}$/;
export const sourceHash = (value) => createHash('sha256').update(value, 'utf8').digest('hex');
const nodeIdFor = (relativePath) => `node-${sourceHash(relativePath.replaceAll('\\', '/').toLowerCase()).slice(0, 20)}`;

async function exists(file) { try { await access(file, constants.F_OK); return true; } catch { return false; } }
function safeRelative(value) {
  const normalized = String(value || '').replaceAll('\\', '/').replace(/^\/+/, '');
  if (!normalized || normalized.split('/').some((part) => part === '..' || !part)) throw new Error('Invalid project-relative path.');
  return normalized;
}
function contained(root, relative) {
  const resolved = path.resolve(root, safeRelative(relative));
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) throw new Error('Path escapes the project.');
  return resolved;
}
function titleOf(source, fallback) {
  const heading = /^#{1,3}\s+(.+)$/m.exec(source)?.[1]?.trim();
  return heading || fallback.replace(/\.md$/i, '').replaceAll(/[-_]/g, ' ');
}
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
function diagnosticsFor(relative, source) {
  const diagnostics = [];
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(source)) diagnostics.push({ code: 'control-characters', nodePath: relative, message: 'Invisible control characters are present; the proof omits them.' });
  // Editorial sections print as footnotes; one without reviewer comments prints nothing.
  const emptyNotes = parseManuscript(source).blocks.filter((block) => block.type === 'note' && !block.entries.length).length;
  if (emptyNotes) diagnostics.push({ code: 'empty-editorial-note', nodePath: relative, message: 'An Editorial section has no reviewer comments in the expected form (**Name — score** followed by > quotes), so no footnote prints for it.' });
  return diagnostics;
}

const text = (value) => typeof value === 'string' && value.length > 0;
function partShapeProblem(part) {
  if (!part || typeof part !== 'object') return 'A part must be an object.';
  if (part.type === 'text') return text(part.text) ? null : 'A text part needs text.';
  if (part.type === 'artifact') return ['code', 'document', 'data', 'image'].includes(part.kind) && typeof part.content === 'string' && text(part.title) ? null : 'An artifact needs a kind, a title and content.';
  if (part.type === 'choice') return text(part.id) && text(part.prompt) && Array.isArray(part.options) && part.options.length >= 2 && part.options.every((option) => text(option?.id) && text(option?.label)) ? null : 'A choice needs an id, a prompt and labelled options.';
  if (part.type === 'form') return text(part.id) && Array.isArray(part.fields) && part.fields.length > 0 && part.fields.every((field) => text(field?.id) && text(field?.label) && ['text', 'textarea', 'select', 'number', 'checkbox'].includes(field.kind) && (field.kind !== 'select' || (Array.isArray(field.options) && field.options.every(text)))) ? null : 'A form needs an id and labelled fields of known kinds.';
  return 'Unknown part type.';
}

// The declared type of an image must match its file signature.
function imageSignature(bytes) {
  if (bytes.length > 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length > 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (bytes.length > 6 && /^GIF8[79]a$/.test(bytes.toString('ascii', 0, 6))) return 'image/gif';
  return null;
}

const invalidAnswer = (message) => Object.assign(new Error(message), { code: 'INVALID_ANSWER' });
// Normalizes an answer against its prompt and writes the readable summary sent to Hermes.
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

function canonicalBook(root, nodes, readingOrder) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const ordered = readingOrder.map((id) => byId.get(id)).filter(Boolean);
  const programme = nodes.find((node) => node.kind === 'programme');
  const sections = [];
  let current = null;
  const sectionName = (node) => {
    const folder = node.relativePath.split('/')[0] || 'Manuscript';
    return folder.replace(/^\d+[_-]?/, '').replaceAll('_', ' ').replaceAll('-', ' ').trim() || 'Manuscript';
  };
  const startSection = (node, title, kind = 'section', folder = '') => {
    current = { id: `scope-${node.id}`, kind, title, folder, anchorNodeId: node.id, nodeIds: [], buildThroughNodeId: node.id };
    sections.push(current);
  };
  for (const node of ordered) {
    const folder = node.relativePath.split('/')[0] || '';
    if (!current || current.folder !== folder) {
      const title = node.kind === 'front-matter' ? 'Front matter' : node.kind === 'back-matter' ? 'Back matter' : sectionName(node);
      const kind = node.kind === 'back-matter' ? 'back-matter' : node.kind === 'front-matter' ? 'front-matter' : 'section';
      startSection(node, title, kind, folder);
    }
    current.nodeIds.push(node.id);
    current.buildThroughNodeId = node.id;
  }
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

function scopeFromGraph(graph, id = 'book') {
  if (id === 'book') return graph.book;
  const section = graph.book?.sections?.find((entry) => entry.id === id);
  if (section) return section;
  const node = graph.nodes.find((entry) => entry.id === id);
  if (!node) throw new Error('Graph scope not found.');
  return { id: node.id, kind: 'node', title: node.title, anchorNodeId: node.id, nodeIds: [node.id], buildThroughNodeId: node.id };
}

export class ProjectStore {
  constructor(root) {
    this.root = path.resolve(root);
    this.manuscriptDirectory = path.join(this.root, 'manuscript');
    this.stateDirectory = path.join(this.root, '.texgraph');
    this.graphPath = path.join(this.stateDirectory, 'graph.json');
    this.conversationsDirectory = path.join(this.stateDirectory, 'conversations');
    this.proposalsDirectory = path.join(this.stateDirectory, 'proposals');
    this.buildsDirectory = path.join(this.stateDirectory, 'builds');
    this.liveBuildsDirectory = path.join(this.stateDirectory, 'live-builds');
    this.refreshing = null;
    this.writes = Promise.resolve();
    this.answering = new Set();
  }

  // Manuscript writes and change-set decisions run one at a time, so a hash check
  // and the write it guards can never interleave with another write.
  exclusive(task) {
    const run = this.writes.then(task, task);
    this.writes = run.catch(() => {});
    return run;
  }

  sourcePath(relativePath) { return contained(this.manuscriptDirectory, relativePath); }
  nodePath(id) { if (!NODE_ID.test(id)) throw new Error('Invalid graph node id.'); return id; }
  // Book, section and page conversations are separate threads keyed by scope id.
  scopeKey(scopeId) { return scopeId === 'book' ? 'book' : this.nodePath(scopeId); }
  conversationPath(scopeId) { return path.join(this.conversationsDirectory, `${this.scopeKey(scopeId)}.jsonl`); }
  changeSetPath(scopeId) { return path.join(this.proposalsDirectory, `${this.scopeKey(scopeId)}.json`); }

  async initialize() {
    if (!(await exists(this.manuscriptDirectory))) throw new Error('This project does not contain a manuscript directory.');
    await Promise.all([mkdir(this.conversationsDirectory, { recursive: true }), mkdir(this.proposalsDirectory, { recursive: true }), mkdir(this.buildsDirectory, { recursive: true }), mkdir(this.liveBuildsDirectory, { recursive: true })]);
    const graph = await this.graph();
    return graph.schemaVersion >= 4 ? graph : this.refreshGraph();
  }

  async refreshGraph() {
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.#refreshGraph();
    try {
      return await this.refreshing;
    } finally {
      this.refreshing = null;
    }
  }

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
    const book = canonicalBook(this.root, nodes, order);
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

  async graph({ refresh = false } = {}) { return refresh || !(await exists(this.graphPath)) ? this.refreshGraph() : JSON.parse(await readFile(this.graphPath, 'utf8')); }
  async scope(id = 'book') {
    const graph = await this.graph();
    return scopeFromGraph(graph, id === 'book' ? id : this.nodePath(id));
  }
  async settingsTicket() { try { return JSON.parse(await readFile(path.join(this.root, 'texgraph', 'settings.json'), 'utf8')); } catch { return {}; } }
  async node(id) {
    const graph = await this.graph();
    const summary = graph.nodes.find((entry) => entry.id === this.nodePath(id));
    if (!summary) throw new Error('Graph node not found.');
    const source = await readFile(this.sourcePath(summary.relativePath), 'utf8');
    return { ...summary, source, hash: sourceHash(source) };
  }
  updateNode(id, source, baseHash) { return this.exclusive(() => this.#writeNode(id, source, baseHash)); }
  async #writeNode(id, source, baseHash) {
    if (typeof source !== 'string' || source.length > MAX_SOURCE) throw new Error('Source must be Markdown under 400 KB.');
    const node = await this.node(id);
    if (baseHash && baseHash !== node.hash) { const error = new Error('This manuscript node changed on disk. Reload it before saving.'); error.code = 'STALE_SOURCE'; throw error; }
    await writeAtomic(this.sourcePath(node.relativePath), source);
    await this.refreshGraph();
    return this.node(id);
  }
  async appendTurn(scopeId, turn) {
    await this.scope(scopeId);
    const record = { id: randomUUID(), at: new Date().toISOString(), scopeId, ...turn };
    await writeFile(this.conversationPath(scopeId), `${JSON.stringify(record)}\n`, { encoding: 'utf8', flag: 'a' });
    return record;
  }
  async turns(scopeId, limit = 40) {
    const scope = await this.scope(scopeId);
    const read = async (key) => { try { return (await readFile(this.conversationPath(key), 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse); } catch (error) { if (error.code === 'ENOENT') return []; throw error; } };
    // Earlier versions saved book and section turns in their anchor node's file, tagged with the scope id.
    const own = (await read(scopeId)).filter((turn) => !turn.scopeId || turn.scopeId === scopeId);
    const legacy = scope.kind === 'node' || !scope.anchorNodeId ? [] : (await read(scope.anchorNodeId)).filter((turn) => turn.scopeId === scopeId);
    return [...legacy, ...own].sort((left, right) => left.at.localeCompare(right.at)).slice(-limit);
  }
  // Artifacts from Hermes replies are product state: metadata and content under
  // .texgraph/artifacts, referenced from turns by id so threads stay small.
  artifactPath(id, extension) { if (!/^art-[a-f0-9]{16}$/.test(id)) throw new Error('Invalid artifact id.'); return path.join(this.stateDirectory, 'artifacts', `${id}.${extension}`); }
  async storeParts(scopeId, parts = [], meta = null) {
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
  async artifact(id) { try { return JSON.parse(await readFile(this.artifactPath(id, 'json'), 'utf8')); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }
  async artifactContent(id) { const record = await this.artifact(id); return record ? { record, content: await readFile(this.artifactPath(id, 'data')) } : null; }
  async artifacts() {
    const directory = path.join(this.stateDirectory, 'artifacts');
    const names = await readdir(directory).catch(() => []);
    const records = await Promise.all(names.filter((name) => /^art-[a-f0-9]{16}\.json$/.test(name)).map((name) => this.artifact(name.slice(0, -5))));
    return records.filter(Boolean).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }
  // An answer must match a stored prompt in this scope's thread, once, with valid values.
  // It is reserved while Hermes replies and recorded only once Hermes has it, so a
  // failed turn leaves the question open to answer again.
  reserveAnswer(scopeId, promptId, values) {
    return this.exclusive(async () => {
      const thread = await this.turns(scopeId, 100_000);
      const prompt = thread.flatMap((turn) => turn.parts || []).find((part) => part.promptId === promptId);
      if (!prompt) throw Object.assign(new Error('This question is not part of the conversation.'), { code: 'UNKNOWN_PROMPT' });
      const key = `${scopeId}::${promptId}`;
      if (this.answering.has(key) || thread.some((turn) => turn.kind === 'answer' && turn.promptId === promptId)) throw Object.assign(new Error('This question has already been answered.'), { code: 'ALREADY_ANSWERED' });
      const { normalized, summary } = answerFor(prompt, values);
      this.answering.add(key);
      return { scopeId, promptId, key, partId: prompt.id, values: normalized, message: summary };
    });
  }
  // Committing runs under the same lock as reserving, so a concurrent reservation always
  // sees the answer either as reserved or as written, never as neither.
  commitAnswer(reservation) {
    return this.exclusive(async () => {
      try { return await this.appendTurn(reservation.scopeId, { role: 'user', kind: 'answer', promptId: reservation.promptId, partId: reservation.partId, values: reservation.values, message: reservation.message }); }
      finally { this.answering.delete(reservation.key); }
    });
  }
  releaseAnswer(reservation) { this.answering.delete(reservation.key); }
  async recordAnswer(scopeId, promptId, values) { return this.commitAnswer(await this.reserveAnswer(scopeId, promptId, values)); }
  // What the director is shown for a scope: the book offers its table of contents,
  // a section or page each of its nodes, within a size budget.
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
  // Records the director's proposed replacements as one pending change set for the
  // scope. A change may only replace a node whose exact text was offered.
  createChangeSet(scopeId, proposal, offered) { return this.exclusive(() => this.#createChangeSet(scopeId, proposal, offered)); }
  async #createChangeSet(scopeId, { commentary = '', changes = [] }, offered) {
    const kept = []; const dropped = [];
    for (const change of Array.isArray(changes) ? changes : []) {
      const base = offered.find((entry) => entry.nodeId === change?.nodeId);
      if (!base) { dropped.push({ nodeId: String(change?.nodeId || '').slice(0, 100), reason: 'This node was not offered in the conversation scope.' }); continue; }
      if (typeof change.source !== 'string' || change.source.length > MAX_SOURCE) { dropped.push({ nodeId: base.nodeId, reason: 'The proposed source is invalid.' }); continue; }
      if (kept.some((entry) => entry.nodeId === base.nodeId)) { dropped.push({ nodeId: base.nodeId, reason: 'Only one change per node is kept.' }); continue; }
      // Keep the file's own line endings; a reply in another convention would otherwise rewrite every line unseen.
      const source = base.source.includes('\r\n') ? change.source.replace(/\r?\n/g, '\r\n') : change.source.replace(/\r\n/g, '\n');
      if (source === base.source) continue;
      kept.push({ nodeId: base.nodeId, relativePath: base.relativePath, title: base.title, baseHash: base.hash, afterHash: sourceHash(source), before: base.source, source, summary: String(change.summary || '').slice(0, 500), status: 'pending' });
    }
    if (!kept.length) return { changeSet: null, dropped };
    const record = { schemaVersion: 2, id: randomUUID(), scopeId, createdAt: new Date().toISOString(), commentary: String(commentary).slice(0, 12000), status: 'pending', changes: kept, dropped };
    await writeAtomic(this.changeSetPath(scopeId), `${JSON.stringify(record, null, 2)}\n`);
    return { changeSet: record, dropped };
  }
  async changeSet(scopeId) {
    // A file without changes is a single-page proposal from before change sets; it cannot be reviewed as a diff.
    try { const record = JSON.parse(await readFile(this.changeSetPath(scopeId), 'utf8')); return Array.isArray(record?.changes) ? record : null; } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  // Accepting writes through updateNode, so a node that changed since the proposal is marked stale, never overwritten.
  decideChanges(scopeId, changeSetId, decision) { return this.exclusive(() => this.#decideChanges(scopeId, changeSetId, decision)); }
  async #decideChanges(scopeId, changeSetId, { nodeId = null, decision }) {
    if (!['accept', 'reject'].includes(decision)) throw new Error('Decision must be accept or reject.');
    const record = await this.changeSet(scopeId);
    if (!record || record.id !== changeSetId) throw new Error('This change set is no longer current.');
    const targets = record.changes.filter((change) => change.status === 'pending' && (!nodeId || change.nodeId === nodeId));
    if (!targets.length) throw new Error('No pending change matches.');
    try {
      for (const change of targets) {
        change.decidedAt = new Date().toISOString();
        if (decision === 'reject') { change.status = 'rejected'; continue; }
        try { await this.#writeNode(change.nodeId, change.source, change.baseHash); change.status = 'accepted'; }
        catch (error) { change.status = error.code === 'STALE_SOURCE' ? 'stale' : 'failed'; change.error = error.message; }
      }
    } finally {
      record.status = record.changes.some((change) => change.status === 'pending') ? 'pending' : 'resolved';
      await writeAtomic(this.changeSetPath(scopeId), `${JSON.stringify(record, null, 2)}\n`);
    }
    await this.appendTurn(scopeId, { role: 'system', kind: 'changes-decided', changeSetId, decisions: targets.map((change) => ({ nodeId: change.nodeId, title: change.title, status: change.status, beforeHash: change.baseHash, afterHash: change.afterHash })) });
    return record;
  }
  async approvedSourceExcerpts() {
    try {
      const documents = JSON.parse(await readFile(path.join(this.stateDirectory, 'documents.json'), 'utf8'));
      const approved = Array.isArray(documents) ? documents.filter((entry) => entry.contextState === 'approved' && typeof entry.extraction === 'string').slice(0, 8) : [];
      return Promise.all(approved.map(async (entry) => ({ id: entry.id, name: entry.name, excerpt: (await readFile(contained(this.stateDirectory, entry.extraction), 'utf8')).slice(0, 6000) })));
    } catch { return []; }
  }
  buildDirectory() { return this.buildsDirectory; }
  previewPath() { return path.join(this.buildsDirectory, 'current.pdf'); }
  async buildStatus() { try { return JSON.parse(await readFile(path.join(this.buildsDirectory, 'last.json'), 'utf8')); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }
  async activateBuild(directory, manifest) { const staged = path.join(this.buildsDirectory, `current-${randomUUID()}`); await copyFile(path.join(directory, 'document.pdf'), `${staged}.pdf`); await writeAtomic(`${staged}.json`, `${JSON.stringify(manifest, null, 2)}\n`); await rename(`${staged}.pdf`, this.previewPath()); await rename(`${staged}.json`, path.join(this.buildsDirectory, 'page-map.json')); }
  async recordBuild(result) { const record = { completedAt: new Date().toISOString(), lastSuccessful: await exists(this.previewPath()), ...result, log: String(result.log || '').slice(-60000) }; await writeAtomic(path.join(this.buildsDirectory, 'last.json'), `${JSON.stringify(record, null, 2)}\n`); return record; }
  // The book's publication profile is product state, kept beside the proofs, not in the vault.
  async design() { try { return normalizeDesign(JSON.parse(await readFile(path.join(this.stateDirectory, 'design.json'), 'utf8'))); } catch { return normalizeDesign({}); } }
  saveDesign(input) {
    return this.exclusive(async () => {
      if (!input || typeof input !== 'object' || Array.isArray(input)) { const error = new Error('A design profile must be an object of settings.'); error.code = 'INVALID_DESIGN'; throw error; }
      // Fields left out keep their saved values.
      const current = await this.design();
      const { design, errors } = validateDesign({ ...current, ...input, margins: { ...current.margins, ...(input.margins && typeof input.margins === 'object' ? input.margins : {}) } });
      if (!design) { const error = new Error(errors.join(' ')); error.code = 'INVALID_DESIGN'; throw error; }
      await writeAtomic(path.join(this.stateDirectory, 'design.json'), `${JSON.stringify(design, null, 2)}\n`);
      return design;
    });
  }
  // The latest verified book-order page map: book page numbers for isolated proofs and for the book tree.
  async referenceMap() {
    for (const name of ['reference-map.json', 'page-map.json']) {
      try {
        const map = JSON.parse(await readFile(path.join(this.buildsDirectory, name), 'utf8'));
        if (map?.schemaVersion >= 3 && (map.mode ?? 'prefix') === 'prefix' && map.pagination?.verified) return map;
      } catch { /* try the next */ }
    }
    return null;
  }
  async saveReferenceMap(manifest) { await writeAtomic(path.join(this.buildsDirectory, 'reference-map.json'), `${JSON.stringify(manifest, null, 2)}\n`); }
  async liveBuildStatus() { try { return JSON.parse(await readFile(path.join(this.liveBuildsDirectory, 'latest.json'), 'utf8')); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }
  async queueLiveBuild(scopeId = 'book') {
    const [proof, graph] = await Promise.all([this.buildStatus(), this.graph({ refresh: true })]);
    const scope = scopeFromGraph(graph, scopeId);
    if (!proof?.ok || proof.targetScope?.id !== scope.id) {
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
