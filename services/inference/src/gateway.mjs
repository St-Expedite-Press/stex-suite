import { timingSafeEqual } from 'node:crypto';
import { frigeDirectorKit, frigeProcedure } from './frige-director.mjs';
import { createModelSettings } from './model-settings.mjs';

// The inference gateway is the Hermes agent unit: it runs the director procedure
// against OpenRouter, validates what comes back, and is the only STEX process that
// holds a provider credential. Products receive validated replies, never the key.

export class GatewayError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

function constantTimeMatch(actual, expected) { if (!actual || !expected) return false; const left = Buffer.from(actual); const right = Buffer.from(expected); return left.length === right.length && timingSafeEqual(left, right); }
function boundedText(value, maximum) { return String(value || '').trim().slice(0, maximum); }
function tokenEstimate(value) { return Math.ceil(String(value || '').length / 4); }

export function validateTurn(body, maxInputTokens) {
  if (!body || typeof body !== 'object') throw new GatewayError(400, 'INVALID_REQUEST', 'JSON body is required.');
  const turns = Array.isArray(body.turns) ? body.turns.filter((turn) => turn && typeof turn === 'object').slice(-12).map((turn) => ({ role: turn.role === 'assistant' ? 'assistant' : 'user', content: boundedText(turn.message || turn.content || turn.commentary, 4_000) })).filter((turn) => turn.content) : [];
  const message = boundedText(body.message, 4_000); if (!message) throw new GatewayError(400, 'INVALID_REQUEST', 'A message is required.');
  const answer = body.answer && typeof body.answer === 'object' ? { promptId: boundedText(body.answer.promptId, 120), values: body.answer.values } : null;
  const counted = { turns, message, answer, context: body.context, scopeSources: body.scopeSources, page: body.page, graph: body.graph, approvedSourceExcerpts: body.approvedSourceExcerpts };
  if (tokenEstimate(JSON.stringify(counted)) > maxInputTokens) throw new GatewayError(413, 'CONTEXT_TOO_LARGE', 'The requested context exceeds the configured input limit.');
  return { turns, message, answer };
}

// Reply parts (scope turn v3). Each part is validated on its own; an invalid part is
// set aside with its reason, so one bad part cannot hide the rest of a reply.
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const ID = /^(?!(?:__proto__|constructor|prototype)$)[A-Za-z0-9_-]{1,40}$/;
const FIELD_KINDS = new Set(['text', 'textarea', 'select', 'number', 'checkbox']);
const short = (value, maximum) => (typeof value === 'string' && value.trim() && value.length <= maximum ? value.trim() : null);

