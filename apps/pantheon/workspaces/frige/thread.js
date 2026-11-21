// The conversation thread: Igor's replies as typed parts (prose, artifact cards,
// choices and forms), the changes it suggests shown inside the reply that made them,
// and the author's answers. Everything is built from text nodes, so nothing a model
// writes is ever parsed as HTML.
import { collapse, diffHunks, diffRows, lineEndingsDiffer } from './line-diff.js';

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
const decisionText = { accepted: 'Accepted', rejected: 'Rejected', stale: 'Not applied — edited since the suggestion', failed: 'Not applied', superseded: 'Replaced by a newer suggestion', reverted: 'Rolled back' };
const plural = (count, noun) => `${count} ${noun}${count === 1 ? '' : 's'}`;
// A proof may be from another day, so its note carries the date as well as the time.
const dateAndTime = (at) => new Date(at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

/**
 * The terms of a change contract in plain sentences: what Igor was shown, what
 * accepting affects, and how an accepted change is undone. What Igor was
 * shown, the effects and the conflicts are read from the record; the approval
 * and rollback sentences restate the record's fixed terms in words.
 *
 * @param {object} changeSet  The scope's current contract.
 * @returns {HTMLElement | null}  `null` for a change set from before contracts, which records no terms.
 */
function contractTerms(changeSet) {
  if (!changeSet.contract) return null;
  const terms = element('details', 'change-terms');
  terms.append(element('summary', '', 'Terms of this change'));
  const list = element('ul');
  const { offered = [], references = [], withheld = [] } = changeSet.context || {};
  list.append(element('li', '', `Igor was shown ${plural(offered.length, 'manuscript piece')}${references.length ? ` and ${plural(references.length, 'approved reference')}` : ''}${withheld.length ? `; ${plural(withheld.length, 'piece')} in this scope ${withheld.length === 1 ? 'was' : 'were'} too long to show` : ''}.`));
  const layout = changeSet.changes.some((change) => change.kind === 'set-layout');
  list.append(element('li', '', layout
    ? 'The settings are written only when you accept them, and only if the publication profile has not changed since this suggestion.'
    : 'A piece is written only when you accept it, and only if it has not changed since this suggestion.'));
  for (const effect of changeSet.effects || []) list.append(element('li', '', effect.message));
  if (changeSet.rollback) list.append(element('li', '', layout
    ? 'An accepted change can be rolled back, restoring the previous settings exactly, for as long as the publication profile is not changed again.'
    : 'An accepted change can be rolled back, restoring the previous text exactly, for as long as the piece is not edited again.'));
  // A section's settings are filed under its folder, which may appear in more than one place in the book.
  if (changeSet.changes.some((change) => change.kind === 'set-layout' && change.level === 'section')) list.append(element('li', '', 'Section settings apply to every part of the book filed in this section’s folder.'));
  if (changeSet.conflicts?.length) {
    const pieces = new Set(changeSet.conflicts.map((conflict) => conflict.nodeId)).size;
    const what = changeSet.changes.some((change) => change.kind === 'set-layout') ? 'the same settings' : plural(pieces, 'piece');
    list.append(element('li', 'change-conflict', `Another conversation has an undecided suggestion for ${what} here. Whichever is accepted first makes the other out of date.`));
  }
  terms.append(list);
  return terms;
}

/**
 * A layout change as a list of settings, each from its current value to the
 * proposed one. A setting the target does not set itself is shown as what it
 * follows, so the author sees what an override replaces and what clearing it
 * restores.
 *
 * @param {object} change  A `set-layout` change.
 * @returns {HTMLElement}
 */
function layoutDiff(change) {
  const before = change.before || {}; const after = change.after || {};
  const inherited = change.inherited || {};
  const yesNo = (value) => (value ? 'yes' : 'no');
  // An unset value names what it follows and shows that value, as recorded when proposed.
  const follows = change.level === 'node' ? 'as its section' : 'as the book';
  const size = (override) => (override.fontSize ? `${override.fontSize} / ${override.leading}` : `${follows} (${inherited.fontSize} / ${inherited.leading})`);
  const recto = (override) => (override.opensRecto === undefined
    ? (inherited.opensRecto === undefined ? 'not set' : `not set (${yesNo(inherited.opensRecto)})`)
    : yesNo(override.opensRecto));
  const head = (override) => override.headText || (inherited.headText ? `not set (${inherited.headText})` : 'not set');
  const rows = [['Body size / leading', size], ['Opens on a recto', recto], ...(change.level === 'section' ? [['Recto running head', head]] : [])];
  const list = element('dl', 'change-layout');
  for (const [name, show] of rows) {
    const [was, will] = [show(before), show(after)];
    list.append(element('dt', '', name), element('dd', was === will ? '' : 'changed', was === will ? was : `${was} → ${will}`));
  }
  return list;
}

// Pending changes as line diffs, each with its own decision.
function changeCards(changeSet, onDecide) {
  const pending = changeSet.changes.filter((change) => change.status === 'pending');
  const box = element('section', 'changes');
  const header = element('div', 'changes-header');
  const layoutOnly = pending.every((change) => change.kind === 'set-layout');
  header.append(element('span', '', layoutOnly ? 'Suggested layout change' : `Suggested change${pending.length === 1 ? '' : 's'} · ${pending.length} piece${pending.length === 1 ? '' : 's'}`));
  if (pending.length > 1) {
    const all = element('span', 'change-actions');
    all.append(button('accept', 'Accept all', () => onDecide(null, 'accept')), button('reject', 'Reject all', () => onDecide(null, 'reject')));
    header.append(all);
  }
  const terms = contractTerms(changeSet);
  box.append(header, ...(terms ? [terms] : []), ...pending.map((change) => {
    const card = element('details', 'change-card'); card.open = true;
    const summary = element('summary');
    const layout = change.kind === 'set-layout';
    summary.append(element('strong', '', change.title), element('small', '', layout ? `${change.level === 'node' ? 'This piece' : 'This section'}’s own settings` : `manuscript/${change.relativePath}${change.lines ? ` · +${change.lines.added} −${change.lines.removed}` : ''}`));
    const actions = element('div', 'change-actions');
    actions.append(button('accept', 'Accept', () => onDecide(change.nodeId, 'accept')), button('reject', 'Reject', () => onDecide(change.nodeId, 'reject')));
    const reason = change.summary ? [element('p', 'change-summary', change.summary)] : [];
    if (layout) { card.append(summary, ...reason, layoutDiff(change), actions); return card; }
    // Each changed passage is headed by where it sits in the piece, so the author sees
    // exactly which lines an acceptance would write; everything collapsed is unchanged.
    const rows = diffRows(change.before, change.source);
    const hunks = diffHunks(collapse(rows));
    const passages = hunks.filter((entry) => entry.type === 'hunk').length;
    const diff = element('pre', 'change-diff');
    for (const entry of hunks) {
      if (entry.type === 'skip') { diff.append(element('span', 'diff-skip', `… ${plural(entry.count, 'unchanged line')}`)); continue; }
      diff.append(element('span', 'diff-hunk', entry.label));
      for (const row of entry.rows) diff.append(element('span', `diff-${row.type}`, `${{ same: '  ', add: '+ ', del: '− ' }[row.type]}${row.text || (row.type === 'same' ? '' : '(blank line)')}`));
    }
    // The diff compares text line by line, so it cannot show a change of line endings; say it in words.
    const scope = element('p', 'change-scope', `${plural(passages, 'passage')} would change; the text of every other line stays as it is.${lineEndingsDiffer(change.before, change.source, rows) ?' The piece’s line endings would also change.' : ''}`);
    card.append(summary, ...reason, scope, diff, actions);
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

/**
 * A choice or form; once answered it shows the answer and can no longer be
 * sent. What the author enters is kept as a draft as they type, so a
 * re-render (a reply arriving, a proof finishing) refills it rather than
 * discarding it. It cannot be sent while Igor replies.
 *
 * @param {object} part        The stored prompt part.
 * @param {object | undefined} answer  The recorded answer, if any.
 * @param {(promptId: string, values: object) => void} onAnswer
 * @param {Map<string, object> | undefined} drafts  Unsent values by prompt id, kept across renders.
 * @param {boolean} busy
 * @returns {HTMLFormElement}
 */
function promptCard(part, answer, onAnswer, drafts, busy) {
  const shown = answer || drafts?.get(part.promptId);
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
  const valuesOf = () => (part.type === 'choice'
    ? { selected: [...form.querySelectorAll('.prompt-option input:checked')].map((input) => input.value), ...(form.elements.namedItem('other')?.value.trim() ? { other: form.elements.namedItem('other').value.trim() } : {}) }
    : Object.fromEntries(part.fields.map((field) => { const input = form.elements.namedItem(field.id); return [field.id, field.kind === 'checkbox' ? input.checked : input.value]; })));
  form.addEventListener('input', () => drafts?.set(part.promptId, valuesOf()));
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    submit.disabled = true;
    onAnswer(part.promptId, valuesOf());
  });
  return form;
}

/**
 * The note a thread shows where changes were decided or rolled back. An
 * accepted change carries a Roll back control while its contract still records
 * it as accepted; the engine, not this control, decides whether the rollback
 * is safe.
 *
 * @param {object} turn  A `changes-decided` or `changes-reverted` system turn.
 * @param {{ contracts?: Map<string, object>, busy: boolean, onRevert?: (contractId: string, nodeId: string | null, options: { layout: boolean }) => void }} view
 * @returns {HTMLElement}
 */
function decisionNote(turn, { contracts, busy, onRevert }) {
  const note = element('div', 'msg from-system');
  const contract = contracts?.get(turn.changeSetId);
  for (const decision of turn.decisions) {
    note.append(element('span', `decision ${decision.status}`, `${decisionText[decision.status] || decision.status} · ${decision.title}`));
    // A section's layout change has no piece: both sides are null.
    const recorded = contract?.changes.find((change) => (change.nodeId ?? null) === (decision.nodeId ?? null));
    if (turn.kind !== 'changes-decided' || decision.status !== 'accepted' || recorded?.status !== 'accepted' || !onRevert) continue;
    // Named only when the recorded proof typeset this piece at exactly its accepted text.
    const layout = recorded.kind === 'set-layout';
    // A layout change is proved by a build under the profile it produced; a text change by its piece's hash.
    const typeset = layout ? contract.proof?.designHash === recorded.afterHash : contract.proof?.sourceHashes?.[decision.nodeId] === recorded.afterHash;
    if (typeset) note.append(element('span', 'decision-proof', `Typeset in a proof · ${dateAndTime(contract.proof.completedAt)}`));
    const rollBack = button('quiet-button decision-revert', 'Roll back', () => onRevert(turn.changeSetId, decision.nodeId, { layout }));
    rollBack.setAttribute('aria-label', `Roll back the accepted change to ${decision.title}`);
    rollBack.disabled = busy;
    note.append(rollBack);
  }
  return note;
}

const PASSAGE_LABELS = { ask: 'Question about', revise: 'Revise', explain: 'Explain', alternatives: 'Alternatives for', compare: 'Compare readings of' };

/**
 * The passage a message carried, exactly as the engine recorded it: the
 * action, where it is, and its text at the revision it was selected in.
 *
 * @param {{ action: string, title: string, startLine: number, endLine: number, text: string, baseHash: string }} passage
 * @returns {HTMLElement}
 */
function passageQuote(passage) {
  const figure = element('figure', 'passage-quote');
  const lines = passage.startLine === passage.endLine ? `line ${passage.startLine}` : `lines ${passage.startLine}–${passage.endLine}`;
  const caption = element('figcaption', '', `${PASSAGE_LABELS[passage.action] || passage.action} · ${lines} of “${passage.title}”`);
  if (passage.baseHash) caption.title = `Selected in revision ${passage.baseHash.slice(0, 12)}`;
  figure.append(caption, element('pre', 'passage-text', passage.text));
  return figure;
}

function message(turn, { changeSet, contracts, answers, drafts, busy, onDecide, onRevert, onAnswer, artifactUrl, afterPassage = null }) {
  if (turn.kind === 'changes-decided' || turn.kind === 'changes-reverted') return decisionNote(turn, { contracts, busy, onRevert });
  const fromUser = turn.role === 'user';
  const item = element('article', `msg ${fromUser ? 'from-user' : 'from-hermes'}${turn.kind === 'answer' ? ' is-answer' : ''}${turn.availability && turn.availability !== 'available' ? ' failed' : ''}`);
  const label = fromUser ? (turn.kind === 'answer' ? 'You · answer' : 'You') : `Igor${turn.meta?.model ? ` · ${turn.meta.model}` : ''}`;
  const meta = element('div', 'msg-meta', `${label}${turn.at ? ` · ${time(turn.at)}` : ''}`);
  if (turn.meta?.skipped?.length) meta.append(element('span', 'msg-fallback', ` · ${turn.meta.skipped.join(', ')} unavailable`));
  item.append(meta);
  const body = element('div', 'msg-body');
  if (fromUser) { if (turn.passage) body.append(passageQuote(turn.passage)); body.append(richText(turn.message)); }
  else {
    if (turn.commentary) body.append(richText(turn.commentary));
    for (const part of turn.parts || []) {
      if (part.type === 'text') { if (part.text !== turn.commentary) body.append(richText(part.text)); }
      else if (part.type === 'artifact') body.append(artifactCard(part, artifactUrl));
      else if (part.type === 'choice' || part.type === 'form') body.append(promptCard(part, answers.get(part.promptId), onAnswer, drafts, busy));
    }
  }
  item.append(body);
  if (!fromUser) {
    if (turn.graphSuggestions?.length) {
      const list = element('ul', 'msg-aside');
      for (const suggestion of turn.graphSuggestions) list.append(element('li', '', suggestion.message));
      item.append(list);
    }
    // A gateway reports what it forwarded; a reply to a passage it did not confirm may not reflect the passage.
    // A gateway's report decides when there is one (its own simulator included); without one, only Frige's
    // local simulator, which receives the passage from Frige itself, needs no confirmation.
    const reported = turn.meta?.forwardedContext;
    const unconfirmed = reported ? reported.selection !== true : turn.meta?.usage?.transport !== 'fake';
    if (afterPassage && turn.availability === 'available' && unconfirmed) {
      item.append(element('p', 'msg-aside', `Igor’s gateway did not confirm that it passed the selected passage on, so this reply may not take it into account.${afterPassage.action === 'ask' ? '' : ' Frige still allowed changes only inside the passage.'}`));
    }
    const setAside = [...(turn.droppedChanges || []), ...(turn.droppedParts || [])];
    if (setAside.length) item.append(element('p', 'msg-aside', `${setAside.length} item${setAside.length === 1 ? ' was' : 's were'} set aside: ${[...new Set(setAside.map((entry) => entry.reason))].join(' ')}`));
    if (turn.changeSetId && turn.changeSetId === changeSet?.id && changeSet.changes.some((change) => change.status === 'pending')) item.append(changeCards(changeSet, onDecide));
  }
  return item;
}

// Renders the whole thread; returns the element a new reply should scroll to.
export function renderThread(box, { turns, thinking, notice, changeSet, contracts, empty, drafts, onDecide, onRevert, onAnswer, artifactUrl }) {
  if (!turns.length && !thinking && !notice) {
    const intro = element('div', 'thread-empty');
    intro.append(element('strong', '', empty.title), element('p', '', empty.text));
    box.replaceChildren(intro); return null;
  }
  const answers = new Map(turns.filter((turn) => turn.kind === 'answer').map((turn) => [turn.promptId, turn.values]));
  // Each reply knows whether the message it answers carried a selected passage.
  let lastUser = null;
  const items = turns.map((turn) => {
    const afterPassage = turn.role === 'assistant' ? lastUser?.passage || null : null;
    if (turn.role === 'user') lastUser = turn;
    return message(turn, { changeSet, contracts, answers, drafts, busy: thinking, onDecide, onRevert, onAnswer, artifactUrl, afterPassage });
  });
  // Pending changes whose reply is no longer in view still need a decision.
  if (changeSet?.changes.some((change) => change.status === 'pending') && !turns.some((turn) => turn.changeSetId === changeSet.id)) items.push(changeCards(changeSet, onDecide));
  if (thinking) { const typing = element('article', 'msg from-hermes thinking'); typing.append(element('div', 'msg-meta', 'Igor'), element('div', 'typing', '')); typing.lastChild.append(element('i'), element('i'), element('i')); items.push(typing); }
  if (notice) items.push(element('div', 'msg from-system notice', notice));
  box.replaceChildren(...items);
  return items.at(-1);
}
