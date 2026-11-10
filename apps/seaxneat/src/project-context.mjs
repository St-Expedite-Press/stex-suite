import { createHash } from 'node:crypto';

const files = { page: 'app/page.tsx', layout: 'app/layout.tsx', styles: 'app/globals.css' };
const failure = (status, code, message) => Object.assign(new Error(message), { status, code });
export async function projectContext(store, id, { sourceId, revision } = {}) {
  try {
    let record; try { record = store.get(id); } catch { throw failure(404, 'NOT_FOUND', 'The selected website project does not exist.'); }
    if (!record.lastValidatedRevision) throw failure(409, 'NO_VALIDATED_REVISION', 'This website has no validated revision to offer.');
    const commit = record.lastValidatedRevision;
    if (!/^[a-f0-9]{40,64}$/.test(commit)) throw failure(503, 'UNAVAILABLE', 'The validated revision is unavailable.');
    const project = { application: 'seaxneat', id, title: record.title, reference: store.reference(record), revision: commit };
    async function describe(sourceId, content = false) {
      const file = files[sourceId]; if (!file) throw failure(404, 'NOT_FOUND', 'Unknown website source.');
      // Read the validated Git object, not an unvalidated working-tree file.
      const bytes = Number((await store.git(['cat-file', '-s', `${commit}:${file}`], store.workspace(id))).stdout.trim());
      if (!Number.isSafeInteger(bytes) || bytes < 0) throw failure(503, 'UNAVAILABLE', 'Source size is unavailable.');
      let source = null; let hash = null;
      if (bytes <= 12000) { source = (await store.git(['show', `${commit}:${file}`], store.workspace(id))).stdout; hash = createHash('sha256').update(source).digest('hex'); }
      const entry = { id: sourceId, title: file, reference: `${project.reference}#source=${sourceId}`, revision: hash, originRevision: commit, mediaType: file.endsWith('.css') ? 'text/css' : 'text/plain', bytes, available: bytes <= 12000 };
      if (content) {
        if (!entry.available) throw failure(413, 'CONTEXT_LIMIT', 'This source exceeds the 12,000-byte context limit.');
        if (revision !== hash) throw failure(409, 'STALE_SOURCE', 'The validated source changed. Refresh and preview it again.');
        return { ...entry, source };
      }
      return entry;
    }
    return sourceId
      ? { schemaVersion: 'stex.project.context.v1', project, source: await describe(sourceId, true) }
      : { schemaVersion: 'stex.project.context.v1', project, sources: await Promise.all(Object.keys(files).map((id) => describe(id))), nextOffset: null };
  } catch (error) {
    if (error.status) throw error;
    throw failure(503, 'UNAVAILABLE', 'The validated website sources are unavailable.');
  }
}