function validatePart(part, ids) {
  if (!part || typeof part !== 'object') return { reason: 'A part must be an object.' };
  if (part.type === 'text') { const text = short(part.text, 20_000); return text ? { part: { type: 'text', text } } : { reason: 'A text part needs text under 20,000 characters.' }; }
  if (part.type === 'artifact') {
    const title = short(part.title, 200) || 'Untitled';
    if (part.kind === 'image') {
      const mediaType = String(part.mediaType || '').toLowerCase();
      if (!IMAGE_TYPES.has(mediaType)) return { reason: 'Images must be PNG, JPEG, WebP or GIF.' };
      if (typeof part.content !== 'string' || !/^[A-Za-z0-9+/=\s]+$/.test(part.content) || part.content.length > 11_200_000) return { reason: 'An image must be base64 under 8 MB.' };
      return { part: { type: 'artifact', kind: 'image', title, mediaType, content: part.content.replace(/\s+/g, '') } };
    }
    if (!['code', 'document', 'data'].includes(part.kind)) return { reason: 'Artifacts are code, document, data or image.' };
    if (typeof part.content !== 'string' || !part.content || part.content.length > 200_000) return { reason: 'Artifact content must be text under 200,000 characters.' };
    return { part: { type: 'artifact', kind: part.kind, title, language: short(part.language, 40), content: part.content } };
  }
  if (part.type === 'choice' || part.type === 'form') {
    if (!ID.test(String(part.id || '')) || ids.has(part.id)) return { reason: 'Interactive parts need a unique id of letters, digits, - or _.' };
    if (part.type === 'choice') {
      const prompt = short(part.prompt, 500);
      const options = Array.isArray(part.options) ? part.options : [];
      if (!prompt || options.length < 2 || options.length > 12) return { reason: 'A choice needs a prompt and 2 to 12 options.' };
      const seen = new Set(); const clean = [];
      for (const option of options) {
        const label = short(option?.label, 200); if (!label || !ID.test(String(option?.id || '')) || seen.has(option.id)) return { reason: 'Each choice option needs a unique id and a label.' };
        seen.add(option.id); clean.push({ id: option.id, label, description: short(option.description, 300) });
      }
      ids.add(part.id);
      return { part: { type: 'choice', id: part.id, prompt, options: clean, multiple: part.multiple === true, allowOther: part.allowOther === true } };
    }
    const fields = Array.isArray(part.fields) ? part.fields : [];
    if (!fields.length || fields.length > 12) return { reason: 'A form needs 1 to 12 fields.' };
    const seen = new Set(); const clean = [];
    for (const field of fields) {
      const label = short(field?.label, 200);
      if (!label || !ID.test(String(field?.id || '')) || seen.has(field.id) || !FIELD_KINDS.has(field?.kind)) return { reason: 'Each form field needs a unique id, a label and a known kind.' };
      const options = field.kind === 'select' ? (Array.isArray(field.options) ? field.options.map((option) => short(option, 200)).filter(Boolean).slice(0, 20) : []) : undefined;
      if (field.kind === 'select' && !options.length) return { reason: 'A select field needs options.' };
      seen.add(field.id); clean.push({ id: field.id, label, kind: field.kind, required: field.required === true, placeholder: short(field.placeholder, 200), ...(options ? { options } : {}) });
    }
    ids.add(part.id);
    return { part: { type: 'form', id: part.id, title: short(part.title, 200), fields: clean, submitLabel: short(part.submitLabel, 40) } };
  }
  return { reason: `Unknown part type ${JSON.stringify(String(part.type)).slice(0, 40)}.` };
}

export function validateParts(parts) {
  const kept = []; const dropped = []; const ids = new Set();
  for (const [index, part] of (Array.isArray(parts) ? parts : []).entries()) {
    if (kept.length >= 12) { dropped.push({ index, reason: 'A reply may carry at most 12 parts.' }); continue; }
    const result = validatePart(part, ids);
    if (result.part) kept.push(result.part); else dropped.push({ index, reason: result.reason });
  }
  return { parts: kept, dropped };
}

// Models are asked for one JSON object; fences and prose around it are tolerated, and
// a reply that is not JSON at all is kept as plain commentary.
function extractJson(content) {
  const text = String(content || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(text); } catch { /* fall through */ }
  const start = text.indexOf('{'); const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) { try { return JSON.parse(text.slice(start, end + 1)); } catch { /* not JSON */ } }
  return null;
}

// OpenRouter returns generated images beside the text as data URLs.
function imageParts(images) {
  return (Array.isArray(images) ? images : []).map((image, index) => {
    const match = /^data:(image\/[a-z]+);base64,(.+)$/i.exec(String(image?.image_url?.url || image?.url || ''));
    return match ? { type: 'artifact', kind: 'image', title: `Image ${index + 1}`, mediaType: match[1].toLowerCase(), content: match[2] } : null;
  }).filter(Boolean);
}

