import { timingSafeEqual } from 'node:crypto';

export const HERMES_TURN_CONTRACT = 'stex.hermes.turn.v1';

export class HermesError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

const id = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const product = /^[a-z][a-z0-9-]{0,39}$/;
const roles = new Set(['user', 'assistant', 'system']);
const operations = new Set(['conversation', 'proposal', 'edit', 'cancel']);
const text = (value, maximum) => typeof value === 'string' ? value.trim().slice(0, maximum) : '';
const jsonSize = (value) => Buffer.byteLength(JSON.stringify(value ?? null), 'utf8');

function match(actual, expected) {
  if (!actual || !expected) return false;
  const left = Buffer.from(actual); const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function limitedInteger(value, fallback, maximum, field) {
  if (value === undefined || value === null) return fallback;
  if (!Number.isInteger(value) || value < 1 || value > maximum) throw new HermesError(400, 'INVALID_REQUEST', `${field} must be an integer between 1 and ${maximum}.`);
  return value;
}

/** Validate the public, product-neutral request before a transport sees it. */
export function validateHermesTurn(body, limits = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HermesError(400, 'INVALID_REQUEST', 'A Hermes turn must be a JSON object.');
  if (body.contract !== HERMES_TURN_CONTRACT) throw new HermesError(400, 'UNKNOWN_CONTRACT', `contract must be ${HERMES_TURN_CONTRACT}.`);
  if (!id.test(String(body.requestId || ''))) throw new HermesError(400, 'INVALID_REQUEST', 'requestId must be a stable identifier.');
  if (!product.test(String(body.product || ''))) throw new HermesError(400, 'INVALID_REQUEST', 'product must be a lower-case STEX product identifier.');
  const messages = Array.isArray(body.conversation?.messages) ? body.conversation.messages : null;
  if (!messages || !messages.length || messages.length > 20) throw new HermesError(400, 'INVALID_REQUEST', 'conversation.messages must contain 1 to 20 messages.');
  const cleanMessages = messages.map((message) => {
    const content = text(message?.content, 6_000);
    if (!roles.has(message?.role) || !content) throw new HermesError(400, 'INVALID_REQUEST', 'Each message needs a known role and non-empty content.');
    return { role: message.role, content };
  });
  const kind = String(body.operation?.kind || 'conversation');
  if (!operations.has(kind)) throw new HermesError(400, 'INVALID_REQUEST', 'operation.kind is not supported.');
  const maxContextChars = Number(limits.maxContextChars || limits.hermesMaxContextChars || 96_000);
  const maxOutputChars = Number(limits.maxOutputChars || limits.hermesMaxOutputChars || 20_000);
  const maxTimeoutMs = Number(limits.maxTimeoutMs || limits.hermesMaxTimeoutMs || 60_000);
  const budget = body.budget && typeof body.budget === 'object' ? body.budget : {};
  const normalizedBudget = {
    maxContextChars: limitedInteger(budget.maxContextChars, maxContextChars, maxContextChars, 'budget.maxContextChars'),
    maxOutputChars: limitedInteger(budget.maxOutputChars, maxOutputChars, maxOutputChars, 'budget.maxOutputChars'),
    timeoutMs: limitedInteger(budget.timeoutMs, Math.min(30_000, maxTimeoutMs), maxTimeoutMs, 'budget.timeoutMs'),
  };
  const context = body.context && typeof body.context === 'object' && !Array.isArray(body.context) ? body.context : {};
  const operation = body.operation?.payload === undefined ? { kind } : { kind, payload: body.operation.payload };
  const candidate = { conversation: { id: text(body.conversation?.id, 80) || null, messages: cleanMessages }, operation, context };
  if (jsonSize(candidate) > normalizedBudget.maxContextChars) throw new HermesError(413, 'CONTEXT_TOO_LARGE', 'The requested Hermes context exceeds its explicit budget.');
  return { contract: HERMES_TURN_CONTRACT, requestId: body.requestId, product: body.product, ...candidate, budget: normalizedBudget };
}

function validateResponse(value, request) {
  if (!value || typeof value !== 'object' || value.contract !== HERMES_TURN_CONTRACT || value.requestId !== request.requestId) throw new HermesError(502, 'HERMES_MALFORMED', 'Hermes returned an invalid response envelope.');
  if (!['completed', 'cancelled'].includes(value.status) || !Array.isArray(value.events) || value.events.length > 40) throw new HermesError(502, 'HERMES_MALFORMED', 'Hermes returned invalid event data.');
  let sequence = 0; let outputChars = 0;
  const events = value.events.map((event) => {
    if (!event || !Number.isInteger(event.sequence) || event.sequence !== ++sequence || !['message', 'proposal', 'status'].includes(event.type)) throw new HermesError(502, 'HERMES_MALFORMED', 'Hermes events must be ordered and typed.');
    const payload = event.payload && typeof event.payload === 'object' ? event.payload : {};
    outputChars += jsonSize(payload);
    return { sequence: event.sequence, type: event.type, payload };
  });
  if (outputChars > request.budget.maxOutputChars) throw new HermesError(502, 'HERMES_OUTPUT_TOO_LARGE', 'Hermes exceeded the requested output budget.');
  const usage = value.usage && typeof value.usage === 'object' ? value.usage : {};
  return { contract: HERMES_TURN_CONTRACT, requestId: request.requestId, status: value.status, events, usage: { inputChars: Number(usage.inputChars) || 0, outputChars: Number(usage.outputChars) || outputChars, transport: text(usage.transport, 24) || 'remote' } };
}

function deterministicReply(request) {
  if (request.operation.kind === 'cancel') return { contract: HERMES_TURN_CONTRACT, requestId: request.requestId, status: 'cancelled', events: [{ sequence: 1, type: 'status', payload: { code: 'CANCELLED', detail: 'The deterministic transport accepted cancellation.' } }], usage: { inputChars: jsonSize(request), outputChars: 0, transport: 'fake' } };
  const latest = request.conversation.messages.at(-1).content;
  const proposal = request.operation.kind === 'proposal' || request.operation.kind === 'edit'
    ? { sequence: 2, type: 'proposal', payload: { kind: request.operation.kind, summary: `Deterministic proposal for ${request.product}.` } }
    : null;
  const events = [{ sequence: 1, type: 'message', payload: { text: `Deterministic Hermes simulator received: ${latest.slice(0, 240)}` } }, ...(proposal ? [proposal] : [])];
  return { contract: HERMES_TURN_CONTRACT, requestId: request.requestId, status: 'completed', events, usage: { inputChars: jsonSize(request), outputChars: jsonSize(events), transport: 'fake' } };
}

function joinedSignal(parent, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);
  const onAbort = () => controller.abort(parent?.reason || new Error('cancelled'));
  if (parent) { if (parent.aborted) onAbort(); else parent.addEventListener('abort', onAbort, { once: true }); }
  return { signal: controller.signal, timeout, dispose: () => { clearTimeout(timeout); parent?.removeEventListener('abort', onAbort); } };
}

