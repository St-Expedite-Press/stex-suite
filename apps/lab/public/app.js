import { startScreenlabPalette } from './palette.js';
startScreenlabPalette();
const $ = (selector) => document.querySelector(selector);
const answers = {}; const transcript = []; let step = -1; let selectedBook = null; let bookIndex = new Map();
const studioUrl = (id) => `http://127.0.0.1:4310/?book=${encodeURIComponent(id)}`;

const interview = [
  { id: 'title', question: 'What is the working title of this book?', hint: 'A working title is enough; it can change later.' },
  { id: 'author', question: 'Whose name should appear on the title page?', hint: 'Use an author, editor, collective, or imprint name.' },
  { id: 'editorialIntent', question: 'What is the book trying to do for a reader?', hint: 'A few sentences about its artistic or intellectual pressure is perfect.' },
  { id: 'sourceMode', question: 'Where is the manuscript starting from?', hint: 'This determines whether TexGraph creates a blank Programme or prepares to map existing Markdown.', choices: [['start-blank', 'A new manuscript', 'Create a clean manuscript structure and Programme.'], ['existing-markdown', 'Existing Markdown', 'Prepare the vault to map a manuscript like Lift Wind/Love Heat.'], ['mixed-material', 'Fragments and source material', 'Create a project for building a sequence from mixed notes and drafts.']] },
  { id: 'bookType', question: 'What form does the book want to take?', hint: 'This is an editorial starting point, not a genre constraint.', choices: [['poetry-collection', 'Poetry collection', 'Sequence, movement, cycle, poem, and apparatus are all available.'], ['chapbook', 'Chapbook', 'A shorter lyric object with deliberate material presence.'], ['anthology', 'Anthology or archive', 'A larger sequence with room for notes and editorial apparatus.'], ['hybrid', 'Hybrid book', 'A book that crosses poem, essay, document, or image.']] },
  { id: 'route', question: 'Where should the first physical edition travel?', hint: 'Choose the initial production route; the ticket leaves room to revise it.', choices: [['cross-pod', 'Amazon and wide distribution', 'A portable interior brief for Amazon and other POD services.'], ['amazon-kdp', 'Amazon KDP first', 'A KDP-first paperback brief.'], ['ingramspark', 'Bookstores and libraries', 'An IngramSpark-first brief.'], ['lulu', 'Directly to readers', 'A Lulu Direct-first brief.']] },
  { id: 'object', question: 'How should the book feel in a reader’s hand?', hint: 'TexGraph proposes a trim and an initial page target from this answer.', choices: [['intimate', 'Small and intimate', 'A compact lyric object.'], ['trade', 'A standard trade book', 'A familiar, bookstore-facing collection.'], ['substantial', 'Large or archival', 'More room for longer sequences and apparatus.']] },
  { id: 'interior', question: 'What happens on the interior pages?', hint: 'Choose the dominant condition; exceptions can be marked at the node level later.', choices: [['text', 'Mostly text and lineation', 'Black-and-white, no-bleed starting point.'], ['color', 'Color art within the page', 'Standard-color interior with safe margins.'], ['bleed', 'Artwork meets the edge', 'Full-bleed requirement recorded for final printer-specific export.']] },
  { id: 'proof', question: 'How should you approve the physical object?', hint: 'You can always revise this before production.', choices: [['physical', 'Mark up a physical proof', 'Adds a proof milestone to the ticket.'], ['digital', 'Use digital preflight first', 'Start with the printer’s preview and decide on a proof later.']] },
];

