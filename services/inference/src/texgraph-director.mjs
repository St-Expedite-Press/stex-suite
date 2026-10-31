const skills = [
  {
    id: 'texgraph.book-scope',
    purpose: 'Reason about the selected whole-book, section, or manuscript-page scope using Programme order and its graph neighborhood.',
    rules: ['Programme order is authoritative.', 'A scope is not permission to alter every node inside it.', 'State when a suggestion concerns the whole book, a section, or one page.'],
  },
  {
    id: 'texgraph.markdown-revision',
    purpose: 'Develop or revise canonical Obsidian Markdown while preserving links, headings, and the author approval boundary.',
    rules: ['Only propose a complete replacement for the selected individual node.', 'Never write canonical source automatically.', 'Use graph suggestions, not a source proposal, for book- or section-level work.'],
  },
  {
    id: 'texgraph.composition',
    purpose: 'Assess sequencing, section architecture, transitions, and recurring motifs from the bounded manuscript graph.',
    rules: ['Do not derive reading order from folders.', 'Explain consequences in Programme order.', 'Keep structural ideas separate from accepted manuscript edits.'],
  },
  {
    id: 'texgraph.document-grounding',
    purpose: 'Use author-approved uploaded excerpts as supporting context without treating an upload as canonical manuscript material.',
    rules: ['Only approved excerpts are available.', 'Do not reveal, request, or infer unapproved source-pack content.', 'Attribute uncertainty when excerpts are partial.'],
  },
  {
    id: 'texgraph.print-preview',
    purpose: 'Reason about LuaLaTeX book previews, page maps, recto-verso implications, and prefix builds.',
    rules: ['A scoped preview includes the preamble and every preceding Programme node.', 'Compilation remains an explicit author action.', 'Never emit document classes, imports, command definitions, file operations, Lua, or shell escape in a Markdown proposal.'],
  },
];

const tools = [
  { id: 'texgraph.vault-graph.inspect', mode: 'bounded-context', purpose: 'Read the supplied canonical graph, scope, Programme order, diagnostics, and selected target.' },
  { id: 'texgraph.programme.prefix-preview', mode: 'deterministic-local', purpose: 'Describe the exact build boundary supplied by the product; it does not run a compiler from the director.' },
  { id: 'texgraph.markdown.propose', mode: 'proposal-only', purpose: 'Return a complete replacement for the selected individual node; author acceptance is required.' },
  { id: 'texgraph.document.extract', mode: 'review-gated', purpose: 'Use only pre-extracted, author-approved excerpts supplied in the envelope.' },
];

const mcpServers = [
  { id: 'texgraph-vault', access: 'context-adapter', operations: ['graph.inspect', 'scope.inspect', 'programme.inspect'], note: 'The product supplies bounded results; the director has no raw vault filesystem access.' },
  { id: 'markitdown', access: 'review-gated-context-adapter', operations: ['document.extract'], note: 'Extraction occurs server-side. Only author-approved text reaches the director.' },
  { id: 'lualatex-preview', access: 'explicit-local-operation', operations: ['preview.describe', 'page-map.inspect'], note: 'Compilation is a deterministic, author-triggered product operation, never a director shell tool.' },
];

export function texGraphDirectorKit(kind) {
  return {
    version: 'stex.texgraph.director-kit.v1',
    turnKind: kind,
    skills,
    tools,
    mcpServers,
    boundaries: [
      'No direct filesystem, shell, browser, network, provider, credential, or canonical-state write access.',
      'The browser never receives internal routing, provider configuration, or capability credentials.',
      'The director may recommend operations; the product performs validated deterministic work and author-gated writes.',
    ],
  };
}

export function texGraphProcedure(kind) {
  return `You are the persistent ScreenLab director operating a constrained TexGraph book-production turn (${kind}). You have the TexGraph Director Kit in the envelope. Its tools are bounded context adapters and product operations, not an invitation to claim filesystem, shell, browser, network, compiler, credential, or provider access. Do not reveal internal routing, credentials, or unprovided source material. Work only with the bounded TexGraph envelope. Canonical Markdown is never changed automatically. Reply with exactly one JSON object: {"commentary":"...","noChange":true} or {"commentary":"...","proposal":{"source":"complete revised Markdown for the selected node"},"graphSuggestions":[{"kind":"...","message":"..."}],"ticketUpdates":{}}. A proposal must be a complete replacement of the selected node only, without TeX document setup, imports, commands, file operations, Lua, or shell escape. If the request is about layout or graph discovery, use noChange true and graphSuggestions instead.`;
}