export function parseDirectorReply(content, kind, images = []) {
  const parsed = extractJson(content);
  if (!parsed || typeof parsed !== 'object') {
    const text = boundedText(content, 12_000);
    if (!text && !images.length) throw new GatewayError(502, 'PROVIDER_MALFORMED', 'The model returned an empty reply.');
    const base = { commentary: text, noChange: true, proposal: null, graphSuggestions: [], ticketUpdates: null };
    if (kind !== 'scope-turn') return base;
    const { parts, dropped } = validateParts([...(text ? [{ type: 'text', text }] : []), ...imageParts(images)]);
    return { ...base, changes: [], parts, droppedParts: dropped };
  }
  const source = parsed?.proposal?.source;
  if (source !== undefined && typeof source !== 'string') throw new GatewayError(502, 'PROVIDER_MALFORMED', 'The model proposal is malformed.');
  const commentary = boundedText(typeof parsed.commentary === 'string' ? parsed.commentary : (Array.isArray(parsed.parts) ? parsed.parts.find((part) => part?.type === 'text')?.text : ''), 12_000);
  const result = { commentary, noChange: parsed.noChange === true || !source, proposal: source ? { source: source.slice(0, 400_000) } : null, graphSuggestions: Array.isArray(parsed.graphSuggestions) ? parsed.graphSuggestions.slice(0, 20) : [], ticketUpdates: parsed.ticketUpdates && typeof parsed.ticketUpdates === 'object' ? parsed.ticketUpdates : null };
  if (kind !== 'scope-turn') return result;
  // Changes replace offered nodes; the product re-validates each against what it offered.
  if (parsed.changes !== undefined && (!Array.isArray(parsed.changes) || parsed.changes.some((change) => typeof change?.nodeId !== 'string' || typeof change?.source !== 'string' || change.source.length > 400_000))) throw new GatewayError(502, 'PROVIDER_MALFORMED', 'The model changes are malformed.');
  const changes = (parsed.changes || []).slice(0, 40).map((change) => ({ nodeId: change.nodeId.slice(0, 100), source: change.source, summary: boundedText(change.summary, 500) }));
  const { parts, dropped } = validateParts([...(Array.isArray(parsed.parts) ? parsed.parts : []), ...imageParts(images)]);
  return { ...result, noChange: parsed.noChange === true || (!source && !changes.length), changes, parts, droppedParts: dropped };
}

function directorMessages(kind, body, turn) {
  const envelope = {
    product: 'texgraph', contract: 'stex.texgraph.hermes-envelope.v2',
    selectedTarget: kind === 'scope-turn' ? { scope: body.scope || null, scopeSources: Array.isArray(body.scopeSources) ? body.scopeSources : [], withheldNodes: Array.isArray(body.withheldNodes) ? body.withheldNodes : [] } : body.page || body.target || null,
    graph: body.graph || body.book?.graph || null, settingsTicket: body.book?.settings || body.ticket || {},
    approvedSourceExcerpts: Array.isArray(body.approvedSourceExcerpts) ? body.approvedSourceExcerpts.slice(0, 8) : [],
  };
  const answer = turn.answer ? `\n\nThe author answered your prompt ${JSON.stringify(turn.answer.promptId)} with: ${JSON.stringify(turn.answer.values)}` : '';
  return [
    { role: 'system', content: `${frigeProcedure(kind)}\n\nDirector kit:\n${JSON.stringify(frigeDirectorKit(kind))}` },
    ...turn.turns,
    { role: 'user', content: `Envelope:\n${JSON.stringify(envelope)}\n\nAuthor request:\n${turn.message}${answer}` },
  ];
}

// Retry only failures that cannot have produced a billed completion: rate limiting and
// gateway-level unavailability. Timeouts and server errors may have been billed already.
const RETRYABLE = new Set([429, 502, 503]);

// Failures that a different model may not share: the model is gone or refuses the
// request, the provider for it is down, or it is rate limited. Key, credit and timeout
// failures end the turn instead.
const FALLBACK = new Set(['PROVIDER_REJECTED', 'PROVIDER_UNAVAILABLE', 'PROVIDER_RATE_LIMITED']);

