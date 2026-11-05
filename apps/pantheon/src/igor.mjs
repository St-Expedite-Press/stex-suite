import { randomUUID } from 'node:crypto';

// Igor is the user-facing name of the STEX assistant. Pantheon relays a turn to
// services/inference over stex.hermes.turn.v1 (protocol/hermes); the shared
// secret stays on this server and nothing is stored. Each reply reports its own
// transport, so a simulated reply is always labelled as one.

// requestBytes admits the largest well-formed request a client may send
// (11 messages x 2,000 characters x up to 4 UTF-8 bytes, plus JSON); the
// conversation is then trimmed to contextBytes, which stays under the
// inference service's maxContextChars (it counts UTF-8 bytes of the JSON).
export const IGOR_LIMITS = Object.freeze({ messageChars: 2000, historyMessages: 10, requestBytes: 96_000, contextBytes: 20_000, timeoutMs: 20_000 });

export class IgorError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

const jsonBytes = (value) => Buffer.byteLength(JSON.stringify(value));

function cleanHistory(body) {
  const message = typeof body?.message === 'string' ? body.message.trim() : '';
  if (!message) throw new IgorError(400, 'INVALID_REQUEST', 'Ask Igor something first.');
  if (message.length > IGOR_LIMITS.messageChars) throw new IgorError(400, 'INVALID_REQUEST', `Keep questions under ${IGOR_LIMITS.messageChars} characters.`);
  const history = Array.isArray(body.history) ? body.history.slice(-IGOR_LIMITS.historyMessages) : [];
  const earlier = history
    .filter((entry) => ['user', 'assistant'].includes(entry?.role) && typeof entry.content === 'string' && entry.content.trim())
    .map((entry) => ({ role: entry.role, content: entry.content.trim().slice(0, IGOR_LIMITS.messageChars) }));
  // Drop the oldest context until the conversation fits; the question itself always goes.
  const messages = [...earlier, { role: 'user', content: message }];
  while (messages.length > 1 && jsonBytes(messages) > IGOR_LIMITS.contextBytes) messages.shift();
  const conversationId = typeof body?.conversationId === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(body.conversationId)
    ? body.conversationId : 'pantheon-default';
  return { messages, conversationId };
}

// Only this page may spend the shared secret: a JSON body (other sites cannot
// send one without a CORS preflight, which Pantheon never grants), a loopback
// Host (defeats DNS rebinding), and no cross-site Origin or Sec-Fetch-Site.
export function assertSameOrigin(headers) {
  const host = String(headers.host || '');
  if (!/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(host)) throw new IgorError(403, 'FORBIDDEN', 'Igor answers only on the local Pantheon address.');
  if (!String(headers['content-type'] || '').toLowerCase().startsWith('application/json')) throw new IgorError(415, 'INVALID_REQUEST', 'Igor requests must be JSON.');
  const site = headers['sec-fetch-site'];
  if (site && !['same-origin', 'none'].includes(site)) throw new IgorError(403, 'FORBIDDEN', 'Igor answers only Pantheon pages.');
  if (headers.origin && headers.origin !== `http://${host}`) throw new IgorError(403, 'FORBIDDEN', 'Igor answers only Pantheon pages.');
}

export async function igorTurn(body, { inferenceUrl, sharedSecret, fetchImpl = fetch } = {}) {
  const { messages, conversationId } = cleanHistory(body);
  if (!inferenceUrl) throw new IgorError(503, 'UNCONFIGURED', 'Igor is not connected: STEX_INFERENCE_URL is not set for Pantheon.');
  const requestId = randomUUID();
  const request = {
    contract: 'stex.hermes.turn.v1', requestId, product: 'pantheon',
    conversation: { id: conversationId, messages }, operation: { kind: 'conversation' }, context: {},
    budget: { maxContextChars: 24_000, maxOutputChars: 4_000, timeoutMs: IGOR_LIMITS.timeoutMs },
  };
  let response;
  try {
    response = await fetchImpl(new URL('/v1/hermes/turn', inferenceUrl), {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-stex-inference-token': sharedSecret || '' },
      body: JSON.stringify(request), signal: AbortSignal.timeout(IGOR_LIMITS.timeoutMs + 2_000),
    });
  } catch (error) {
    if (error?.name === 'TimeoutError') throw new IgorError(504, 'TIMEOUT', 'Igor did not answer in time.');
    throw new IgorError(503, 'UNAVAILABLE', 'Igor is not reachable: the inference service is not running.');
  }
  let reply;
  try { reply = await response.json(); }
  catch (error) {
    if (error?.name === 'TimeoutError') throw new IgorError(504, 'TIMEOUT', 'Igor did not answer in time.');
    throw new IgorError(502, 'MALFORMED_RESPONSE', 'Igor sent a reply Pantheon could not read.');
  }
  if (!response.ok) throw new IgorError(502, reply?.code === 'UNAUTHORIZED' ? 'UNAUTHORIZED' : 'UPSTREAM_ERROR', reply?.code === 'UNAUTHORIZED' ? 'Igor refused Pantheon: the shared inference secret does not match.' : `Igor could not answer (${reply?.code || response.status}).`);
  if (reply?.contract !== 'stex.hermes.turn.v1' || reply.requestId !== requestId || !Array.isArray(reply.events)) throw new IgorError(502, 'MALFORMED_RESPONSE', 'Igor sent a reply Pantheon could not read.');
  if (reply.status === 'cancelled') throw new IgorError(502, 'CANCELLED', 'Igor stopped before answering.');
  const text = reply.events.filter((event) => event?.type === 'message' && typeof event.payload?.text === 'string').map((event) => event.payload.text).join('\n\n');
  if (!text) throw new IgorError(502, 'MALFORMED_RESPONSE', 'Igor replied without a message.');
  // Only a reply that says it is fake is labelled simulated; anything else is
  // reported as a remote reply rather than mislabelled.
  return { requestId, conversationId, reply: text, transport: reply.usage?.transport === 'fake' ? 'fake' : 'remote' };
}
