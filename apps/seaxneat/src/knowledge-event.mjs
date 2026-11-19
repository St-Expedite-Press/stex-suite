// Explicit accepted-source observation; engine-owned checkpoint, no source text.
import { createHash, randomUUID } from 'node:crypto';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { projectContext } from './project-context.mjs';

const queues = new WeakMap();
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const failure = (status, code, message) => Object.assign(new Error(message), { status, code });
function selection(id, body) {
  if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(id) || !body || !Array.isArray(body.sources) || body.sources.length > 4) throw failure(400, 'INVALID_REQUEST', 'Choose a known project and at most four revision-checked sources.');
  const entries = body.sources.map((entry) => {
    if (!entry || typeof entry.id !== 'string' || !/^[a-z][a-z0-9-]{0,80}$/.test(entry.id) || typeof entry.revision !== 'string' || !/^[a-f0-9]{64}$/.test(entry.revision)) throw failure(400, 'INVALID_REQUEST', 'Choose revision-checked sources.');
    return { id: entry.id, revision: entry.revision };
  }).sort((a, b) => a.id.localeCompare(b.id));
  if (new Set(entries.map((entry) => entry.id)).size !== entries.length) throw failure(400, 'INVALID_REQUEST', 'A source can be selected only once.');
  return entries;
}

export async function knowledgeEvent(store, id, body) {
  const requested = selection(id, body);
  const task = (queues.get(store) || Promise.resolve()).catch(() => {}).then(async () => {
    try {
      const catalog = await projectContext(store, id);
      const { revision, ...project } = catalog.project;
      const sources = [];
      for (const entry of requested) {
        const exported = await projectContext(store, id, { sourceId: entry.id, revision: entry.revision });
        if (exported.project.revision !== revision) throw failure(409, 'STALE_SOURCE', 'The validated project revision changed. Refresh the source selection.');
        const { source, ...metadata } = exported.source;
        sources.push(metadata);
      }
      const digest = hash({ project, sources });
      const file = path.join(store.projectDirectory(id), 'knowledge-observation.json');
      let previous = null;
      try {
        const raw = await readFile(file, 'utf8');
        if (Buffer.byteLength(raw) > 65536) throw new Error('Oversized checkpoint');
        previous = JSON.parse(raw);
        if (previous.digest !== hash({ project: previous.event.project, sources: previous.event.sources }) || previous.event.schemaVersion !== 'stex.knowledge.event.v1' || previous.event.project.reference !== project.reference || !Number.isSafeInteger(previous.event.sequence) || previous.event.sequence < 1 || previous.event.id !== hash({ project: previous.event.project, sequence: previous.event.sequence, sources: previous.event.sources })) throw new Error('Invalid checkpoint');
      } catch (error) { if (error.code !== 'ENOENT') throw failure(503, 'UNAVAILABLE', 'The knowledge observation checkpoint is unavailable.'); }
      if (previous?.digest === digest) return previous.event;
      const sequence = (previous?.event.sequence || 0) + 1;
      if (!Number.isSafeInteger(sequence)) throw failure(503, 'UNAVAILABLE', 'The knowledge observation sequence is exhausted.');
      const event = { schemaVersion: 'stex.knowledge.event.v1', id: hash({ project, sequence, sources }), sequence, project, sources, occurredAt: new Date().toISOString() };
      const temporary = `${file}.${randomUUID()}.tmp`;
      try { await writeFile(temporary, `${JSON.stringify({ digest, event }, null, 2)}\n`, 'utf8'); await rename(temporary, file); }
      finally { await rm(temporary, { force: true }).catch(() => {}); }
      return event;
    } catch (error) {
      if (error.status) throw error;
      throw failure(503, 'UNAVAILABLE', 'The website knowledge observation is unavailable.');
    }
  });
  queues.set(store, task);
  try { return await task; } finally { if (queues.get(store) === task) queues.delete(store); }
}