export function createGateway({ config, models = createModelSettings({ file: null, envModel: config.model || '' }), fetchImpl = fetch, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }) {
  const missing = () => [!config.openRouterKey && 'OPENROUTER_API_KEY', !models.profile('director').stack.length && 'a director model (Configure models, or OPENROUTER_MODEL)'].filter(Boolean);
  const headers = () => ({ authorization: `Bearer ${config.openRouterKey}`, 'content-type': 'application/json', ...(config.siteUrl ? { 'http-referer': config.siteUrl } : {}), ...(config.appName ? { 'x-title': config.appName } : {}) });

  // Provider text can quote the request; never relay anything that looks like a key.
  const redact = (text) => boundedText(text, 300).split(config.openRouterKey || '\u0000').join('[redacted]').replace(/sk-or-[A-Za-z0-9-]{8,}/g, '[redacted]');

  // One completion on one model with bounded retries; provider failures become specific
  // gateway errors. The timeout covers the whole exchange, body included.
  async function completeWith(model, messages, profile) {
    const attempts = 1 + Math.max(0, config.maxRetries ?? 2);
    // A role's output cap never exceeds the gateway's.
    const maxTokens = Math.min(profile.maxOutputTokens || Infinity, config.maxOutputTokens || 4096);
    for (let attempt = 1; ; attempt += 1) {
      const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), config.timeoutMs || 90_000);
      let response; let payload;
      try {
        response = await fetchImpl(`${config.baseUrl}/chat/completions`, { method: 'POST', headers: headers(), signal: controller.signal,
          body: JSON.stringify({ model, messages, max_tokens: maxTokens, ...(profile.temperature !== null ? { temperature: profile.temperature } : {}), usage: { include: true } }) });
        payload = await response.json().catch((error) => { if (error.name === 'AbortError') throw error; return null; });
      } catch (error) {
        // A refused connection never reached the model; a timeout may have, so it is not retried.
        if (error.name !== 'AbortError' && !response && attempt < attempts) { await sleep(500 * 2 ** (attempt - 1)); continue; }
        throw error.name === 'AbortError' ? new GatewayError(504, 'PROVIDER_TIMEOUT', 'OpenRouter did not answer in time.') : new GatewayError(502, 'PROVIDER_UNREACHABLE', 'OpenRouter could not be reached.');
      } finally { clearTimeout(timer); }
      if (response.ok) {
        const message = payload?.choices?.[0]?.message;
        if (!message) throw new GatewayError(502, 'PROVIDER_MALFORMED', 'OpenRouter returned no message.');
        return { content: typeof message.content === 'string' ? message.content : '', images: message.images || [], model: payload.model || model, usage: payload.usage || null };
      }
      if (RETRYABLE.has(response.status) && attempt < attempts) { await sleep(500 * 2 ** (attempt - 1)); continue; }
      const detail = redact(payload?.error?.message);
      if (response.status === 401 || response.status === 403) throw new GatewayError(502, 'PROVIDER_AUTH', 'OpenRouter rejected the API key.');
      if (response.status === 402) throw new GatewayError(402, 'PROVIDER_CREDITS', 'OpenRouter credits are exhausted.');
      if (response.status === 429) throw new GatewayError(429, 'PROVIDER_RATE_LIMITED', 'OpenRouter is rate limiting requests; try again shortly.');
      if (response.status === 400 || response.status === 404) throw new GatewayError(502, 'PROVIDER_REJECTED', `OpenRouter refused the request${detail ? `: ${detail}` : '.'}`);
      throw new GatewayError(502, 'PROVIDER_UNAVAILABLE', `OpenRouter returned ${response.status}.`);
    }
  }

  // Walks a role's model stack in order; the reply records which models were passed over.
  async function complete(roleId, messages) {
    const profile = models.profile(roleId); const skipped = [];
    for (const [index, model] of profile.stack.entries()) {
      try { return { ...(await completeWith(model, messages, profile)), skipped }; }
      catch (error) {
        if (!FALLBACK.has(error.code) || index === profile.stack.length - 1) { if (skipped.length) error.message = `${error.message} (also tried ${skipped.map((entry) => entry.model).join(', ')})`; throw error; }
        skipped.push({ model, code: error.code });
      }
    }
    throw new GatewayError(503, 'UNCONFIGURED', `No model is configured for ${roleId}.`);
  }

  // A cheap reachability probe (OpenRouter's key endpoint costs nothing), cached briefly.
  // Concurrent health checks share one in-flight probe.
  let probe = null;
  function probeProvider() {
    if (probe && Date.now() - probe.at < 60_000) return probe.result;
    const result = fetchImpl(`${config.baseUrl}/key`, { headers: headers(), signal: AbortSignal.timeout(5_000) })
      .then((response) => (response.ok ? 'reachable' : response.status === 401 || response.status === 403 ? 'key-rejected' : `error-${response.status}`))
      .catch(() => 'unreachable');
    probe = { at: Date.now(), result };
    return result;
  }

  // OpenRouter's public model list (free to fetch), cached for ten minutes; null if unreachable.
  let catalogCache = null;
  async function catalog() {
    if (catalogCache && Date.now() - catalogCache.at < 600_000) return catalogCache.models;
    try {
      const response = await fetchImpl(`${config.baseUrl}/models`, { signal: AbortSignal.timeout(10_000) });
      if (!response.ok) return catalogCache?.models || null;
      const list = (await response.json())?.data;
      const models = (Array.isArray(list) ? list : []).filter((entry) => typeof entry?.id === 'string').map((entry) => ({
        id: entry.id, name: boundedText(entry.name, 120) || entry.id, contextLength: Number(entry.context_length) || null,
        pricing: { prompt: entry.pricing?.prompt ?? null, completion: entry.pricing?.completion ?? null },
        input: entry.architecture?.input_modalities || [], output: entry.architecture?.output_modalities || [],
      }));
      catalogCache = { at: Date.now(), models };
      return models;
    } catch { return catalogCache?.models || null; }
  }
  const authorize = (token) => { if (!constantTimeMatch(token, config.sharedSecret)) throw new GatewayError(401, 'UNAUTHORIZED', 'Unauthorized inference caller.'); };

  return {
    async health({ probe: check = false } = {}) {
      const absent = missing(); const director = models.profile('director');
      return { ok: true, provider: 'openrouter', model: director.stack[0] || null, stack: director.stack, configured: !absent.length, missing: absent, ...(check && !absent.length ? { provider_status: await probeProvider() } : {}) };
    },
    async models({ token }) { authorize(token); return models.get(); },
    async catalog({ token }) { authorize(token); const list = await catalog(); return { available: Boolean(list), models: list || [] }; },
    // Unknown model ids are refused while the catalog is reachable.
    async saveModels({ token, body }) {
      authorize(token);
      const list = await catalog();
      const { settings, errors } = await models.save(body, { knownModels: list ? new Set(list.map((entry) => entry.id)) : null });
      if (!settings) throw Object.assign(new GatewayError(400, 'INVALID_SETTINGS', errors.join(' ')), { errors });
      return { ...models.get(), catalogChecked: Boolean(list) };
    },
    async handle({ token, kind, body }) {
      authorize(token);
      if (!['interview', 'page-turn', 'scope-turn'].includes(kind)) throw new GatewayError(404, 'UNKNOWN_CONTRACT', 'Unknown inference contract.');
      const absent = missing();
      if (absent.length) throw new GatewayError(503, 'UNCONFIGURED', `OpenRouter is not configured: set ${absent.join(' and ')}.`);
      const turn = validateTurn(body, config.maxInputTokens);
      // Any provider failure also clears the cached probe, so health stops reporting 'reachable'.
      const reply = await complete('director', directorMessages(kind, body, turn)).catch((error) => { probe = null; throw error; });
      const result = parseDirectorReply(reply.content, kind, reply.images);
      return kind === 'scope-turn' ? { ...result, meta: { model: reply.model, usage: reply.usage, role: 'director', ...(reply.skipped.length ? { skipped: reply.skipped } : {}) } } : result;
    },
  };
}
