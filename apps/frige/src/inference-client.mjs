/** Frige publishing engine source that exchanges bounded turns with the inference service or deterministic simulator. */
const MAX_CONTEXT_TURNS = 10;

/** Creates an assistant reply with its displayed transport state. */
function assistantResult(commentary, availability = 'available', graphSuggestions = []) {
  return { commentary, availability, proposal: null, graphSuggestions };
}

// A conversation turn with Igor about a whole book, a section or a page
// (stex.texgraph.scope-turn.v3). Igor sees the scope's offered sources and may
// reply with typed parts and with changes for those nodes only; Frige
// re-validates every change against what it offered and stores the parts.
const empty = { changes: [], parts: [], droppedParts: [], meta: null };
/** Builds server-side inference request headers using configured credentials. */
const gatewayHeaders = () => ({ 'content-type': 'application/json', ...(process.env.STEX_INFERENCE_SHARED_SECRET ? { 'x-stex-inference-token': process.env.STEX_INFERENCE_SHARED_SECRET } : {}) });
/** Checks whether explicit deterministic inference is selected. */
const deterministic = () => (process.env.STEX_FRIGE_INFERENCE_MODE || process.env.TEXGRAPH_INFERENCE_MODE) === 'fake';

/** A message in this form asks the simulator for one labelled change. */
const SIMULATED_CHANGE = /^simulate change:\s*(\S[\s\S]*)$/i;
/** A message in this form asks the simulator for one labelled layout change (see `simulatedLayout`). */
const SIMULATED_LAYOUT = /^simulate layout:\s*(\S[\s\S]*)$/i;
/**
 * `Simulate edit: <exact text> => <replacement>` asks the simulator for one
 * anchored edit (F5-B), so a test can quote a phrase that occurs once, more
 * than once, or not at all. The message is split once, at its first `=>`:
 * no pattern backtracks over a long message.
 */
const SIMULATED_EDIT_PREFIX = /^simulate edit:/i;

/**
 * Reads a simulated edit request. The text before the first `=>` is the
 * anchor, without the whitespace around it; the text after it is the
 * replacement, without one separating space. Everything else is kept as
 * written.
 *
 * @param {string} message  The whole trimmed message.
 * @returns {{ find: string, replace: string } | null}  `null` without the prefix, an `=>` or an anchor.
 */
function simulatedEdit(message) {
  const prefix = SIMULATED_EDIT_PREFIX.exec(message);
  if (!prefix) return null;
  const rest = message.slice(prefix[0].length);
  const arrow = rest.indexOf('=>');
  if (arrow === -1) return null;
  const find = rest.slice(0, arrow).trim();
  const replace = rest.slice(arrow + 2).replace(/^ /, '');
  return find ? { find, replace } : null;
}

/**
 * Reads a simulated layout request. Forms, case-insensitive:
 * `<size>/<leading>` (for example `15pt/18pt`), `size inherit`,
 * `recto on|off|inherit`, `head <text>`, `head inherit`, and `clear`.
 * The engine validates every value; this only shapes the request.
 *
 * @param {string} request  The text after `Simulate layout:`.
 * @returns {{ clear?: boolean, set?: Record<string, unknown> } | null}  `null` for an unrecognised form.
 */
function simulatedLayout(request) {
  const text = request.trim();
  if (/^clear$/i.test(text)) return { clear: true };
  const size = /^(\S+)\s*\/\s*(\S+)$/.exec(text);
  if (size) return { set: { fontSize: size[1], leading: size[2] } };
  if (/^size inherit$/i.test(text)) return { set: { fontSize: null, leading: null } };
  const recto = /^recto (on|off|inherit)$/i.exec(text);
  if (recto) return { set: { opensRecto: { on: true, off: false, inherit: null }[recto[1].toLowerCase()] } };
  const head = /^head (.+)$/i.exec(text);
  if (head) return { set: { headText: /^inherit$/i.test(head[1].trim()) ? null : head[1].trim() } };
  return null;
}

/**
 * Shortens text to at most 240 characters, counted in code points so a
 * character outside the Basic Multilingual Plane is never cut in half.
 *
 * @param {string} text
 * @returns {string}
 */
const clip = (text) => [...text].slice(0, 240).join('');