async function api(path, options = {}) { const response = await fetch(path, { headers: { 'content-type': 'application/json' }, ...options }); const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Request failed.'); return result; }
function setState(value) { $('#interview-state').textContent = value; }
function pretty(value) { return String(value || '—').replaceAll('-', ' '); }
function addMessage(role, message) { transcript.push({ role, message, at: new Date().toISOString() }); const node = $('#message-template').content.firstElementChild.cloneNode(true); node.classList.add(role); node.querySelector('.chat-role').textContent = role === 'assistant' ? 'TexGraph' : 'You'; node.querySelector('.chat-text').textContent = message; $('#chat').append(node); $('#chat').scrollTop = $('#chat').scrollHeight; }

function nextQuestion() {
  step += 1; const current = interview[step]; if (!current) return finishInterview();
  addMessage('assistant', current.question); $('#answer-hint').textContent = current.hint;
  const composer = $('#interview-composer'); const input = $('#interview-answer'); composer.classList.remove('hidden'); input.value = ''; composer.querySelector('.answer-choices')?.remove();
  if (!current.choices) { input.hidden = false; input.focus(); return; }
  input.hidden = true; const choices = document.createElement('div'); choices.className = 'answer-choices';
  choices.replaceChildren(...current.choices.map(([value, title, detail]) => { const button = document.createElement('button'); button.type = 'button'; button.className = 'answer-choice'; button.innerHTML = '<strong></strong><span></span>'; button.querySelector('strong').textContent = title; button.querySelector('span').textContent = detail; button.addEventListener('click', () => answer(value, title)); return button; }));
  composer.prepend(choices);
}

function answer(value, display) { const current = interview[step]; if (!value.trim()) return; answers[current.id] = value.trim(); addMessage('user', display || value.trim()); nextQuestion(); }

function proposedTicket() {
  const route = { 'cross-pod': { podProfile: 'cross-pod', trimSize: '6 × 9 in', paperStock: 'white', isbnPlan: 'own-isbn' }, 'amazon-kdp': { podProfile: 'amazon-kdp', trimSize: '5.5 × 8.5 in', paperStock: 'cream', isbnPlan: 'platform-isbn' }, ingramspark: { podProfile: 'ingramspark', trimSize: '6 × 9 in', paperStock: 'white', isbnPlan: 'own-isbn' }, lulu: { podProfile: 'lulu', trimSize: '6 × 9 in', paperStock: 'white', isbnPlan: 'own-isbn' } }[answers.route];
  const object = { intimate: { trimSize: '5.5 × 8.5 in', pageCountGoal: '48' }, trade: { trimSize: route.trimSize, pageCountGoal: '72' }, substantial: { trimSize: '6 × 9 in', pageCountGoal: '120' } }[answers.object];
  const interior = { text: { interiorInk: 'black-white', bleed: 'no-bleed' }, color: { interiorInk: 'standard-color', bleed: 'no-bleed' }, bleed: { interiorInk: 'standard-color', bleed: 'full-bleed' } }[answers.interior];
  return { title: answers.title, author: answers.author, editorialIntent: answers.editorialIntent, sourceMode: answers.sourceMode, bookType: answers.bookType, ...route, ...object, ...interior, margins: '0.5 in', proofPlan: answers.proof === 'physical' ? 'order-proof' : 'digital-preflight', coverFinish: 'matte' };
}

function finishInterview() {
  $('#interview-composer').classList.add('hidden'); const ticket = proposedTicket(); addMessage('assistant', `I’ve drafted a Global Settings Ticket for “${ticket.title}.” Review it, then create the project vault when it feels right.`);
  const node = $('#ticket'); node.classList.remove('hidden'); const rows = [['Book', ticket.title], ['Author', ticket.author], ['Manuscript', pretty(ticket.sourceMode)], ['Form', pretty(ticket.bookType)], ['Route', pretty(ticket.podProfile)], ['Trim', ticket.trimSize], ['Interior', `${pretty(ticket.interiorInk)} · ${pretty(ticket.bleed)}`], ['Proof', pretty(ticket.proofPlan)]];
  node.innerHTML = '<p class="eyebrow">Draft global settings ticket</p><h2></h2><dl></dl><p class="ticket-intent"></p><div class="ticket-actions"><button class="accept-ticket" type="button">Accept & create project vault →</button><button class="restart-ticket quiet-button" type="button">Start over</button></div>';
  node.querySelector('h2').textContent = ticket.title; node.querySelector('.ticket-intent').textContent = ticket.editorialIntent;
  node.querySelector('dl').replaceChildren(...rows.map(([term, detail]) => { const fragment = document.createDocumentFragment(); const dt = document.createElement('dt'); dt.textContent = term; const dd = document.createElement('dd'); dd.textContent = detail; fragment.append(dt, dd); return fragment; }));
  node.querySelector('.accept-ticket').addEventListener('click', () => createBook(ticket)); node.querySelector('.restart-ticket').addEventListener('click', beginInterview); setState('Ticket ready');
}

async function createBook(ticket) { const button = $('.accept-ticket'); button.disabled = true; button.textContent = 'Creating vault…'; try { const created = await api('/api/books', { method: 'POST', body: JSON.stringify({ ticket, transcript }) }); addMessage('assistant', `Created the project vault for “${created.title}.” Its Programme, settings ticket, manuscript, notes, compiled deliverables, and private TexGraph state are ready for the next mapping step.`); setState('Vault created'); await loadBooks(); selectBook(created.id); } catch (error) { button.disabled = false; button.textContent = 'Accept & create project vault →'; window.alert(error.message); } }

function beginInterview() { Object.keys(answers).forEach((key) => delete answers[key]); transcript.length = 0; step = -1; $('#interview-empty').classList.add('hidden'); $('#chat').replaceChildren(); $('#chat').classList.remove('hidden'); $('#ticket').classList.add('hidden'); setState('Interviewing'); addMessage('assistant', 'We’ll make the book’s editorial and production assumptions explicit, then you can accept or restart the ticket. Nothing is created until you accept it.'); nextQuestion(); }

function selectBook(id) {
  document.querySelectorAll('.book-card').forEach((card) => card.classList.toggle('selected', card.dataset.id === id)); const selected = document.querySelector(`.book-card[data-id="${id}"]`); if (!selected) return; const title = selected.querySelector('h3').textContent; setState('Book selected');
  selectedBook = bookIndex.get(id) || { id, title }; $('#source-pack').classList.remove('hidden'); $('#source-pack-title').textContent = `${title} source pack`; $('#upload-status').textContent = 'No documents selected.'; $('#documents').value = ''; $('#upload-documents').disabled = true; loadDocuments(id).catch((error) => { $('#upload-status').textContent = error.message; });
  if ($('#interview-empty').classList.contains('hidden')) return;
  $('#interview-empty').innerHTML = `<span class="empty-glyph">✓</span><h2>${title} is selected.</h2><p>This lobby has preserved its manuscript tree. The next TexGraph build will map its Programme, node types, print rules, and source/editorial boundaries before opening the composition surface.</p><button id="start-interview" type="button">Create another book →</button>`;
  const open = document.createElement('a'); open.className = 'open-studio'; open.href = studioUrl(id); open.textContent = 'Open TexGraph Studio →'; $('#interview-empty').insertBefore(open, $('#start-interview'));
  $('#start-interview').addEventListener('click', beginInterview);
}

async function loadBooks() {
  const records = await api('/api/books'); bookIndex = new Map(records.map((book) => [book.id, book])); const list = $('#book-list'); if (!records.length) { list.textContent = 'No books yet. Begin the interview to create one.'; return; }
  list.replaceChildren(...records.map((book) => { const card = document.createElement('article'); card.className = 'book-card'; card.dataset.id = book.id; card.innerHTML = '<div><p class="book-state"></p><h3></h3><p class="book-description"></p><small></small></div><button type="button">Select</button>'; card.querySelector('.book-state').textContent = book.state === 'manuscript-detected' ? 'Manuscript detected' : book.state === 'configured' ? 'TexGraph vault' : 'Project folder'; card.querySelector('h3').textContent = book.title; card.querySelector('.book-description').textContent = book.description; card.querySelector('small').textContent = `${book.manuscriptNodes} manuscript nodes${book.programme ? ' · Programme found' : ''}${book.settingsTicket ? ' · Ticket accepted' : ''}`; card.querySelector('button').addEventListener('click', () => selectBook(book.id)); return card; }));
}

function renderDocuments(records) {
  const list = $('#document-list');
  if (!records.length) { list.replaceChildren(); return; }
  list.replaceChildren(...records.map((record) => { const item = document.createElement('li'); item.textContent = `${record.name} · ${record.contextState === 'ready' ? 'ready for model context' : 'awaiting text extraction'}`; return item; }));
}

async function loadDocuments(id) { renderDocuments(await api(`/api/books/${encodeURIComponent(id)}/documents`)); }

async function uploadDocuments() {
  if (!selectedBook) return;
  const files = [...$('#documents').files]; if (!files.length) return;
  const button = $('#upload-documents'); button.disabled = true; $('#upload-status').textContent = 'Uploading…';
  try {
    const documents = await Promise.all(files.map(async (file) => ({ name: file.name, mimeType: file.type || 'application/octet-stream', contentBase64: (await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onerror = reject; reader.onload = () => resolve(String(reader.result).split(',', 2)[1]); reader.readAsDataURL(file); })) })));
    const created = await api(`/api/books/${encodeURIComponent(selectedBook.id)}/documents`, { method: 'POST', body: JSON.stringify({ documents }) });
    $('#upload-status').textContent = `${created.length} document${created.length === 1 ? '' : 's'} added.`; $('#documents').value = ''; await loadDocuments(selectedBook.id);
  } catch (error) { $('#upload-status').textContent = error.message; } finally { button.disabled = !$('#documents').files.length; }
}

$('#start-interview').addEventListener('click', beginInterview); $('#new-book').addEventListener('click', beginInterview); $('#interview-composer').addEventListener('submit', (event) => { event.preventDefault(); answer($('#interview-answer').value); });
$('#documents').addEventListener('change', () => { const count = $('#documents').files.length; $('#upload-documents').disabled = !count; $('#upload-status').textContent = count ? `${count} document${count === 1 ? '' : 's'} selected.` : 'No documents selected.'; });
$('#upload-documents').addEventListener('click', uploadDocuments);
loadBooks().catch((error) => { $('#book-list').textContent = error.message; });
