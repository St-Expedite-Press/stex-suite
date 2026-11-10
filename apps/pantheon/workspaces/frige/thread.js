// The conversation thread: Igor's replies as typed parts (prose, artifact cards,
// choices and forms), the changes it suggests shown inside the reply that made them,
// and the author's answers. Everything is built from text nodes, so nothing a model
// writes is ever parsed as HTML.
import { lineDiff } from './line-diff.js';

export const element = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
const button = (className, text, onClick) => { const node = element('button', className, text); node.type = 'button'; node.addEventListener('click', onClick); return node; };

// **bold**, *italic* or _italic_, and `code` within a line.
function inline(text) {
  const nodes = []; let last = 0;
  for (const match of text.matchAll(/\*\*(.+?)\*\*|`([^`]+)`|\*(?=\S)([^*]+?)\*|(?<![\p{L}\p{N}])_(?=\S)([^_]+?)_(?![\p{L}\p{N}])/gu)) {
    if (match.index > last) nodes.push(document.createTextNode(text.slice(last, match.index)));
    nodes.push(match[1] !== undefined ? element('strong', '', match[1]) : match[2] !== undefined ? element('code', '', match[2]) : element('em', '', match[3] ?? match[4]));
    last = match.index + match[0].length;
  }
  if (last < text.length) nodes.push(document.createTextNode(text.slice(last)));
  return nodes;
}

// Paragraphs, short headings, and bulleted or numbered lists; other line breaks are kept.
export function richText(text) {
  const fragment = document.createDocumentFragment();
  const bullet = /^\s*[-*•]\s+/; const numbered = /^\s*\d+[.)]\s+/;
  for (const block of String(text || '').replace(/\r\n?/g, '\n').split(/\n\s*\n/)) {
    const lines = block.split('\n').filter((line) => line.trim());
    if (!lines.length) continue;
    const ordered = lines.every((line) => numbered.test(line));
    if (ordered || lines.every((line) => bullet.test(line))) {
      const list = element(ordered ? 'ol' : 'ul');
      for (const line of lines) { const item = element('li'); item.append(...inline(line.replace(ordered ? numbered : bullet, ''))); list.append(item); }
      fragment.append(list); continue;
    }
    const paragraph = element('p');
    lines.forEach((line, index) => {
      if (index) paragraph.append(element('br'));
      const heading = /^#{1,4}\s+(.+)$/.exec(line.trim());
      if (heading) { const strong = element('strong'); strong.append(...inline(heading[1])); paragraph.append(strong); } else paragraph.append(...inline(line));
    });
    fragment.append(paragraph);
  }
  return fragment;
}

const time = (at) => (at ? new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '');
const size = (bytes) => (bytes < 1024 ? `${bytes} B` : bytes < 1_048_576 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1_048_576).toFixed(1)} MB`);
const decisionText = { accepted: 'Accepted', rejected: 'Rejected', stale: 'Not applied — edited since the suggestion', failed: 'Not applied' };

// Pending changes as line diffs, each with its own decision.
function changeCards(changeSet, onDecide) {
  const pending = changeSet.changes.filter((change) => change.status === 'pending');
  const box = element('section', 'changes');
  const header = element('div', 'changes-header');
  header.append(element('span', '', `Suggested change${pending.length === 1 ? '' : 's'} · ${pending.length} piece${pending.length === 1 ? '' : 's'}`));
  if (pending.length > 1) {
    const all = element('span', 'change-actions');
    all.append(button('accept', 'Accept all', () => onDecide(null, 'accept')), button('reject', 'Reject all', () => onDecide(null, 'reject')));
    header.append(all);
  }
  box.append(header, ...pending.map((change) => {
    const card = element('details', 'change-card'); card.open = true;
    const summary = element('summary');
    summary.append(element('strong', '', change.title), element('small', '', `manuscript/${change.relativePath}`));
    const diff = element('pre', 'change-diff');
    for (const row of lineDiff(change.before, change.source)) diff.append(element('span', `diff-${row.type}`, row.type === 'skip' ? `… ${row.count} unchanged line${row.count === 1 ? '' : 's'}` : `${{ same: '  ', add: '+ ', del: '− ' }[row.type]}${row.text || (row.type === 'same' ? '' : '(blank line)')}`));
    const actions = element('div', 'change-actions');
    actions.append(button('accept', 'Accept', () => onDecide(change.nodeId, 'accept')), button('reject', 'Reject', () => onDecide(change.nodeId, 'reject')));
    card.append(summary, ...(change.summary ? [element('p', 'change-summary', change.summary)] : []), diff, actions);
    return card;
  }));
  return box;
}

