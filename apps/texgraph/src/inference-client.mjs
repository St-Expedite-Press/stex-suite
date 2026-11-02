const MAX_CONTEXT_TURNS = 10;

function assistantResult(commentary, availability = 'available', graphSuggestions = []) {
  return { commentary, availability, proposal: null, graphSuggestions };
}

// A conversation turn about a whole book, a section or a page (stex.texgraph.scope-turn.v2).
// The director sees the scope's offered sources and may propose replacements for those
// nodes only; TexGraph re-validates every change against what it offered.
export async function requestScopeTurn({ book, scope, sources, withheld = [], graph, approvedSourceExcerpts = [], turns, message }) {
  const endpoint = process.env.STEX_INFERENCE_URL;
  if (!endpoint) return { ...assistantResult('The inference gateway is not configured. Your message was saved, but Hermes did not reply.', 'unconfigured'), changes: [] };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);
  try {
    const response = await fetch(new URL('/v1/texgraph/scope-turn', endpoint), {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(process.env.STEX_INFERENCE_SHARED_SECRET ? { 'x-stex-inference-token': process.env.STEX_INFERENCE_SHARED_SECRET } : {}) },
      body: JSON.stringify({
        contract: 'stex.texgraph.scope-turn.v2',
        book: { id: book.id, title: book.title, settings: book.settings || {} },
        scope: { id: scope.id, kind: scope.kind, title: scope.title, nodeIds: scope.nodeIds || [] },
        scopeSources: sources.map(({ nodeId, relativePath, title, kind, hash, source }) => ({ nodeId, relativePath, title, kind, sourceHash: hash, source })),
        withheldNodes: withheld,
        graph,
        approvedSourceExcerpts: approvedSourceExcerpts.map((entry) => ({ id: entry.id, name: entry.name, excerpt: String(entry.excerpt || '').slice(0, 6000) })).slice(0, 8),
        turns: turns.filter((turn) => turn.role === 'user' || turn.role === 'assistant').slice(-MAX_CONTEXT_TURNS).map(({ role, message: turnMessage, commentary }) => ({ role, message: turnMessage || commentary || '' })),
        message,
      }),
      signal: controller.signal,
    });
    if (!response.ok) return { ...assistantResult(`The inference gateway returned ${response.status}. Your message was saved; nothing was changed.`, 'unavailable'), changes: [] };
    const payload = await response.json();
    const commentary = typeof payload.commentary === 'string' ? payload.commentary : 'The gateway returned no commentary.';
    const graphSuggestions = Array.isArray(payload.graphSuggestions) ? payload.graphSuggestions.filter((entry) => entry && typeof entry.message === 'string').slice(0, 12) : [];
    const changes = Array.isArray(payload.changes) ? payload.changes.filter((entry) => entry && typeof entry.nodeId === 'string' && typeof entry.source === 'string').slice(0, 40) : [];
    return { commentary, availability: 'available', changes, graphSuggestions };
  } catch (error) {
    const reason = error.name === 'AbortError' ? 'timed out' : 'is unreachable';
    return { ...assistantResult(`The inference gateway ${reason}. Your message was saved, but Hermes did not reply.`, 'unavailable'), changes: [] };
  } finally {
    clearTimeout(timeout);
  }
}

export async function requestPageRevision({ book, page, approvedSourceExcerpts = [], turns, message }) {
  const endpoint = process.env.STEX_INFERENCE_URL;
  if (!endpoint) {
    return assistantResult('The inference gateway is not configured. Your message was saved, but no revision was proposed.', 'unconfigured');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90_000);
  try {
    const response = await fetch(new URL('/v1/texgraph/page-turn', endpoint), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(process.env.STEX_INFERENCE_SHARED_SECRET ? { 'x-stex-inference-token': process.env.STEX_INFERENCE_SHARED_SECRET } : {}),
      },
      body: JSON.stringify({
        contract: 'stex.texgraph.page-turn.v1',
        book: { title: book.title, author: book.author, design: book.design, settings: book.settings || {}, context: book.context || {} },
        page: { id: page.id, title: page.title, source: page.source, sourceHash: page.hash },
        graph: book.graph || null,
        approvedSourceExcerpts: approvedSourceExcerpts.map((entry) => ({ id: entry.id, name: entry.name, excerpt: String(entry.excerpt || '').slice(0, 6000) })).slice(0, 8),
        turns: turns.slice(-MAX_CONTEXT_TURNS).map(({ role, message: turnMessage, commentary }) => ({ role, message: turnMessage || commentary || '' })),
        message,
      }),
      signal: controller.signal,
    });
    if (!response.ok) return assistantResult(`The inference gateway returned ${response.status}. Your message was saved; no source was changed.`, 'unavailable');
    const payload = await response.json();
    const commentary = typeof payload.commentary === 'string' ? payload.commentary : 'The gateway returned no commentary.';
    const graphSuggestions = Array.isArray(payload.graphSuggestions)
      ? payload.graphSuggestions.filter((entry) => entry && typeof entry.message === 'string').slice(0, 12)
      : [];
    if (payload.noChange === true) return assistantResult(commentary, 'available', graphSuggestions);
    if (typeof payload.proposal?.source === 'string') {
      return { commentary, availability: 'available', proposal: { source: payload.proposal.source, commentary }, graphSuggestions };
    }
    return assistantResult(`${commentary}\n\nNo valid source proposal was returned.`, 'invalid-response');
  } catch (error) {
    const reason = error.name === 'AbortError' ? 'timed out' : 'is unreachable';
    return assistantResult(`The inference gateway ${reason}. Your message was saved, but no revision was proposed.`, 'unavailable');
  } finally {
    clearTimeout(timeout);
  }
}