/** A server-side-only generic Hermes client. Its default is intentionally deterministic. */
export function createHermesClient({ config = {}, fetchImpl = fetch } = {}) {
  const transport = config.hermesTransport === 'remote' ? 'remote' : 'fake';
  const limits = { maxContextChars: config.hermesMaxContextChars || 96_000, maxOutputChars: config.hermesMaxOutputChars || 20_000, maxTimeoutMs: config.hermesMaxTimeoutMs || 60_000 };
  const authorize = (token) => { if (!match(token, config.sharedSecret)) throw new HermesError(401, 'UNAUTHORIZED', 'Unauthorized inference caller.'); };
  const health = () => ({ ok: true, contract: HERMES_TURN_CONTRACT, transport, configured: transport === 'fake' || Boolean(config.hermesUrl && config.hermesToken), ...(transport === 'remote' && !(config.hermesUrl && config.hermesToken) ? { missing: [!config.hermesUrl && 'STEX_HERMES_URL', !config.hermesToken && 'STEX_HERMES_TOKEN'].filter(Boolean) } : {}) });
  async function turn({ token, body, signal }) {
    authorize(token);
    const request = validateHermesTurn(body, limits);
    if (transport === 'fake') return validateResponse(deterministicReply(request), request);
    if (!config.hermesUrl || !config.hermesToken) throw new HermesError(503, 'UNCONFIGURED', 'Remote Hermes is not configured.');
    const combined = joinedSignal(signal, request.budget.timeoutMs);
    try {
      const endpoint = new URL('v1/turn', config.hermesUrl.endsWith('/') ? config.hermesUrl : `${config.hermesUrl}/`);
      let response;
      try { response = await fetchImpl(endpoint, { method: 'POST', headers: { authorization: `Bearer ${config.hermesToken}`, 'content-type': 'application/json' }, body: JSON.stringify(request), signal: combined.signal }); }
      catch (error) {
        if (combined.signal.aborted) throw new HermesError(signal?.aborted ? 499 : 504, signal?.aborted ? 'CANCELLED' : 'HERMES_TIMEOUT', signal?.aborted ? 'Hermes turn was cancelled.' : 'Hermes did not answer before its budget expired.');
        throw new HermesError(502, 'HERMES_UNREACHABLE', 'Remote Hermes could not be reached.');
      }
      if (response.status === 401 || response.status === 403) throw new HermesError(502, 'HERMES_AUTH', 'Remote Hermes rejected gateway authentication.');
      if (response.status === 408 || response.status === 504) throw new HermesError(504, 'HERMES_TIMEOUT', 'Remote Hermes did not answer before its budget expired.');
      if (!response.ok) throw new HermesError(502, 'HERMES_UNAVAILABLE', `Remote Hermes returned ${response.status}.`);
      return validateResponse(await response.json().catch(() => null), request);
    } finally { combined.dispose(); }
  }
  return { health, turn, validate: (body) => validateHermesTurn(body, limits) };
}
