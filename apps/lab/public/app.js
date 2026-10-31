import { startScreenlabPalette } from './palette.js';

startScreenlabPalette();

const $ = (selector) => document.querySelector(selector);
const answers = {};
const transcript = [];
let step = -1;
const studioUrl = (id) => `http://127.0.0.1:4310/?book=${encodeURIComponent(id)}`;
const interview = [
  ['title', 'What is the working title of this book?', 'A working title is enough.'],
  ['author', 'Whose name belongs on the title page?', 'An author, editor, collective, or imprint is fine.'],
  ['editorialIntent', 'What form is it taking for a reader?', 'poetry collection'],
  ['bookType', 'What is the book form?', 'poetry-collection'],
];

async function api(path, options = {}) {
  const response = await fetch(path, { headers: { 'content-type': 'application/json' }, ...options });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Request failed.');
  return result;
}

function openVaultStudio(id) { location.assign(studioUrl(id)); }

function addMessage(role, message) {
  transcript.push({ role, message, at: new Date().toISOString() });
  const item = $('#message-template').content.firstElementChild.cloneNode(true);
  item.classList.add(role);
  item.querySelector('.chat-role').textContent = role === 'assistant' ? 'TexGraph' : 'You';
  item.querySelector('.chat-text').textContent = message;
  $('#chat').append(item);
  $('#chat').scrollTop = $('#chat').scrollHeight;
}

function askNext() {
  step += 1;
  while (interview[step] && answers[interview[step][0]]) step += 1;
  const current = interview[step];
  if (!current) return finishInterview();
  addMessage('assistant', current[1]);
  $('#answer-hint').textContent = current[2];
  $('#interview-answer').value = '';
  $('#interview-answer').focus();
}

function ticket() {
  return {
    title: answers.title,
    author: answers.author || 'Author',
    editorialIntent: answers.editorialIntent || '',
    sourceMode: 'start-blank',
    bookType: answers.bookType || 'poetry-collection',
    podProfile: 'cross-pod', trimSize: '6 × 9 in', interiorInk: 'black-white', paperStock: 'white', bleed: 'no-bleed', margins: '0.5 in', isbnPlan: 'unassigned', proofPlan: 'order-proof', coverFinish: 'matte',
  };
}

function finishInterview() {
  $('#interview-composer').classList.add('hidden');
  const draft = ticket();
  addMessage('assistant', `I have a workable starting ticket for “${draft.title}.” You can create the book now and continue inside Obsidian.`);
  const panel = $('#ticket');
  panel.classList.remove('hidden');
  panel.innerHTML = '<p class="eyebrow">Book starting point</p><h2></h2><p></p><div class="ticket-actions"><button class="accept-ticket">Create book studio →</button><button class="restart-ticket quiet-button">Start over</button></div>';
  panel.querySelector('h2').textContent = draft.title;
  panel.querySelector('p:not(.eyebrow)').textContent = draft.editorialIntent || 'A new manuscript.';
  panel.querySelector('.accept-ticket').addEventListener('click', async () => {
    const button = panel.querySelector('.accept-ticket');
    button.disabled = true;
    button.textContent = 'Opening studio…';
    try { openVaultStudio((await api('/api/books', { method: 'POST', body: JSON.stringify({ ticket: draft, transcript }) })).id); }
    catch (error) { button.disabled = false; button.textContent = 'Create book studio →'; alert(error.message); }
  });
  panel.querySelector('.restart-ticket').addEventListener('click', beginInterview);
}

function beginInterview(initialMessage = '') {
  Object.keys(answers).forEach((key) => delete answers[key]);
  transcript.length = 0;
  step = -1;
  $('#interview-empty').classList.add('hidden');
  $('#chat').replaceChildren();
  $('#chat').classList.remove('hidden');
  $('#ticket').classList.add('hidden');
  $('#interview-composer').classList.remove('hidden');
  $('#interview-state').textContent = 'Conversation';
  if (initialMessage) {
    answers.editorialIntent = initialMessage;
    addMessage('user', initialMessage);
    addMessage('assistant', 'That is a strong beginning. I will hold onto it while we find the title and form.');
  } else {
    addMessage('assistant', 'Start anywhere. A title, a line, an image, or a worry about the book is enough.');
  }
  askNext();
}

async function loadBooks() {
  const books = await api('/api/books');
  const list = $('#book-list');
  if (!books.length) { list.textContent = 'No books yet. Begin with a message on the right.'; return; }
  list.replaceChildren(...books.map((book) => {
    const card = document.createElement('article');
    card.className = 'book-card';
    card.innerHTML = '<div><p class="book-state"></p><h3></h3><p class="book-description"></p><small></small></div><button class="open-book" type="button">Enter vault studio →</button>';
    card.querySelector('.book-state').textContent = book.state === 'manuscript-detected' ? 'Manuscript detected' : 'TexGraph vault';
    card.querySelector('h3').textContent = book.title;
    card.querySelector('.book-description').textContent = book.description;
    card.querySelector('small').textContent = `${book.manuscriptNodes} manuscript nodes${book.programme ? ' · Programme found' : ''}`;
    const button = card.querySelector('.open-book');
    button.addEventListener('click', async () => {
      button.disabled = true;
      button.textContent = 'Opening studio…';
      openVaultStudio(book.id);
    });
    return card;
  }));
}

$('#new-book').addEventListener('click', () => $('#starter-answer').focus());
$('#starter-composer').addEventListener('submit', (event) => {
  event.preventDefault();
  const value = $('#starter-answer').value.trim();
  if (value) beginInterview(value);
});
document.querySelectorAll('[data-starter]').forEach((button) => button.addEventListener('click', () => {
  $('#starter-answer').value = button.dataset.starter;
  $('#starter-answer').focus();
}));
$('#interview-composer').addEventListener('submit', (event) => {
  event.preventDefault();
  const value = $('#interview-answer').value.trim();
  if (!value) return;
  const current = interview[step];
  answers[current[0]] = value;
  addMessage('user', value);
  askNext();
});

loadBooks().catch((error) => { $('#book-list').textContent = error.message; });
