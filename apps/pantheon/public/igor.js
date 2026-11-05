// Igor's Ask box. Turns go to Pantheon's /api/igor/turn, which relays them to
// the inference service; nothing is stored. Every reply says whether it was
// simulated. Without JavaScript the form does nothing, so it starts disabled.
const form = document.querySelector('.igor-form');
const input = form?.querySelector('.igor-input');
const send = form?.querySelector('.igor-send');
const log = document.querySelector('.igor-log');
// Mirrors the server's limits (src/igor.mjs) so a long chat never outgrows a request.
const HISTORY_MESSAGES = 10;
const MESSAGE_CHARS = 2000;
const history = [];
function remember(role, content) {
  history.push({ role, content: content.slice(0, MESSAGE_CHARS) });
  history.splice(0, Math.max(0, history.length - HISTORY_MESSAGES));
}

function entry(role, text, note) {
  const item = document.createElement('li');
  item.className = `igor-entry igor-entry--${role}`;
  const who = document.createElement('span');
  who.className = 'igor-who';
  who.textContent = role === 'user' ? 'You' : role === 'assistant' ? 'Igor' : 'Igor could not answer';
  const body = document.createElement('p');
  body.textContent = text;
  item.append(who, body);
  if (note) { const meta = document.createElement('span'); meta.className = 'stex-meta'; meta.textContent = note; item.append(meta); }
  log.append(item);
  item.scrollIntoView({ block: 'nearest' });
}

if (form) {
  input.disabled = false;
  send.disabled = false;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const message = input.value.trim();
    if (!message) { input.focus(); return; }
    entry('user', message);
    input.value = '';
    send.disabled = true;
    try {
      const response = await fetch('/api/igor/turn', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message, history }) });
      const result = await response.json();
      if (!response.ok) { entry('status', result.error || 'Igor could not answer.'); return; }
      entry('assistant', result.reply, result.transport === 'fake' ? 'Simulated reply · fake transport' : 'Reply from Igor');
      remember('user', message);
      remember('assistant', result.reply);
    } catch {
      entry('status', 'Pantheon could not be reached.');
    } finally {
      send.disabled = false;
      input.focus();
    }
  });
}