// Artifact text is fetched once and kept for later renders of the thread.
const contentCache = new Map();
function loadText(url) {
  if (!contentCache.has(url)) contentCache.set(url, fetch(url).then((response) => (response.ok ? response.text() : Promise.reject(new Error('Unavailable')))));
  return contentCache.get(url);
}

function artifactCard(part, artifactUrl) {
  const url = artifactUrl(part.artifactId); const card = element('article', `artifact-card kind-${part.kind}`);
  const header = element('header');
  header.append(element('span', 'artifact-kind', [part.kind, part.language].filter(Boolean).join(' · ')), element('strong', 'artifact-title', part.title), element('span', 'artifact-size', size(part.bytes)));
  const body = element('div', 'artifact-body'); const actions = element('footer', 'artifact-actions');
  if (part.kind === 'image') {
    const image = element('img'); image.src = url; image.alt = part.title; image.loading = 'lazy'; body.append(image);
  } else {
    const preview = part.kind === 'document' ? element('div', 'artifact-document') : element('pre', 'artifact-code');
    preview.textContent = 'Loading…'; body.append(preview);
    loadText(url).then((text) => {
      if (part.kind === 'document') preview.replaceChildren(richText(text)); else preview.textContent = text;
      if (preview.scrollHeight > 280) {
        card.classList.add('collapsed');
        const more = button('quiet-button', 'Show all', () => { const open = card.classList.toggle('collapsed'); more.textContent = open ? 'Show all' : 'Show less'; });
        actions.prepend(more);
      }
    }).catch(() => { preview.textContent = 'This artifact could not be loaded.'; });
    actions.append(button('quiet-button', 'Copy', async (event) => { try { await navigator.clipboard.writeText(await loadText(url)); event.target.textContent = 'Copied'; } catch { event.target.textContent = 'Copy failed'; } setTimeout(() => { event.target.textContent = 'Copy'; }, 1500); }));
  }
  const download = element('a', 'quiet-button', 'Download'); download.href = artifactUrl(part.artifactId, { download: true });
  const open = element('a', 'quiet-button', 'Open'); open.href = url; open.target = '_blank'; open.rel = 'noopener';
  actions.append(download, open);
  card.append(header, body, actions);
  return card;
}

// A choice or form; once answered it shows the answer and can no longer be sent. An
// unsent draft refills it after a re-render, and it cannot be sent while Igor replies.
function promptCard(part, answer, onAnswer, draft, busy) {
  const shown = answer || draft;
  const form = element('form', `prompt prompt-${part.type}${answer ? ' answered' : ''}`);
  const status = element('p', 'prompt-status');
  form.append(element('p', 'prompt-title', part.type === 'choice' ? part.prompt : part.title || 'A few details'));
  if (part.type === 'choice') {
    const chosen = new Set(shown?.selected || []);
    const options = element('div', 'prompt-options');
    for (const option of part.options) {
      const label = element('label', 'prompt-option');
      const input = element('input'); input.type = part.multiple ? 'checkbox' : 'radio'; input.name = `${part.promptId}-choice`; input.value = option.id; input.checked = chosen.has(option.id); input.disabled = Boolean(answer);
      const text = element('span'); text.append(element('strong', '', option.label), ...(option.description ? [element('small', '', option.description)] : []));
      label.append(input, text); options.append(label);
    }
    form.append(options);
    if (part.allowOther) { const other = element('input', 'prompt-other'); other.name = 'other'; other.placeholder = 'Something else…'; other.value = shown?.other || ''; other.disabled = Boolean(answer); form.append(other); }
  } else {
    for (const field of part.fields) {
      const label = element('label', `prompt-field kind-${field.kind}`);
      const caption = element('span', '', `${field.label}${field.required ? ' *' : ''}`);
      let input;
      if (field.kind === 'textarea') input = element('textarea');
      else if (field.kind === 'select') { input = element('select'); input.append(new Option('', ''), ...field.options.map((option) => new Option(option, option))); }
      else { input = element('input'); input.type = field.kind === 'number' ? 'number' : field.kind === 'checkbox' ? 'checkbox' : 'text'; }
      input.name = field.id; input.required = field.required && field.kind !== 'checkbox'; input.disabled = Boolean(answer);
      if (field.placeholder && 'placeholder' in input) input.placeholder = field.placeholder;
      const value = shown?.[field.id];
      if (field.kind === 'checkbox') input.checked = value === true; else if (value !== undefined && value !== null) input.value = String(value);
      if (field.kind === 'checkbox') label.append(input, caption); else label.append(caption, input);
      form.append(label);
    }
  }
  if (answer) { status.textContent = 'Answered'; form.append(status); return form; }
  const submit = element('button', 'prompt-submit', part.type === 'form' ? part.submitLabel || 'Send' : 'Answer'); submit.type = 'submit'; submit.disabled = busy;
  form.append(submit, status);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const values = part.type === 'choice'
      ? { selected: [...form.querySelectorAll('.prompt-option input:checked')].map((input) => input.value), ...(form.elements.namedItem('other')?.value.trim() ? { other: form.elements.namedItem('other').value.trim() } : {}) }
      : Object.fromEntries(part.fields.map((field) => { const input = form.elements.namedItem(field.id); return [field.id, field.kind === 'checkbox' ? input.checked : input.value]; }));
    submit.disabled = true;
    onAnswer(part.promptId, values);
  });
  return form;
}

