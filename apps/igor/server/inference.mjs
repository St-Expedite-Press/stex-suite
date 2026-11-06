// Igor's only path to the Pantheon Director: services/inference over
// stex.hermes.turn.v1 (protocol/hermes). The shared secret stays here; failures
// become short, user-readable errors and never carry upstream payloads.

export const TURN = Object.freeze({ historyMessages: 20, historyBytes: 20_000, maxContextChars: 24_000, maxOutputChars: 8_000, timeoutMs: 60_000 });
const HEALTH_TTL_MS = 10_000;
const jsonBytes = (value) => Buffer.byteLength(JSON.stringify(value), 'utf8');

export class TurnFailure extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

const failures = {
  UNCONFIGURED: 'Igor is not connected: STEX_INFERENCE_URL is not set for the Igor server.',
  HERMES_UNCONFIGURED: 'Igor is not connected: the inference service has no safely configured Hermes.',
  UNAVAILABLE: 'Igor is not reachable: the inference service is not running.',
  TIMEOUT: 'Igor did not answer in time.',
  UNAUTHORIZED: 'The inference service refused Igor: the shared inference secret does not match.',
  CANCELLED: 'Igor stopped before answering.',
  MALFORMED_RESPONSE: 'Igor sent a reply that could not be read.',
};
const fail = (code) => new TurnFailure(code, failures[code]);

/**
 * The bounded history for a turn: complete messages up to and including the
 * triggering user message, at most 20, trimmed oldest-first to 20,000 bytes of
 * JSON. The triggering message is always kept.
 */
export function turnHistory(conversation, userMessageId) {
  const index = conversation.messages.findIndex((message) => message.id === userMessageId);
  const messages = conversation.messages.slice(0, index + 1)
    .filter((message) => message.status === 'complete' && message.content)
    .map(({ role, content }) => ({ role, content }))
    .slice(-TURN.historyMessages);
  while (messages.length > 1 && jsonBytes(messages) > TURN.historyBytes) messages.shift();
  return messages;
}

export function turnRequest(conversation, assistant) {
  return {
    contract: 'stex.hermes.turn.v1', requestId: assistant.id, product: 'igor',
    conversation: { id: conversation.id, messages: turnHistory(conversation, assistant.replyTo) },
    operation: { kind: 'conversation' }, context: {},
    budget: { maxContextChars: TURN.maxContextChars, maxOutputChars: TURN.maxOutputChars, timeoutMs: TURN.timeoutMs },
  };
}

function endpoint(base, pathname) {
  try { return base ? new URL(pathname, base) : null; } catch { return null; }
}

// The shared secret travels to this URL, so it must stay on this machine.
function assertLoopbackUrl(value) {
  if (!value) return;
  let target;
  try { target = new URL(value); } catch { throw new Error('STEX_INFERENCE_URL is not a valid URL.'); }
  if (target.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname) || target.username || target.password) throw new Error('STEX_INFERENCE_URL must be a loopback HTTP origin.');
}

export function createInference({ url = '', sharedSecret = '', fetchImpl = fetch } = {}) {
  assertLoopbackUrl(url);

  /**
   * Runs one turn; resolves { text, transport } or rejects with a TurnFailure.
   * Aborting `cancel` (a deleted conversation) closes the request upstream.
   */
  async function turn(request, { cancel } = {}) {
    const target = endpoint(url, '/v1/hermes/turn');
    if (!target) throw fail('UNCONFIGURED');
    const signal = AbortSignal.any([AbortSignal.timeout(request.budget.timeoutMs + 5_000), ...(cancel ? [cancel] : [])]);
    const failure = (error, otherwise) => fail(cancel?.aborted ? 'CANCELLED' : error?.name === 'TimeoutError' ? 'TIMEOUT' : otherwise);
    let response; let reply;
    try {
      response = await fetchImpl(target, { method: 'POST', headers: { 'content-type': 'application/json', 'x-stex-inference-token': sharedSecret }, body: JSON.stringify(request), signal });
    } catch (error) { throw failure(error, 'UNAVAILABLE'); }
    try { reply = await response.json(); }
    catch (error) { throw failure(error, 'MALFORMED_RESPONSE'); }
    if (!response.ok) {
      if (response.status === 401 || reply?.code === 'UNAUTHORIZED') throw fail('UNAUTHORIZED');
      if (reply?.code === 'CANCELLED') throw fail('CANCELLED');
      if (reply?.code === 'HERMES_TIMEOUT') throw fail('TIMEOUT');
      if (reply?.code === 'UNCONFIGURED') throw new TurnFailure('UNCONFIGURED', failures.HERMES_UNCONFIGURED);
      // Only the upstream error code is surfaced, and only when it looks like one.
      const code = typeof reply?.code === 'string' && /^[A-Z][A-Z0-9_]{0,39}$/.test(reply.code) ? reply.code : `HTTP ${response.status}`;
      throw new TurnFailure('UPSTREAM_ERROR', `Igor could not answer (${code}).`);
    }
    if (reply?.contract !== 'stex.hermes.turn.v1' || reply.requestId !== request.requestId || !Array.isArray(reply.events)) throw fail('MALFORMED_RESPONSE');
    if (reply.status === 'cancelled') throw fail('CANCELLED');
    const text = reply.events.filter((event) => event?.type === 'message' && typeof event.payload?.text === 'string' && event.payload.text.trim())
      .map((event) => event.payload.text).join('\n\n');
    if (!text) throw fail('MALFORMED_RESPONSE');
    // Only a reply that says it is fake is labelled simulated.
    return { text, transport: reply.usage?.transport === 'fake' ? 'fake' : 'remote' };
  }

  async function probe() {
    const target = endpoint(url, '/v1/hermes/health');
    if (!target) return { ok: false, transport: 'unavailable' };
    try {
      const response = await fetchImpl(target, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(2_000) });
      const health = response.ok ? await response.json() : null;
      // A remote transport the inference service reports as unconfigured cannot answer.
      if (health?.ok !== true || health.configured === false || !['fake', 'remote'].includes(health.transport)) return { ok: false, transport: 'unavailable' };
      return { ok: true, transport: health.transport };
    } catch { return { ok: false, transport: 'unavailable' }; }
  }

  let cached = null;
  function health() {
    if (!cached || Date.now() - cached.at >= HEALTH_TTL_MS) cached = { at: Date.now(), result: probe() };
    return cached.result;
  }

  return { turn, health };
}
