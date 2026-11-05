import { createHash, randomUUID } from 'node:crypto';

// The compatibility API cannot choose a broader conversation identity than the
// caller's selected scope. Keep this pure so isolation is regression-tested
// without starting an HTTP server.
export function legacyHermesRequest(kind, value) {
  const turns = Array.isArray(value.turns) ? value.turns : [];
  const message = String(value.message || '').trim();
  const bookId = String(value.book?.id || 'unknown-book');
  const scopeId = String(value.scope?.id || value.page?.id || bookId);
  // Scope ids such as "book" recur in every project. Combine the owning book
  // and scope, then make the STEX-visible id opaque before Hermes derives its
  // own upstream session header.
  const conversationId = `frige-${createHash('sha256').update(`${bookId}\u0000${scopeId}`).digest('hex').slice(0, 40)}`;
  return {
    contract: 'stex.hermes.turn.v1', requestId: `texgraph-${kind}-${randomUUID()}`, product: 'frige',
    conversation: { id: conversationId, messages: [...turns.map((turn) => ({ role: turn?.role === 'assistant' ? 'assistant' : 'user', content: String(turn?.message || turn?.commentary || '').slice(0, 6_000) })).filter((turn) => turn.content), ...(message ? [{ role: 'user', content: message.slice(0, 6_000) }] : [])].slice(-20) },
    operation: { kind: 'conversation', payload: { legacyContract: String(value.contract || ''), kind } },
    context: {
      legacy: {
        scope: value.scope || null,
        page: value.page ? { id: value.page.id, title: value.page.title, sourceHash: value.page.sourceHash || value.page.hash || null } : null,
        scopeSources: (Array.isArray(value.scopeSources) ? value.scopeSources : []).slice(0, 80).map(({ nodeId, relativePath, title, kind: sourceKind, sourceHash, source }) => ({ nodeId, relativePath, title, kind: sourceKind, sourceHash, source })),
        withheldNodes: Array.isArray(value.withheldNodes) ? value.withheldNodes.slice(0, 80) : [],
      },
    },
    budget: { maxContextChars: 96_000, maxOutputChars: 20_000, timeoutMs: 30_000 },
  };
}
