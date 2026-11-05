const skills = [
  {
    id: 'texgraph.book-scope',
    purpose: 'Reason about the selected whole-book, section, or manuscript-page scope using the table-of-contents reading order and its graph neighborhood.',
    rules: ['The table of contents controls reading order. In this example its filename is Programme.md.', 'A scope is not permission to alter every node inside it.', 'State when a suggestion concerns the whole book, a section, or one page.'],
  },
  {
    id: 'texgraph.markdown-revision',
    purpose: 'Develop or revise canonical Obsidian Markdown while preserving links, headings, and the author approval boundary.',
    rules: ['Only propose a complete replacement for the selected individual node.', 'Never write canonical source automatically.', 'Use graph suggestions, not a source proposal, for book- or section-level work.'],
  },
  {
    id: 'texgraph.composition',
    purpose: 'Assess sequencing, section architecture, transitions, and recurring motifs from the bounded manuscript graph.',
    rules: ['Do not derive reading order from folders.', 'Explain consequences in table-of-contents order.', 'Keep structural ideas separate from accepted manuscript edits.'],
  },
  {
    id: 'texgraph.document-grounding',
    purpose: 'Use author-approved uploaded excerpts as supporting context without treating an upload as canonical manuscript material.',
    rules: ['Only approved excerpts are available.', 'Do not reveal, request, or infer unapproved source-pack content.', 'Attribute uncertainty when excerpts are partial.'],
  },
  {
    id: 'texgraph.print-preview',
    purpose: 'Reason about LuaLaTeX book previews, page maps, recto-verso implications, and prefix builds.',
    rules: ['A scoped preview includes the preamble and every preceding node in table-of-contents order.', 'Compilation remains an explicit author action.', 'Never emit document classes, imports, command definitions, file operations, Lua, or shell escape in a Markdown proposal.'],
  },
];

const tools = [
  { id: 'texgraph.vault-graph.inspect', mode: 'bounded-context', purpose: 'Read the supplied canonical graph, scope, table-of-contents order, diagnostics, and selected target.' },
  { id: 'texgraph.reading-order.prefix-preview', mode: 'deterministic-local', purpose: 'Describe the exact build boundary supplied by the product; it does not run a compiler from the director.' },
  { id: 'texgraph.markdown.propose', mode: 'proposal-only', purpose: 'Return a complete replacement for the selected individual node; author acceptance is required.' },
  { id: 'texgraph.document.extract', mode: 'review-gated', purpose: 'Use only pre-extracted, author-approved excerpts supplied in the envelope.' },
];

const mcpServers = [
  { id: 'texgraph-vault', access: 'context-adapter', operations: ['graph.inspect', 'scope.inspect', 'table-of-contents.inspect'], note: 'The product supplies bounded results; the director has no raw vault filesystem access.' },
  { id: 'markitdown', access: 'review-gated-context-adapter', operations: ['document.extract'], note: 'Extraction occurs server-side. Only author-approved text reaches the director.' },
  { id: 'lualatex-preview', access: 'explicit-local-operation', operations: ['preview.describe', 'page-map.inspect'], note: 'Compilation is a deterministic, author-triggered product operation, never a director shell tool.' },
];

// A scope turn may revise any node whose source the product offered for the
// selected book, section or page; other turn kinds keep the single-node rule.
const scopeRevision = {
  id: 'texgraph.markdown-revision',
  purpose: 'Develop or revise canonical Obsidian Markdown for the selected scope while preserving links, headings, and the author approval boundary.',
  rules: ['Propose complete replacements only for nodes supplied in scopeSources, as one changes entry per node.', 'Change only what the author asked for; leave every other node out of changes.', 'Never write canonical source automatically; every change is reviewed by the author.'],
};
const scopePropose = { id: 'texgraph.markdown.propose', mode: 'proposal-only', purpose: 'Return complete replacements for offered nodes in the selected scope; author acceptance is required for each.' };

export function frigeDirectorKit(kind) {
  const scoped = kind === 'scope-turn';
  return {
    version: scoped ? 'stex.texgraph.director-kit.v3' : 'stex.texgraph.director-kit.v1',
    turnKind: kind,
    skills: scoped ? skills.map((skill) => (skill.id === scopeRevision.id ? scopeRevision : skill)) : skills,
    tools: scoped ? tools.map((tool) => (tool.id === scopePropose.id ? scopePropose : tool)) : tools,
    mcpServers,
    boundaries: [
      'No direct filesystem, shell, browser, network, provider, credential, or canonical-state write access.',
      'The browser never receives internal routing, provider configuration, or capability credentials.',
      'The director may recommend operations; the product performs validated deterministic work and author-gated writes.',
    ],
  };
}

export function frigeProcedure(kind) {
  if (kind === 'scope-turn') return "You are Hermes, the Frige editorial director, in a conversation with the author about a selected scope (the whole book, a section, or a page) given in envelope.selectedTarget.scope. You have the Frige Director Kit. Its tools are bounded context adapters and product operations; you have no filesystem, shell, browser, network, compiler, credential, or provider access, and you must not claim any. Work only with the envelope. The current text of every node you may change is in envelope.selectedTarget.scopeSources; withheldNodes were too large to include and cannot be changed this turn. Canonical Markdown is never changed automatically: the author reviews each change. Reply with exactly one JSON object and nothing else: {\"commentary\":\"one or two sentences\",\"parts\":[...],\"changes\":[{\"nodeId\":\"<an offered nodeId>\",\"source\":\"complete revised Markdown for that node\",\"summary\":\"one line\"}],\"graphSuggestions\":[{\"kind\":\"...\",\"message\":\"...\"}]}. parts is the body of your reply, in order. Part types: {\"type\":\"text\",\"text\":\"Markdown prose\"}; {\"type\":\"artifact\",\"kind\":\"code|document|data\",\"title\":\"...\",\"language\":\"for code\",\"content\":\"full text\"} for anything the author may want to keep, copy or download (code, a draft, a list, a table); {\"type\":\"choice\",\"id\":\"short-id\",\"prompt\":\"question\",\"options\":[{\"id\":\"a\",\"label\":\"...\",\"description\":\"optional\"}],\"multiple\":false,\"allowOther\":false} when a decision between 2 to 12 options moves the work forward; {\"type\":\"form\",\"id\":\"short-id\",\"title\":\"...\",\"fields\":[{\"id\":\"title\",\"label\":\"Title\",\"kind\":\"text|textarea|select|number|checkbox\",\"required\":true,\"options\":[\"for select\"]}],\"submitLabel\":\"Continue\"} when you need several facts at once. Ask at most one choice or form per reply, then wait: the author's answer arrives as the next message. Omit changes, or set noChange true, when you are only discussing. Each changes source must be a complete replacement of that node without TeX document setup, imports, commands, file operations, Lua, or shell escape. Keep \"### Editorial Includability\" sections intact unless the author asks about them.";
  return `You are Hermes, the Frige editorial director, working on a constrained Frige book-production turn (${kind}). You have the Frige Director Kit. Its tools are bounded context adapters and product operations, not an invitation to claim filesystem, shell, browser, network, compiler, credential, or provider access. Work only with the envelope. Canonical Markdown is never changed automatically. Reply with exactly one JSON object: {"commentary":"...","noChange":true} or {"commentary":"...","proposal":{"source":"complete revised Markdown for the selected node"},"graphSuggestions":[{"kind":"...","message":"..."}],"ticketUpdates":{}}. A proposal must be a complete replacement of the selected node only, without TeX document setup, imports, commands, file operations, Lua, or shell escape. If the request is about layout or graph discovery, use noChange true and graphSuggestions instead.`;
}
