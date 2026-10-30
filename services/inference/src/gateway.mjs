import { timingSafeEqual } from 'node:crypto';

function constantTimeMatch(actual, expected) {
  if (!actual || !expected) return false;
  const left = Buffer.from(actual); const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function boundedText(value, maximum) { return String(value || '').trim().slice(0, maximum); }
function tokenEstimate(value) { return Math.ceil(String(value || '').length / 4); }

export function validateTurn(body, maxInputTokens) {
  if (!body || typeof body !== 'object') throw new Error('JSON body is required.');
  const turns = Array.isArray(body.turns) ? body.turns.slice(-16).map((turn) => ({ role: turn.role === 'assistant' ? 'assistant' : 'user', content: boundedText(turn.message || turn.content, 12_000) })).filter((turn) => turn.content) : [];
  const message = boundedText(body.message, 12_000);
  if (!message) throw new Error('A message is required.');
  const context = boundedText(body.context, 48_000);
  if (tokenEstimate(JSON.stringify({ turns, message, context })) > maxInputTokens) throw new Error('The requested context exceeds the configured input limit.');
  return { turns, message, context };
}

function interviewInstructions() {
  return `You are TexGraph, a thoughtful book-production interviewer. Ask one useful follow-up at a time. Work from the author's manuscript/project context; do not invent source facts. When there is enough information, include a concise settings ticket in this exact JSON envelope: {"commentary":"...","ticket":null|{"title":"...","author":"...","editorialIntent":"...","sourceMode":"start-blank|existing-markdown|mixed-material","bookType":"poetry-collection|chapbook|anthology|hybrid","podProfile":"cross-pod|amazon-kdp|ingramspark|lulu","trimSize":"...","interiorInk":"black-white|standard-color","paperStock":"white|cream","bleed":"no-bleed|full-bleed","margins":"...","isbnPlan":"own-isbn|platform-isbn|unassigned","proofPlan":"order-proof|digital-preflight","coverFinish":"matte|gloss"}}. Return JSON only.`;
}

function pageInstructions() {
  return `You are TexGraph, an exacting book editor and LuaLaTeX assistant. Return JSON only: {"commentary":"...","noChange":true} or {"commentary":"...","proposal":{"source":"complete revised page body source"}}. Never include document classes, packages, file access, shell escape, Lua, or command definitions in source.`;
}

export function createGateway({ config, fetchImpl = fetch }) {
  async function callProvider({ kind, body }) {
    if (!config.apiKey || !config.model) throw new Error('Inference is not configured with an OpenRouter key and model.');
    const turn = validateTurn(body, config.maxInputTokens);
    const messages = [{ role: 'system', content: kind === 'interview' ? interviewInstructions() : pageInstructions() }];
    if (turn.context) messages.push({ role: 'system', content: `Project context:\n${turn.context}` });
    messages.push(...turn.turns, { role: 'user', content: turn.message });
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      const providerUrl = new URL('chat/completions', `${String(config.baseUrl).replace(/\/+$/, '')}/`);
      const response = await fetchImpl(providerUrl, { method: 'POST', headers: { authorization: `Bearer ${config.apiKey}`, 'content-type': 'application/json', 'http-referer': config.siteUrl, 'x-title': config.appName }, body: JSON.stringify({ model: config.model, messages, max_tokens: config.maxOutputTokens, response_format: { type: 'json_object' } }), signal: controller.signal });
      if (!response.ok) throw new Error(`Provider returned ${response.status}.`);
      const payload = await response.json(); const content = payload?.choices?.[0]?.message?.content;
      let parsed; try { parsed = JSON.parse(content); } catch { throw new Error('Provider returned an invalid structured response.'); }
      if (typeof parsed?.commentary !== 'string') throw new Error('Provider response is missing commentary.');
      return kind === 'interview' ? { commentary: boundedText(parsed.commentary, 12_000), ticket: parsed.ticket && typeof parsed.ticket === 'object' ? parsed.ticket : null } : { commentary: boundedText(parsed.commentary, 12_000), noChange: parsed.noChange === true, proposal: typeof parsed?.proposal?.source === 'string' ? { source: parsed.proposal.source.slice(0, 200_000) } : null };
    } finally { clearTimeout(timer); }
  }

  return {
    health: () => ({ ok: true, configured: Boolean(config.apiKey && config.model), modelConfigured: Boolean(config.model) }),
    async handle({ token, kind, body }) {
      if (!constantTimeMatch(token, config.sharedSecret)) { const error = new Error('Unauthorized inference caller.'); error.status = 401; throw error; }
      if (kind !== 'interview' && kind !== 'page-turn') { const error = new Error('Unknown inference contract.'); error.status = 404; throw error; }
      try { return await callProvider({ kind, body }); } catch (error) { error.status ||= 422; throw error; }
    },
  };
}
