// The conversation thread: messages, the changes Hermes suggests shown inside the
// reply that made them, and light formatting of replies. Everything is built from
// text nodes, so nothing a model writes is ever parsed as HTML.
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

function message(turn, { changeSet, onDecide }) {
  if (turn.kind === 'changes-decided') {
    const note = element('div', 'msg from-system');
    for (const decision of turn.decisions) note.append(element('span', `decision ${decision.status}`, `${decisionText[decision.status] || decision.status} · ${decision.title}`));
    return note;
  }
  const fromUser = turn.role === 'user';
  const item = element('article', `msg ${fromUser ? 'from-user' : 'from-hermes'}`);
  const meta = element('div', 'msg-meta', `${fromUser ? 'You' : 'Hermes'}${turn.at ? ` · ${time(turn.at)}` : ''}`);
  const body = element('div', 'msg-body'); body.append(richText(fromUser ? turn.message : turn.commentary));
  item.append(meta, body);
  if (!fromUser) {
    if (turn.graphSuggestions?.length) {
      const list = element('ul', 'msg-aside');
      for (const suggestion of turn.graphSuggestions) list.append(element('li', '', suggestion.message));
      item.append(list);
    }
    if (turn.droppedChanges?.length) item.append(element('p', 'msg-aside', `${turn.droppedChanges.length} suggested change${turn.droppedChanges.length === 1 ? ' was' : 's were'} set aside: ${[...new Set(turn.droppedChanges.map((entry) => entry.reason))].join(' ')}`));
    if (turn.changeSetId && turn.changeSetId === changeSet?.id && changeSet.changes.some((change) => change.status === 'pending')) item.append(changeCards(changeSet, onDecide));
  }
  return item;
}

// Renders the whole thread; returns the element a new reply should scroll to.
export function renderThread(box, { turns, thinking, notice, changeSet, empty, onDecide }) {
  if (!turns.length && !thinking && !notice) {
    const intro = element('div', 'thread-empty');
    intro.append(element('strong', '', empty.title), element('p', '', empty.text));
    box.replaceChildren(intro); return null;
  }
  const items = turns.map((turn) => message(turn, { changeSet, onDecide }));
  // Pending changes whose reply is no longer in view still need a decision.
  if (changeSet?.changes.some((change) => change.status === 'pending') && !turns.some((turn) => turn.changeSetId === changeSet.id)) items.push(changeCards(changeSet, onDecide));
  if (thinking) { const typing = element('article', 'msg from-hermes thinking'); typing.append(element('div', 'msg-meta', 'Hermes'), element('div', 'typing', '')); typing.lastChild.append(element('i'), element('i'), element('i')); items.push(typing); }
  if (notice) items.push(element('div', 'msg from-system notice', notice));
  box.replaceChildren(...items);
  return items.at(-1);
}
