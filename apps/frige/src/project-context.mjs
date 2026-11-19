// stex.project.context.v1: the owner exports explicit, revision-checked text.
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { sourceHash } from './project-store-vault.mjs';

const failure = (status, code, message) => Object.assign(new Error(message), { status, code });
export async function validateContextTree(store) {
    // Refresh reads Programme.md and source text. Validate the tree before any
    // graph read, including a symlinked Programme or manuscript junction.
    const root = await realpath(store.manuscriptDirectory);
    if ((await lstat(store.root)).isSymbolicLink() || !root.startsWith(`${await realpath(store.root)}${path.sep}`)) throw failure(403, 'FORBIDDEN', 'Linked project directories cannot be exported.');
    if ((await lstat(store.manuscriptDirectory)).isSymbolicLink()) throw failure(403, 'FORBIDDEN', 'Linked manuscript directories cannot be exported.');
    let visited = 0;
    async function inspect(directory) {
      for (const name of await readdir(directory)) {
        if (++visited > 10000) throw failure(413, 'CONTEXT_LIMIT', 'This manuscript is too large to inspect for context.');
        const file = path.join(directory, name); const info = await lstat(file);
        if (info.isSymbolicLink() || !(await realpath(file)).startsWith(`${root}${path.sep}`)) throw failure(403, 'FORBIDDEN', 'Linked manuscript sources cannot be exported.');
        if (info.isDirectory()) await inspect(file);
      }
    }
    await inspect(store.manuscriptDirectory);
    return root;
}
export async function projectContext(store, id, { sourceId, revision, offset = '0' } = {}) {
  try {
    const root = await validateContextTree(store);
    const graph = await store.graph({ refresh: true });
    const project = { application: 'frige', id, title: graph.book.title, reference: `stex://frige/project/${id}` };
    async function describe(node, content = false) {
      const file = store.sourcePath(node.relativePath);
      const info = await lstat(file); const resolved = await realpath(file);
      if (!info.isFile() || info.isSymbolicLink() || !resolved.startsWith(`${root}${path.sep}`)) throw failure(403, 'FORBIDDEN', 'This source is outside the selected manuscript.');
      const entry = { id: node.id, title: node.title, reference: `${project.reference}#source=${encodeURIComponent(node.id)}`, revision: node.hash, mediaType: 'text/markdown', bytes: info.size, available: info.size <= 12000 };
      if (content) {
        if (!entry.available) throw failure(413, 'CONTEXT_LIMIT', 'This source exceeds the 12,000-byte context limit.');
        const bytes = await readFile(file);
        let source; try { source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); } catch { throw failure(400, 'INVALID_SOURCE', 'This source is not valid UTF-8 text.'); }
        if (bytes.length > 12000) throw failure(413, 'CONTEXT_LIMIT', 'This source exceeds the context limit.');
        if (!/^[a-f0-9]{64}$/.test(revision || '') || sourceHash(source) !== revision) throw failure(409, 'STALE_SOURCE', 'The source changed. Refresh and preview it again.');
        return { ...entry, revision, bytes: Buffer.byteLength(source), source };
      }
      return entry;
    }
    if (sourceId) {
      const node = graph.nodes.find((entry) => entry.id === sourceId);
      if (!node) throw failure(404, 'NOT_FOUND', 'The selected manuscript source does not exist.');
      return { schemaVersion: 'stex.project.context.v1', project, source: await describe(node, true) };
    }
    if (!/^\d{1,6}$/.test(String(offset))) throw failure(400, 'INVALID_REQUEST', 'Invalid source page.');
    const start = Number(offset); const nodes = graph.nodes.slice(start, start + 50);
    return { schemaVersion: 'stex.project.context.v1', project, sources: await Promise.all(nodes.map((node) => describe(node))), nextOffset: start + 50 < graph.nodes.length ? start + 50 : null };
  } catch (error) {
    if (error.status) throw error;
    throw failure(503, 'UNAVAILABLE', 'The selected publishing source is unavailable.');
  }
}