/**
 * The simulator's plain acknowledgement of a message. It proposes nothing.
 *
 * @param {string} message
 * @returns {string}
 */
const simulatorReceipt = (message) => `Deterministic Igor simulator received: ${clip(String(message || '').trim())}`;

/**
 * The deterministic simulator's reply to a scope turn. It never calls a model.
 *
 * By default it proposes nothing. `Simulate layout: <request>` yields one
 * proposed layout change for the conversation's own section or piece (see
 * `simulatedLayout`). A message of the form
 * `Simulate change: <line>` yields one proposed change that appends `<line>`
 * as a new closing stanza to the first offered piece, so the path from
 * conversation to change contract can be exercised without a provider. The
 * proposal is labelled as simulated and, like any proposal, is inert until
 * the author accepts it. The table of contents is never the target: appending
 * prose to it would not be a meaningful editorial change.
 *
 * With a selected passage (D-021) and no `Simulate` command, a `revise`
 * proposes one labelled anchored edit inside the passage, and any other action
 * answers in prose and proposes nothing.
 *
 * @param {string} message
 * @param {Array<{ nodeId: string, title: string, kind?: string, source: string }>} [sources]  Sources offered this turn.
 * @param {{ nodeId: string, title: string, action: string, startLine: number, endLine: number, text: string } | null} [passage]  The selected passage, as the engine resolved it.
 * @returns {object}  A reply in the shape `requestScopeTurn` returns.
 */
