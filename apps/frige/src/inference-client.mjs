const MAX_CONTEXT_TURNS = 10;

function assistantResult(commentary, availability = 'available', graphSuggestions = []) {
  return { commentary, availability, proposal: null, graphSuggestions };
}

// A conversation turn with Igor about a whole book, a section or a page
// (stex.texgraph.scope-turn.v3). Igor sees the scope's offered sources and may
// reply with typed parts and with changes for those nodes only; Frige
// re-validates every change against what it offered and stores the parts.
const empty = { changes: [], parts: [], droppedParts: [], meta: null };
const gatewayHeaders = () => ({ 'content-type': 'application/json', ...(process.env.STEX_INFERENCE_SHARED_SECRET ? { 'x-stex-inference-token': process.env.STEX_INFERENCE_SHARED_SECRET } : {}) });
const deterministic = () => (process.env.STEX_FRIGE_INFERENCE_MODE || process.env.TEXGRAPH_INFERENCE_MODE) === 'fake';

function fakeScopeTurn(message) {
  const text = `Deterministic Igor simulator received: ${String(message || '').trim().slice(0, 240)}`;
  return {
    commentary: `${text}. No canonical source was changed.`, availability: 'available', changes: [], graphSuggestions: [],
    parts: [{ type: 'text', text: `${text}. Review and source changes remain author-controlled.` }], droppedParts: [],
    meta: { model: 'stex/hermes-fake', usage: { inputChars: String(message || '').length, outputChars: text.length, transport: 'fake' } },
  };
}

export async function requestScopeTurn({ book, scope, sources, withheld = [], graph, approvedSourceExcerpts = [], turns, message, answer = null }) {
  if (deterministic()) return fakeScopeTurn(message);
  const endpoint = process.env.STEX_INFERENCE_URL;
  if (!endpoint) return { ...assistantResult('Igor did not reply: STEX_INFERENCE_URL is not set. Your message was saved.', 'unconfigured'), ...empty };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 300_000);
  try {
    const response = await fetch(new URL('/v1/texgraph/scope-turn', endpoint), {
      method: 'POST', headers: gatewayHeaders(), signal: controller.signal,
      body: JSON.stringify({
        contract: 'stex.texgraph.scope-turn.v3',
        book: { id: book.id, title: book.title, settings: book.settings || {} },
        scope: { id: scope.id, kind: scope.kind, title: scope.title, nodeIds: scope.nodeIds || [] },
        scopeSources: sources.map(({ nodeId, relativePath, title, kind, hash, source }) => ({ nodeId, relativePath, title, kind, sourceHash: hash, source })),
        withheldNodes: withheld,
        graph,
        approvedSourceExcerpts: approvedSourceExcerpts.map((entry) => ({ id: entry.id, name: entry.name, excerpt: String(entry.excerpt || '').slice(0, 6000) })).slice(0, 8),
        turns: turns.filter((turn) => turn.role === 'user' || turn.role === 'assistant').slice(-MAX_CONTEXT_TURNS).map(({ role, message: turnMessage, commentary }) => ({ role, message: turnMessage || commentary || '' })),
        message,
        ...(answer ? { answer } : {}),
      }),
    });
    if (!response.ok) {
      // The gateway explains its failures with a code and a message safe to show.
      const failure = await response.json().catch(() => ({}));
      return { ...assistantResult(`Igor did not reply: ${String(failure.error || `the gateway returned ${response.status}`).replace(/\.$/, '')}. Your message was saved; nothing was changed.`, failure.code === 'UNCONFIGURED' ? 'unconfigured' : 'unavailable'), ...empty, failure: { status: response.status, code: failure.code || null } };
    }
    const payload = await response.json();
    const commentary = typeof payload.commentary === 'string' ? payload.commentary : '';
    const graphSuggestions = Array.isArray(payload.graphSuggestions) ? payload.graphSuggestions.filter((entry) => entry && typeof entry.message === 'string').slice(0, 12) : [];
    const changes = Array.isArray(payload.changes) ? payload.changes.filter((entry) => entry && typeof entry.nodeId === 'string' && typeof entry.source === 'string').slice(0, 40) : [];
    const parts = Array.isArray(payload.parts) ? payload.parts.slice(0, 12) : [];
    const droppedParts = Array.isArray(payload.droppedParts) ? payload.droppedParts.slice(0, 20) : [];
    // Models passed over in the director's stack are kept so the reply can say so.
    const skipped = Array.isArray(payload.meta?.skipped) ? payload.meta.skipped.slice(0, 6).map((entry) => String(entry?.model || '').slice(0, 120)).filter(Boolean) : [];
    const meta = payload.meta && typeof payload.meta === 'object' ? { model: String(payload.meta.model || '').slice(0, 120), usage: payload.meta.usage || null, ...(skipped.length ? { skipped } : {}) } : null;
    return { commentary, availability: 'available', changes, graphSuggestions, parts, droppedParts, meta };
  } catch (error) {
    const reason = error.name === 'AbortError' ? 'the gateway timed out' : 'the gateway is unreachable';
    return { ...assistantResult(`Igor did not reply: ${reason}. Your message was saved, but nothing was changed.`, 'unavailable'), ...empty };
  } finally {
    clearTimeout(timeout);
  }
}

// The gateway's own report on its provider: configured, model, and whether the key works.
export async function inferenceHealth() {
  if (deterministic()) return { state: 'simulated', model: 'stex/hermes-fake', provider: 'fake' };
  const endpoint = process.env.STEX_INFERENCE_URL;
  if (!endpoint) return { state: 'unconfigured', detail: 'STEX_INFERENCE_URL is not set.' };
  try {
    const response = await fetch(new URL('/health?probe=1', endpoint), { headers: gatewayHeaders(), signal: AbortSignal.timeout(8_000) });
    const health = await response.json();
    if (health.transport === 'fake') return { state: 'simulated', model: 'stex/hermes-fake', provider: 'fake' };
    if (!health.configured) return { state: 'unconfigured', detail: `Set ${(health.missing || []).join(' and ')} for the inference gateway.`, model: health.model };
    const state = { reachable: 'ready', 'key-rejected': 'key-rejected', unreachable: 'provider-unreachable', unavailable: 'provider-unreachable' }[health.upstream] || 'unknown';
    return { state, model: health.model, provider: health.provider };
  } catch { return { state: 'gateway-unreachable', detail: 'The inference gateway is not running.' }; }
}

// Model roster settings live in the gateway; Frige relays them with the shared
// secret so the browser never holds it. Returns the gateway's status and body.
export async function gatewaySettings(method, pathname, payload) {
  const endpoint = process.env.STEX_INFERENCE_URL;
  if (!endpoint) return { status: 503, body: { error: 'STEX_INFERENCE_URL is not set.', code: 'UNCONFIGURED' } };
  try {
    const response = await fetch(new URL(pathname, endpoint), { method, headers: gatewayHeaders(), signal: AbortSignal.timeout(15_000), ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) });
    return { status: response.status, body: await response.json().catch(() => ({ error: `The gateway returned ${response.status}.` })) };
  } catch { return { status: 503, body: { error: 'The inference gateway is not running.', code: 'GATEWAY_UNREACHABLE' } }; }
}

export async function requestPageRevision({ book, page, approvedSourceExcerpts = [], turns, message }) {
  if (deterministic()) return assistantResult(`${fakeScopeTurn(message).commentary}\n\nNo source proposal was generated by the deterministic simulator.`, 'available');
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
