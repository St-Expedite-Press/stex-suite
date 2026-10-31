import { createHash, randomUUID } from 'node:crypto';
import { access, copyFile, mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { writeAtomic } from './project-store.mjs';

const MAX_SOURCE = 400_000;
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
  if (/^---\s*$[\s\S]{0,4000}^#{2,4}\s+Editorial\b/im.test(source)) diagnostics.push({ code: 'editorial-block', nodePath: relative, message: 'Editorial material appears after a manuscript separator; review it before assembly.' });
  return diagnostics;
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
  }

  sourcePath(relativePath) { return contained(this.manuscriptDirectory, relativePath); }
  nodePath(id) { if (!NODE_ID.test(id)) throw new Error('Invalid graph node id.'); return id; }
  conversationPath(id) { return path.join(this.conversationsDirectory, `${this.nodePath(id)}.jsonl`); }
  proposalPath(id) { return path.join(this.proposalsDirectory, `${this.nodePath(id)}.json`); }

  async initialize() {
    if (!(await exists(this.manuscriptDirectory))) throw new Error('This project does not contain a manuscript directory.');
    await Promise.all([mkdir(this.conversationsDirectory, { recursive: true }), mkdir(this.proposalsDirectory, { recursive: true }), mkdir(this.buildsDirectory, { recursive: true })]);
    return this.refreshGraph();
  }

  async refreshGraph() {
    const programmeRelative = 'Programme.md';
    const programmeFile = this.sourcePath(programmeRelative);
    if (!(await exists(programmeFile))) throw new Error('manuscript/Programme.md is required as the reading-order authority.');
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
      if (!node) diagnostics.push({ code: 'unresolved-programme-link', nodePath: programmeRelative, target, message: `Programme link does not resolve: ${target}` });
      else if (!order.includes(node.id)) order.push(node.id);
    }
    const graph = {
      schemaVersion: 1, generatedAt: new Date().toISOString(), programmePath: `manuscript/${programmeRelative}`,
      nodes, readingOrder: order, diagnostics,
      rendered: prior?.rendered || { pages: [], spreads: [], buildId: null },
    };
    await writeAtomic(this.graphPath, `${JSON.stringify(graph, null, 2)}\n`);
    return graph;
  }

  async graph({ refresh = false } = {}) { return refresh || !(await exists(this.graphPath)) ? this.refreshGraph() : JSON.parse(await readFile(this.graphPath, 'utf8')); }
  async settingsTicket() { try { return JSON.parse(await readFile(path.join(this.root, 'texgraph', 'settings.json'), 'utf8')); } catch { return {}; } }
  async node(id) {
    const graph = await this.graph({ refresh: true });
    const summary = graph.nodes.find((entry) => entry.id === this.nodePath(id));
    if (!summary) throw new Error('Graph node not found.');
    const source = await readFile(this.sourcePath(summary.relativePath), 'utf8');
    return { ...summary, source, hash: sourceHash(source) };
  }
  async updateNode(id, source, baseHash) {
    if (typeof source !== 'string' || source.length > MAX_SOURCE) throw new Error('Source must be Markdown under 400 KB.');
    const node = await this.node(id);
    if (baseHash && baseHash !== node.hash) { const error = new Error('This manuscript node changed on disk. Reload it before saving.'); error.code = 'STALE_SOURCE'; throw error; }
    await writeAtomic(this.sourcePath(node.relativePath), source);
    await this.refreshGraph();
    return this.node(id);
  }
  async appendTurn(id, turn) {
    await this.node(id);
    const record = { id: randomUUID(), at: new Date().toISOString(), ...turn };
    await writeFile(this.conversationPath(id), `${JSON.stringify(record)}\n`, { encoding: 'utf8', flag: 'a' });
    return record;
  }
  async turns(id, limit = 12) {
    await this.node(id);
    try { return (await readFile(this.conversationPath(id), 'utf8')).trim().split('\n').filter(Boolean).slice(-limit).map(JSON.parse); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  }
  async createProposal(id, proposal) {
    const node = await this.node(id);
    if (typeof proposal.source !== 'string' || proposal.source.length > MAX_SOURCE) throw new Error('Proposed Markdown is invalid.');
    const record = { id: randomUUID(), nodeId: node.id, createdAt: new Date().toISOString(), baseHash: node.hash, beforeHash: node.hash, afterHash: sourceHash(proposal.source), commentary: String(proposal.commentary || ''), source: proposal.source, status: 'pending' };
    await writeAtomic(this.proposalPath(id), `${JSON.stringify(record, null, 2)}\n`); return record;
  }
  async proposal(id) { try { return JSON.parse(await readFile(this.proposalPath(id), 'utf8')); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }
  async approvedSourceExcerpts() {
    try {
      const documents = JSON.parse(await readFile(path.join(this.stateDirectory, 'documents.json'), 'utf8'));
      const approved = Array.isArray(documents) ? documents.filter((entry) => entry.contextState === 'approved' && typeof entry.extraction === 'string').slice(0, 8) : [];
      return Promise.all(approved.map(async (entry) => ({ id: entry.id, name: entry.name, excerpt: (await readFile(contained(this.stateDirectory, entry.extraction), 'utf8')).slice(0, 6000) })));
    } catch { return []; }
  }
  async acceptProposal(id, proposalId) {
    const proposal = await this.proposal(id); if (!proposal || proposal.id !== proposalId || proposal.status !== 'pending') throw new Error('Pending proposal not found.');
    const node = await this.node(id); if (node.hash !== proposal.baseHash) { const error = new Error('The proposal is stale because the manuscript changed.'); error.code = 'STALE_PROPOSAL'; throw error; }
    const accepted = await this.updateNode(id, proposal.source, proposal.baseHash);
    proposal.status = 'accepted'; proposal.acceptedAt = new Date().toISOString(); await writeAtomic(this.proposalPath(id), `${JSON.stringify(proposal, null, 2)}\n`);
    await this.appendTurn(id, { role: 'system', kind: 'proposal-accepted', proposalId: proposal.id, beforeHash: proposal.beforeHash, afterHash: proposal.afterHash }); return accepted;
  }
  async rejectProposal(id, proposalId) { const proposal = await this.proposal(id); if (!proposal || proposal.id !== proposalId || proposal.status !== 'pending') throw new Error('Pending proposal not found.'); proposal.status = 'rejected'; proposal.rejectedAt = new Date().toISOString(); await writeAtomic(this.proposalPath(id), `${JSON.stringify(proposal, null, 2)}\n`); return proposal; }
  buildDirectory() { return this.buildsDirectory; }
  previewPath() { return path.join(this.buildsDirectory, 'current.pdf'); }
  async buildStatus() { try { return JSON.parse(await readFile(path.join(this.buildsDirectory, 'last.json'), 'utf8')); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }
  async activateBuild(directory, manifest) { const staged = path.join(this.buildsDirectory, `current-${randomUUID()}`); await copyFile(path.join(directory, 'document.pdf'), `${staged}.pdf`); await writeAtomic(`${staged}.json`, `${JSON.stringify(manifest, null, 2)}\n`); await rename(`${staged}.pdf`, this.previewPath()); await rename(`${staged}.json`, path.join(this.buildsDirectory, 'page-map.json')); }
  async recordBuild(result) { const record = { completedAt: new Date().toISOString(), lastSuccessful: await exists(this.previewPath()), ...result, log: String(result.log || '').slice(-60000) }; await writeAtomic(path.join(this.buildsDirectory, 'last.json'), `${JSON.stringify(record, null, 2)}\n`); return record; }
}
