// stex.seaxneat.workspace.v1; the engine owns validation, state and operations.
export const workspaceVersion = 'stex.seaxneat.workspace.v1';
const prefix = '/api/stex/workspace/v1';

export function workspaceApi(store, { body, send }) {
  const busy = new Set();
  return async (request, response, url) => {
    const versioned = url.pathname === prefix || url.pathname.startsWith(`${prefix}/`);
    const pathname = versioned ? url.pathname.slice(prefix.length) : url.pathname.replace(/^\/api/, '');
    const publicValue = (value) => {
      if (Array.isArray(value)) return value.map(publicValue);
      if (value?.ref && value.preview) return { ...value, preview: { state: value.preview.state, updatedAt: value.preview.updatedAt, path: `/seaxneat/api/projects/${value.id}/preview/` } };
      return value;
    };
    const reply = (status, value) => send(response, status, versioned ? { schemaVersion: workspaceVersion, ...(status >= 400 ? value : { result: publicValue(value) }) } : value);
    const match = /^\/projects\/([a-z0-9][a-z0-9-]{0,62})(?:\/(proposal|apply|dismiss|diff|restore|preview))?$/.exec(pathname);
    if (pathname !== '/projects' && !match) { reply(404, { code: 'NOT_FOUND', error: 'Unknown workspace route.' }); return; }
    const [, id, action] = match || [];
    const allowed = pathname === '/projects' ? ['GET', 'POST'] : !action || action === 'diff' ? ['GET'] : action === 'proposal' ? ['GET', 'POST'] : ['POST'];
    if (!allowed.includes(request.method)) { response.setHeader('allow', allowed.join(', ')); reply(405, { code: 'METHOD_NOT_ALLOWED', error: 'Method not allowed.' }); return; }
    const mutating = request.method === 'POST';
    const lock = id || 'create';
    if (mutating && busy.has(lock)) { reply(409, { code: 'BUSY', error: 'An operation is already running. Inspect its state before retrying.' }); return; }
    if (mutating) busy.add(lock);
    try {
      const payload = mutating ? await body(request) : {};
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Request body must be an object.');
      if (mutating) {
        const field = !id ? 'title' : action === 'proposal' ? 'message' : ['apply', 'dismiss'].includes(action) ? 'proposalId' : action === 'restore' ? 'revision' : null;
        const maximum = field === 'title' ? 120 : field === 'message' ? 800 : 80;
        if (field && (typeof payload[field] !== 'string' || !payload[field].trim() || payload[field].length > maximum)) throw new Error(`A valid ${field} is required (at most ${maximum} characters).`);
      }
      if (pathname === '/projects') return reply(mutating ? 201 : 200, mutating ? await store.create(payload) : store.list());
      const project = store.get(id);
      if (!action) return reply(200, store.summary(project));
      if (action === 'proposal') return reply(mutating ? 201 : 200, mutating ? await store.proposal(id, payload) : project.pendingProposal);
      if (action === 'apply') return reply(200, await store.apply(id, payload.proposalId));
      if (action === 'dismiss') return reply(200, await store.dismiss(id, payload.proposalId));
      if (action === 'diff') return reply(200, { diff: await store.diff(id, url.searchParams.get('revision')) });
      if (action === 'restore') return reply(200, await store.restore(id, payload.revision));
      const build = await store.build(project);
      if (!build.ok) throw Object.assign(new Error('The workspace did not build; preview was not started.'), { code: 'BUILD_FAILED' });
      const preview = await store.startPreview(id);
      // The platform needs the mounted path, never the engine's private origin.
      return reply(200, versioned ? { state: preview.state, path: `/seaxneat/api/projects/${id}/preview/` } : preview);
    } catch (error) {
      const code = error.code === 'BUILD_FAILED' ? 'BUILD_FAILED' : /draft changed/.test(error.message) ? 'STALE_PROPOSAL' : /not found/i.test(error.message) ? 'NOT_FOUND' : 'INVALID_REQUEST';
      reply(code === 'BUILD_FAILED' ? 422 : code === 'STALE_PROPOSAL' ? 409 : code === 'NOT_FOUND' ? 404 : 400, { code, error: error.message || 'Request failed.' });
    } finally { if (mutating) busy.delete(lock); }
  };
}
