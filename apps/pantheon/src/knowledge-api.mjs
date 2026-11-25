/**
 * Pantheon server source that hosts the journal API and checks engine access before responding.
 *
 * Pantheon presents the knowledge service; engines remain source authorities.
 * Knowledge is personal state (D-028): each request is served from the journal
 * of the person the hosted gate admitted (passed in `context.user` by the
 * server, never read from a header or body). Engine fetches carry the
 * stex.platform.actor.v1 headers (`context.actor`) so engines can attribute
 * them; they are set by the server only when hosted with the secret.
 */

/** Reports an invalid value using this boundary's failure shape. */
const fail = (status, message) => Object.assign(new Error(message), { status });
/** Validates and normalizes an engine-owned project reference. */
const projectRef = (value) => {
  const match = /^stex:\/\/(frige|seaxneat)\/project\/([a-z0-9][a-z0-9-]{0,62})$/.exec(value || '');
  if (!match) throw fail(400, 'Choose a known project reference.');
  return { application: match[1], id: match[2], reference: value };
};
/**
 * Constructs the bounded host API around the optional journal.
 *
 * @param {object} options
 * @param {{ lease: (user: string | null) => Promise<{ knowledge: object, release: () => void }>, legacyState?: () => Promise<string> }} [options.library]  Per-person journals (services/knowledge/src/library.mjs).
 * @param {object} [options.knowledge]  A single fixed journal (tests and simple hosts); ignored when `library` is given.
 * @param {Record<string, URL>} options.targets  Loopback engine origins by application id.
 * @param {typeof fetch} [options.fetchImpl]  Test seam.
 * @returns {(request: object, response: object, url: URL, context?: { user?: { username?: string } | null, actor?: Record<string, string> | null }) => Promise<void>}
 */
