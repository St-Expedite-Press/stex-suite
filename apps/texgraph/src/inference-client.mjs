const MAX_CONTEXT_TURNS = 10;

function assistantResult(commentary, availability = 'available') {
  return { commentary, availability, proposal: null };
}

export async function requestPageRevision({ book, page, turns, message }) {
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
        book: { title: book.title, author: book.author, design: book.design, context: book.context || {} },
        page: { id: page.id, title: page.title, source: page.source, sourceHash: page.hash },
        turns: turns.slice(-MAX_CONTEXT_TURNS).map(({ role, message: turnMessage, commentary }) => ({ role, message: turnMessage || commentary || '' })),
        message,
      }),
      signal: controller.signal,
    });
    if (!response.ok) return assistantResult(`The inference gateway returned ${response.status}. Your message was saved; no source was changed.`, 'unavailable');
    const payload = await response.json();
    const commentary = typeof payload.commentary === 'string' ? payload.commentary : 'The gateway returned no commentary.';
    if (payload.noChange === true) return assistantResult(commentary);
    if (typeof payload.proposal?.source === 'string') {
      return { commentary, availability: 'available', proposal: { source: payload.proposal.source, commentary } };
    }
    return assistantResult(`${commentary}\n\nNo valid source proposal was returned.`, 'invalid-response');
  } catch (error) {
    const reason = error.name === 'AbortError' ? 'timed out' : 'is unreachable';
    return assistantResult(`The inference gateway ${reason}. Your message was saved, but no revision was proposed.`, 'unavailable');
  } finally {
    clearTimeout(timeout);
  }
}