function fakeScopeTurn(message, sources = [], passage = null) {
  const received = String(message || '').trim();
  /** Builds metadata for the current simulated scope reply. */
  const meta = (output) => ({ model: 'stex/hermes-fake', usage: { inputChars: received.length, outputChars: output.length, transport: 'fake' } });
  if (passage && !/^simulate (edit|change|layout):/i.test(received)) {
    const lines = passage.startLine === passage.endLine ? `line ${passage.startLine}` : `lines ${passage.startLine}–${passage.endLine}`;
    if (passage.action === 'revise') {
      // The marker goes before any line breaks that end the passage, so the passage's lines keep their breaks.
      const replace = passage.text.replace(/(\s*)$/, ' — simulated revision$1');
      const text = `Deterministic Igor simulator prepared one labelled edit inside the selected passage (${lines} of “${passage.title}”). Nothing changes until you accept it.`;
      return {
        commentary: text, availability: 'available', graphSuggestions: [],
        changes: [{ nodeId: passage.nodeId, edits: [{ find: passage.text, replace }], summary: 'Simulated revision of the selected passage (deterministic simulator, not a model).' }],
        parts: [{ type: 'text', text }], droppedParts: [], meta: meta(text),
      };
    }
    const text = `Deterministic Igor simulator received the selected passage (${lines} of “${passage.title}”) with the action “${passage.action}”. A model would answer here; the simulator proposes nothing.`;
    return { commentary: text, availability: 'available', changes: [], graphSuggestions: [], parts: [{ type: 'text', text }], droppedParts: [], meta: meta(text) };
  }
  // One line of verse: whitespace folded, leading Markdown markers dropped so the
  // line cannot become a heading (and retitle the piece) or a quotation.
  const requested = clip((SIMULATED_CHANGE.exec(received)?.[1] || '').replace(/\s+/g, ' ').replace(/^[#>\s]+/, '').trim());
  const layoutRequest = SIMULATED_LAYOUT.exec(received)?.[1];
  const editRequest = simulatedEdit(received);
  if (editRequest) {
    const target = sources.find((entry) => entry.kind !== 'programme');
    // Frige resolves the edit and decides whether it becomes a suggestion, so the simulator does not claim one.
    const text = target
      ? `Deterministic Igor simulator passed one anchored edit to “${target.title}” to Frige. If Frige can place it exactly, it appears below as a suggestion; nothing changes until you accept it.`
      : 'Deterministic Igor simulator: this conversation offered no piece to edit, so no edit was simulated. Select a section or a piece and ask again.';
    return {
      commentary: text, availability: 'available', graphSuggestions: [],
      changes: target ? [{ nodeId: target.nodeId, edits: [editRequest], summary: 'Simulated anchored edit (deterministic simulator, not a model).' }] : [],
      parts: [{ type: 'text', text }], droppedParts: [], meta: meta(text),
    };
  }
  if (layoutRequest) {
    const layout = simulatedLayout(clip(layoutRequest.replace(/\s+/g, ' ')));
    const text = layout
      // Frige decides whether the request becomes a suggestion, so the simulator does not claim one.
      ? 'Deterministic Igor simulator passed a simulated layout request to Frige for this conversation’s section or piece. If it would change anything, it appears below as a suggestion; nothing changes until you accept it.'
      : 'Deterministic Igor simulator did not recognise that layout request. Try “Simulate layout: 15pt/18pt”, “recto on”, “head <text>” or “clear”.';
    return {
      commentary: text, availability: 'available', changes: [], graphSuggestions: [],
      ...(layout ? { layout: { ...layout, summary: 'Simulated layout change (deterministic simulator, not a model).' } } : {}),
      parts: [{ type: 'text', text }], droppedParts: [], meta: meta(text),
    };
  }
  if (requested) {
    const target = sources.find((entry) => entry.kind !== 'programme');
    if (!target) {
      const text = 'Deterministic Igor simulator: this conversation offered no piece to change (a whole-book conversation offers only its table of contents), so no change was simulated. Select a section or a piece and ask again.';
      return { commentary: text, availability: 'available', changes: [], graphSuggestions: [], parts: [{ type: 'text', text }], droppedParts: [], meta: meta(text) };
    }
    const lineEnd = target.source.includes('\r\n') ? '\r\n' : '\n';
    // A new closing stanza: a blank line, then the line. An empty piece gets the line alone.
    const lead = target.source === '' ? '' : `${target.source.endsWith('\n') ? '' : lineEnd}${lineEnd}`;
    const source = `${target.source}${lead}${requested}${lineEnd}`;
    const text = `Deterministic Igor simulator prepared one simulated change to “${target.title}”: a closing line is added. Nothing changes until you accept it.`;
    return {
      commentary: text, availability: 'available', graphSuggestions: [],
      changes: [{ nodeId: target.nodeId, source, summary: 'Simulated addition of a closing line (deterministic simulator, not a model).' }],
      parts: [{ type: 'text', text }], droppedParts: [], meta: meta(text),
    };
  }
  const text = simulatorReceipt(received);
  return {
    commentary: `${text}. No canonical source was changed.`, availability: 'available', changes: [], graphSuggestions: [],
    parts: [{ type: 'text', text: `${text}. Review and source changes remain author-controlled.` }], droppedParts: [],
    meta: meta(text),
  };
}

/**
 * Reads the gateway's report of the context it forwarded to the director after
 * trimming (`meta.forwardedContext`), so the contract can record what the
 * director was given. Only the expected shape is kept.
 *
 * @param {unknown} value
 * @returns {{ outline: { count: number, truncated: boolean } | null, documentSettings: boolean, approvedContracts: string[] | null, selection: boolean } | null}
 */
function forwardedFrom(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const outline = value.outline && typeof value.outline === 'object' && Number.isInteger(value.outline.count) && value.outline.count >= 0
    ? { count: value.outline.count, truncated: value.outline.truncated === true } : null;
  const approvedContracts = Array.isArray(value.approvedContracts) ? value.approvedContracts.filter((id) => typeof id === 'string').slice(0, 20) : null;
  // `selection`: the gateway forwarded the selected passage (D-021). Absent means not confirmed.
  return { outline, documentSettings: value.documentSettings === true, approvedContracts, selection: value.selection === true };
}

/**
 * Reads the optional `layout` field of a scope-turn reply: one proposed layout
 * change for the conversation's own section or piece. Only its shape is
 * checked here; the engine validates every value before it becomes a contract.
 * The STEX gateway produces it from the director's proposal block in a
 * section or piece conversation (program Wave 4, D-017).
 *
 * @param {unknown} value
 * @returns {{ clear?: true, set?: Record<string, unknown>, summary?: string } | null}
 */
export function layoutFrom(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const summary = typeof value.summary === 'string' ? { summary: value.summary.slice(0, 500) } : {};
  if (value.clear === true) return { clear: true, ...summary };
  // An override has four settings; a reply with many keys is malformed, not a proposal.
  if (value.set && typeof value.set === 'object' && !Array.isArray(value.set) && Object.keys(value.set).length <= 8) return { set: value.set, ...summary };
  return null;
}

/**
 * What the gateway is sent about a selected passage (D-021): where it is,
 * which revision it was selected in, the action asked for, and its exact text.
 *
 * @param {{ nodeId: string, relativePath: string, baseHash: string, action: string, startLine: number, endLine: number, text: string }} passage  As the engine resolved it.
 * @returns {object}
 */
function passageForGateway({ nodeId, relativePath, baseHash, action, startLine, endLine, text }) {
  return { category: 'selected-passage', nodeId, relativePath, sourceHash: baseHash, action, startLine, endLine, text };
}

/**
 * One editorial turn with the director for a book, a section or a piece
 * (`stex.texgraph.scope-turn.v3`). `hierarchy`, when given, adds the scope's
 * outline, settings in force and approved contracts as three separately
 * labelled request fields (see `ProjectStore#hierarchy`).
 *
 * @param {object} input
 * @returns {Promise<object>}  The labelled reply; never throws for an unavailable gateway.
 */
export async function requestScopeTurn({ book, scope, sources, withheld = [], graph, hierarchy = null, approvedSourceExcerpts = [], turns, message, answer = null, passage = null }) {
  if (deterministic()) return fakeScopeTurn(message, sources, passage);
  const endpoint = process.env.STEX_INFERENCE_URL;
  if (!endpoint) return { ...assistantResult('Igor did not reply: STEX_INFERENCE_URL is not set. Your message was saved.', 'unconfigured'), ...empty };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 300_000);
  try {
    const response = await fetch(new URL('/v1/texgraph/scope-turn', endpoint), {
      method: 'POST', headers: gatewayHeaders(), redirect: 'error', signal: controller.signal,
      body: JSON.stringify({
        contract: 'stex.texgraph.scope-turn.v3',
        book: { id: book.id, title: book.title, settings: book.settings || {} },
        scope: { id: scope.id, kind: scope.kind, title: scope.title, nodeIds: scope.nodeIds || [] },
        scopeSources: sources.map(({ nodeId, relativePath, title, kind, hash, source }) => ({ nodeId, relativePath, title, kind, sourceHash: hash, source })),
        withheldNodes: withheld,
        graph,
        // Additive v3 fields: each carries its own category and none holds manuscript text.
        ...(hierarchy ? { outline: hierarchy.outline, documentSettings: hierarchy.settings, approvedContracts: hierarchy.contracts } : {}),
        approvedSourceExcerpts: approvedSourceExcerpts.map((entry) => ({ id: entry.id, name: entry.name, excerpt: String(entry.excerpt || '').slice(0, 6000) })).slice(0, 8),
        turns: turns.filter((turn) => turn.role === 'user' || turn.role === 'assistant').slice(-MAX_CONTEXT_TURNS).map(({ role, message: turnMessage, commentary }) => ({ role, message: turnMessage || commentary || '' })),
        message,
        ...(answer ? { answer } : {}),
        // Additive v3 field (D-020): this Frige resolves anchored edits, so the gateway may teach and send them.
        proposalForms: ['source', 'edits'],
        // Additive v3 field (D-021): the passage the author selected, checked by the engine against the
        // current source, labelled as its own category. Never merged into the message or the sources.
        ...(passage ? { selection: passageForGateway(passage) } : {}),
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
    // A change carries the piece's whole new text or anchored edits to it (F5-B); the engine resolves and validates both.
    const changes = Array.isArray(payload.changes)
      ? payload.changes.filter((entry) => entry && typeof entry.nodeId === 'string' && (typeof entry.source === 'string' || Array.isArray(entry.edits))).slice(0, 40)
        .map(({ nodeId, source, edits, summary }) => ({ nodeId, ...(typeof source === 'string' ? { source } : {}), ...(Array.isArray(edits) ? { edits } : {}), ...(typeof summary === 'string' ? { summary } : {}) }))
      : [];
    const parts = Array.isArray(payload.parts) ? payload.parts.slice(0, 12) : [];
    const droppedParts = Array.isArray(payload.droppedParts) ? payload.droppedParts.slice(0, 20) : [];
    // Models passed over in the director's stack are kept so the reply can say so.
    const skipped = Array.isArray(payload.meta?.skipped) ? payload.meta.skipped.slice(0, 6).map((entry) => String(entry?.model || '').slice(0, 120)).filter(Boolean) : [];
    const forwarded = forwardedFrom(payload.meta?.forwardedContext);
    const meta = payload.meta && typeof payload.meta === 'object' ? { model: String(payload.meta.model || '').slice(0, 120), usage: payload.meta.usage || null, ...(skipped.length ? { skipped } : {}), ...(forwarded ? { forwardedContext: forwarded } : {}) } : null;
    const layout = layoutFrom(payload.layout);
    return { commentary, availability: 'available', changes, graphSuggestions, parts, droppedParts, meta, ...(layout ? { layout } : {}) };
  } catch (error) {
    const reason = error.name === 'AbortError' ? 'the gateway timed out' : 'the gateway is unreachable';
    return { ...assistantResult(`Igor did not reply: ${reason}. Your message was saved, but nothing was changed.`, 'unavailable'), ...empty };
  } finally {
    clearTimeout(timeout);
  }
}

// The gateway's own report on its provider: configured, model, and whether the key works.
/** Classifies inference availability using its health boundary. */
export async function inferenceHealth() {
  if (deterministic()) return { state: 'simulated', model: 'stex/hermes-fake', provider: 'fake' };
  const endpoint = process.env.STEX_INFERENCE_URL;
  if (!endpoint) return { state: 'unconfigured', detail: 'STEX_INFERENCE_URL is not set.' };
  try {
    const response = await fetch(new URL('/health?probe=1', endpoint), { headers: gatewayHeaders(), redirect: 'error', signal: AbortSignal.timeout(8_000) });
    const health = await response.json();
    if (health.transport === 'fake') return { state: 'simulated', model: 'stex/hermes-fake', provider: 'fake' };
    if (!health.configured) return { state: 'unconfigured', detail: `Set ${(health.missing || []).join(' and ')} for the inference gateway.`, model: health.model };
    const state = { reachable: 'ready', 'key-rejected': 'key-rejected', unreachable: 'provider-unreachable', unavailable: 'provider-unreachable' }[health.upstream] || 'unknown';
    return { state, model: health.model, provider: health.provider };
  } catch { return { state: 'gateway-unreachable', detail: 'The inference gateway is not running.' }; }
}

// Model roster settings live in the gateway; Frige relays them with the shared
// secret so the browser never holds it. Returns the gateway's status and body.
/** Reads current inference settings through the service boundary. */
export async function gatewaySettings(method, pathname, payload) {
  const endpoint = process.env.STEX_INFERENCE_URL;
  if (!endpoint) return { status: 503, body: { error: 'STEX_INFERENCE_URL is not set.', code: 'UNCONFIGURED' } };
  try {
    const response = await fetch(new URL(pathname, endpoint), { method, headers: gatewayHeaders(), redirect: 'error', signal: AbortSignal.timeout(15_000), ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) });
    return { status: response.status, body: await response.json().catch(() => ({ error: `The gateway returned ${response.status}.` })) };
  } catch { return { status: 503, body: { error: 'The inference gateway is not running.', code: 'GATEWAY_UNREACHABLE' } }; }
}

/** Requests a page proposal through the compatibility turn adapter. */
export async function requestPageRevision({ book, page, approvedSourceExcerpts = [], turns, message }) {
  // The one-page book has no simulated changes; it only acknowledges the message.
  if (deterministic()) return assistantResult(`${simulatorReceipt(message)}. No canonical source was changed.\n\nNo source proposal was generated by the deterministic simulator.`, 'available');
  const endpoint = process.env.STEX_INFERENCE_URL;
  if (!endpoint) {
    return assistantResult('The inference gateway is not configured. Your message was saved, but no revision was proposed.', 'unconfigured');
  }

  // Outlast the inference service's own budget for a director turn (120 s,
  // `DIRECTOR_TURN_TIMEOUT_MS`), so a slow reasoning model fails there, with
  // its classified reason, rather than here as a bare abort.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 150_000);
  try {
    const response = await fetch(new URL('/v1/texgraph/page-turn', endpoint), {
      method: 'POST',
      headers: gatewayHeaders(),
      redirect: 'error',
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