function message(turn, { changeSet, answers, drafts, busy, onDecide, onAnswer, artifactUrl }) {
  if (turn.kind === 'changes-decided') {
    const note = element('div', 'msg from-system');
    for (const decision of turn.decisions) note.append(element('span', `decision ${decision.status}`, `${decisionText[decision.status] || decision.status} · ${decision.title}`));
    return note;
  }
  const fromUser = turn.role === 'user';
  const item = element('article', `msg ${fromUser ? 'from-user' : 'from-hermes'}${turn.kind === 'answer' ? ' is-answer' : ''}${turn.availability && turn.availability !== 'available' ? ' failed' : ''}`);
  const label = fromUser ? (turn.kind === 'answer' ? 'You · answer' : 'You') : `Igor${turn.meta?.model ? ` · ${turn.meta.model}` : ''}`;
  const meta = element('div', 'msg-meta', `${label}${turn.at ? ` · ${time(turn.at)}` : ''}`);
  if (turn.meta?.skipped?.length) meta.append(element('span', 'msg-fallback', ` · ${turn.meta.skipped.join(', ')} unavailable`));
  item.append(meta);
  const body = element('div', 'msg-body');
  if (fromUser) body.append(richText(turn.message));
  else {
    if (turn.commentary) body.append(richText(turn.commentary));
    for (const part of turn.parts || []) {
      if (part.type === 'text') { if (part.text !== turn.commentary) body.append(richText(part.text)); }
      else if (part.type === 'artifact') body.append(artifactCard(part, artifactUrl));
      else if (part.type === 'choice' || part.type === 'form') body.append(promptCard(part, answers.get(part.promptId), onAnswer, drafts?.get(part.promptId), busy));
    }
  }
  item.append(body);
  if (!fromUser) {
    if (turn.graphSuggestions?.length) {
      const list = element('ul', 'msg-aside');
      for (const suggestion of turn.graphSuggestions) list.append(element('li', '', suggestion.message));
      item.append(list);
    }
    const setAside = [...(turn.droppedChanges || []), ...(turn.droppedParts || [])];
    if (setAside.length) item.append(element('p', 'msg-aside', `${setAside.length} item${setAside.length === 1 ? ' was' : 's were'} set aside: ${[...new Set(setAside.map((entry) => entry.reason))].join(' ')}`));
    if (turn.changeSetId && turn.changeSetId === changeSet?.id && changeSet.changes.some((change) => change.status === 'pending')) item.append(changeCards(changeSet, onDecide));
  }
  return item;
}

// Renders the whole thread; returns the element a new reply should scroll to.
export function renderThread(box, { turns, thinking, notice, changeSet, empty, drafts, onDecide, onAnswer, artifactUrl }) {
  if (!turns.length && !thinking && !notice) {
    const intro = element('div', 'thread-empty');
    intro.append(element('strong', '', empty.title), element('p', '', empty.text));
    box.replaceChildren(intro); return null;
  }
  const answers = new Map(turns.filter((turn) => turn.kind === 'answer').map((turn) => [turn.promptId, turn.values]));
  const items = turns.map((turn) => message(turn, { changeSet, answers, drafts, busy: thinking, onDecide, onAnswer, artifactUrl }));
  // Pending changes whose reply is no longer in view still need a decision.
  if (changeSet?.changes.some((change) => change.status === 'pending') && !turns.some((turn) => turn.changeSetId === changeSet.id)) items.push(changeCards(changeSet, onDecide));
  if (thinking) { const typing = element('article', 'msg from-hermes thinking'); typing.append(element('div', 'msg-meta', 'Igor'), element('div', 'typing', '')); typing.lastChild.append(element('i'), element('i'), element('i')); items.push(typing); }
  if (notice) items.push(element('div', 'msg from-system notice', notice));
  box.replaceChildren(...items);
  return items.at(-1);
}