export function knowledgeApi({ library, knowledge: fixed, targets, fetchImpl = fetch }) {
  /** Fetches owner-verified data from the selected studio, with the actor headers when the host supplied them. */
  async function engine(project, suffix = '', payload, signal, actor = null) {
    const target = targets[project.application];
    // A studio the host defers has no target: its references are unavailable, never fetched.
    if (!target) throw fail(503, 'The source engine is unavailable.');
    const url = new URL(`/${project.application}/api/stex/context/v1/projects/${project.id}${suffix}`, target);
    let response;
    try { response = await fetchImpl(url, { method: payload ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.any([AbortSignal.timeout(5000), ...(signal ? [signal] : [])]), headers: { 'content-type': 'application/json', ...(actor || {}) }, ...(payload ? { body: JSON.stringify(payload) } : {}) }); }
    catch { throw fail(503, 'The source engine is unavailable.'); }
    let text = ''; let size = 0; const decoder = new TextDecoder('utf-8', { fatal: true });
    for await (const part of response.body) { size += part.length; if (size > 65536) throw fail(502, 'The source response is too large.'); text += decoder.decode(part, { stream: true }); }
    text += decoder.decode();
    let result; try { result = JSON.parse(text); } catch { throw fail(502, 'The engine returned an unreadable response.'); }
    if (!response.ok) throw fail(response.status === 409 ? 409 : 503, 'The source is unavailable or changed. Refresh before accepting.');
    if (result.project?.reference !== project.reference || result.project?.application !== project.application || result.project?.id !== project.id) throw fail(502, 'The engine returned a different project.');
    return result;
  }
  /** Loads the project's source catalog from its owner. */
  async function catalog(reference, offset = '0', actor = null) {
    if (!/^\d{1,5}$/.test(offset)) throw fail(400, 'Invalid source page.');
    const project = projectRef(reference); const result = await engine(project, `?offset=${offset}`, undefined, undefined, actor);
    if (result.schemaVersion !== 'stex.project.context.v1' || !Array.isArray(result.sources) || result.sources.length > 50) throw fail(502, 'The engine returned an invalid source catalog.');
    return result;
  }
  /** Revalidates source references within the request budget. */
  async function accessible(view, actor = null) {
    // At most forty source checks, four concurrently, within one six-second
    // deadline. Unchecked or failed references remain explicitly unavailable.
    const signal = AbortSignal.timeout(6000); const verified = new Set();
    let next = 0;
    /** Processes queued reference checks within the shared deadline. */
    async function worker() {
      while (!signal.aborted && next < Math.min(40, view.knowledge.sources.length)) {
        const source = view.knowledge.sources[next++];
        try {
          const value = await engine(projectRef(source.project), `/sources/${source.id}?revision=${source.revision}`, undefined, signal, actor);
          const entry = value.source;
          if (value.schemaVersion === 'stex.project.context.v1' && entry?.available && entry.reference === source.reference && entry.revision === source.revision && entry.originRevision === source.originRevision) verified.add(`${source.reference}:${source.revision}`);
        } catch { /* current owner access could not be established */ }
      }
    }
    await Promise.all(Array.from({ length: 4 }, worker));
    const sources = view.knowledge.sources.map((source) => ({ ...source, access: verified.has(`${source.reference}:${source.revision}`) ? 'current' : 'unavailable' }));
    const available = new Set(sources.filter((s) => s.access === 'current').map((s) => `${s.reference}:${s.revision}`));
    return { ...view, knowledge: { sources }, graph: { ...view.graph, relations: view.graph.relations.map((relation) => ({ ...relation, evidenceState: relation.evidence.every((entry) => available.has(`${entry.reference}:${entry.revision}`)) ? 'current' : 'unavailable' })) } };
  }
  /** Reads and validates a bounded JSON request body. */
  async function body(request) {
    const parts = []; let size = 0;
    for await (const part of request) { size += part.length; if (size > 16384) throw fail(413, 'Keep this request below 16,384 bytes.'); parts.push(part); }
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(parts))); } catch { throw fail(400, 'Send a valid UTF-8 JSON request.'); }
  }
  return async (request, response, url, { user = null, actor = null } = {}) => {
    /** Sends the route result with its selected status and response headers. */
    const send = (status, value) => { response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); response.end(JSON.stringify(value)); };
    let lease = null;
    try {
      const origin = request.headers.origin;
      if (request.headers['sec-fetch-site'] === 'cross-site' || (origin && origin !== `http://${request.headers.host}`)) throw fail(403, 'Foreign browser origin refused.');
      // The journal comes from the admitted user only. A fixed journal is used as-is; a library
      // refuses a missing user (401) and fails closed (503) for this person alone if theirs cannot open.
      if (library) lease = await library.lease(user?.username ?? null);
      const knowledge = lease ? lease.knowledge : fixed;
      if (!knowledge.view().enabled) return send(200, { enabled: false });
      const route = url.pathname.slice('/api/knowledge/v1'.length);
      if (request.method === 'GET') {
        if (route === '' || route === '/') {
          const view = await accessible(knowledge.view(), actor);
          // Presence only, never contents: a pre-existing root journal that no one has been assigned.
          return send(200, library?.legacyState && await library.legacyState() === 'unassigned' ? { ...view, legacyJournal: 'unassigned' } : view);
        }
        if (route === '/sources') return send(200, await catalog(url.searchParams.get('project'), url.searchParams.get('offset') || '0', actor));
        if (route === '/export') return send(200, knowledge.export());
        throw fail(404, 'Unknown knowledge route.');
      }
      if (request.method !== 'POST') throw fail(405, 'Method not allowed.');
      if (!/^application\/json\s*(;|$)/i.test(request.headers['content-type'] || '')) throw fail(415, 'Knowledge requests must be JSON.');
      const input = await body(request);
      if (route === '/accept') {
        const project = projectRef(input.project);
        if (!Array.isArray(input.sources) || input.sources.length > 4 || input.sources.length === 0) throw fail(400, 'Select one to four explicit sources.');
        // The owner checks each revision and creates a durable monotonic event.
        const event = await engine(project, '/observation', { sources: input.sources }, undefined, actor);
        if (event.schemaVersion !== 'stex.knowledge.event.v1' || !Array.isArray(event.sources) || event.sources.length !== input.sources.length || event.sources.some((source) => !input.sources.some((entry) => source.id === entry.id && source.revision === entry.revision))) throw fail(502, 'The engine returned a different observation.');
        await knowledge.accept({ idempotencyKey: input.idempotencyKey, expectedVersion: input.expectedVersion, event });
      } else if (route === '/revoke') await knowledge.revoke(input);
      else if (route === '/relation') {
        const current = await accessible(knowledge.view(), actor);
        if (!Array.isArray(input.relation?.evidence) || !input.relation.evidence.length || input.relation.evidence.some((entry) => !current.knowledge.sources.some((source) => source.access === 'current' && source.reference === entry.reference && source.revision === entry.revision))) throw fail(409, 'Relationship evidence must be a current, accepted source revision.');
        await knowledge.relation(input);
      } else if (route === '/revise') await knowledge.revise(input);
      else if (route === '/erase') await knowledge.erase(input);
      else throw fail(404, 'Unknown knowledge route.');
      return send(200, await accessible(knowledge.view(), actor));
    } catch (error) { return send(error.status || 400, { error: error.status ? error.message : 'Knowledge could not apply this request.', code: error.code || 'INVALID_REQUEST' }); }
    finally { lease?.release(); }
  };
}
