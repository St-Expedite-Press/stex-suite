import { randomUUID, timingSafeEqual } from 'node:crypto';

function constantTimeMatch(actual, expected) { if (!actual || !expected) return false; const left = Buffer.from(actual); const right = Buffer.from(expected); return left.length === right.length && timingSafeEqual(left, right); }
function boundedText(value, maximum) { return String(value || '').trim().slice(0, maximum); }
function tokenEstimate(value) { return Math.ceil(String(value || '').length / 4); }

export function validateTurn(body, maxInputTokens) {
  if (!body || typeof body !== 'object') throw new Error('JSON body is required.');
  const turns = Array.isArray(body.turns) ? body.turns.slice(-12).map((turn) => ({ role: turn.role === 'assistant' ? 'assistant' : 'user', content: boundedText(turn.message || turn.content || turn.commentary, 4_000) })).filter((turn) => turn.content) : [];
  const message = boundedText(body.message, 4_000); if (!message) throw new Error('A message is required.');
  const context = body.context && typeof body.context === 'object' ? body.context : {};
  if (tokenEstimate(JSON.stringify({ turns, message, context })) > maxInputTokens) throw new Error('The requested context exceeds the configured input limit.');
  return { turns, message, context };
}

function texGraphProcedure(kind) {
  return `You are the persistent ScreenLab director operating a constrained TexGraph book-production turn (${kind}). Do not reveal internal routing, credentials, or unprovided source material. Work only with the bounded TexGraph envelope. Canonical Markdown is never changed automatically. Reply with exactly one JSON object: {"commentary":"...","noChange":true} or {"commentary":"...","proposal":{"source":"complete revised Markdown for the selected node"},"graphSuggestions":[{"kind":"...","message":"..."}],"ticketUpdates":{}}. A proposal must be a complete replacement of the selected node only, without TeX document setup, imports, commands, file operations, Lua, or shell escape. If the request is about layout or graph discovery, use noChange true and graphSuggestions instead.`;
}
function parseDirectorReply(snapshot) {
  if (snapshot?.status !== 'completed') throw new Error(snapshot?.error || 'Hermes did not complete the turn.');
  const reply = snapshot?.result?.reply;
  if (typeof reply !== 'string') throw new Error('Hermes returned no textual reply.');
  let parsed; try { parsed = JSON.parse(reply); } catch { return { commentary: reply.slice(0, 12000), noChange: true, proposal: null }; }
  if (typeof parsed.commentary !== 'string') throw new Error('Hermes reply omitted commentary.');
  const source = parsed?.proposal?.source;
  if (source !== undefined && typeof source !== 'string') throw new Error('Hermes proposal is malformed.');
  return { commentary: boundedText(parsed.commentary, 12000), noChange: parsed.noChange === true || !source, proposal: source ? { source: source.slice(0, 400000) } : null, graphSuggestions: Array.isArray(parsed.graphSuggestions) ? parsed.graphSuggestions.slice(0, 20) : [], ticketUpdates: parsed.ticketUpdates && typeof parsed.ticketUpdates === 'object' ? parsed.ticketUpdates : null };
}

export function createGateway({ config, fetchImpl = fetch, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }) {
  async function callHermes({ kind, body }) {
    if (!config.hermesUrl || !config.hermesKey) throw new Error('The Hermes bridge is not configured.');
    const turn = validateTurn(body, config.maxInputTokens);
    const session = `texgraph-${String(body.book?.id || body.book?.title || 'book').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40) || 'book'}`;
    const idempotencyKey = `tg-${randomUUID().replaceAll('-', '')}`;
    const envelope = { product: 'texgraph', contract: 'stex.texgraph.hermes-envelope.v1', procedure: texGraphProcedure(kind), selectedTarget: body.page || body.target || null, graph: body.graph || body.book?.graph || null, settingsTicket: body.book?.settings || body.ticket || {}, approvedSourceExcerpts: Array.isArray(body.approvedSourceExcerpts) ? body.approvedSourceExcerpts.slice(0, 8) : [], priorTurns: turn.turns };
    const start = await fetchImpl(new URL(`/v1/conversations/${encodeURIComponent(session)}/turns`, config.hermesUrl), { method: 'POST', headers: { 'content-type': 'application/json', 'x-screenlab-internal-key': config.hermesKey }, body: JSON.stringify({ actor: 'texgraph', message: `${texGraphProcedure(kind)}\n\nAuthor request:\n${turn.message}`, context: envelope, scope: 'texgraph', idempotency_key: idempotencyKey, correlation_id: idempotencyKey }) });
    if (!start.ok) throw new Error(`Hermes returned ${start.status}.`);
    let snapshot = await start.json(); const deadline = Date.now() + config.timeoutMs;
    while (snapshot?.status === 'running' && Date.now() < deadline) {
      await sleep(800);
      const status = await fetchImpl(new URL(`/v1/turns/${encodeURIComponent(idempotencyKey)}?wait=10`, config.hermesUrl), { headers: { 'x-screenlab-internal-key': config.hermesKey } });
      if (!status.ok) throw new Error(`Hermes status returned ${status.status}.`); snapshot = await status.json();
    }
    if (snapshot?.status === 'running') throw new Error('Hermes exceeded the gateway timeout.');
    return parseDirectorReply(snapshot);
  }
  return {
    health: () => ({ ok: true, configured: Boolean(config.hermesUrl && config.hermesKey), hermesConfigured: Boolean(config.hermesUrl && config.hermesKey) }),
    async handle({ token, kind, body }) { if (!constantTimeMatch(token, config.sharedSecret)) { const error = new Error('Unauthorized inference caller.'); error.status = 401; throw error; } if (!['interview', 'page-turn'].includes(kind)) { const error = new Error('Unknown inference contract.'); error.status = 404; throw error; } try { return await callHermes({ kind, body }); } catch (error) { error.status ||= 422; throw error; } },
  };
}
