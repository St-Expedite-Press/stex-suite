// The home Igor box is the entry composer for Igor (stex.igor.conversations.v1,
// protocol/igor). A submission creates a conversation and navigates to it at
// once; Igor's own page shows the pending reply. Without JavaScript the form
// does nothing, so it starts disabled.
const form = document.querySelector('.igor-form');
const input = form?.querySelector('.igor-input');
const send = form?.querySelector('.igor-send');
const log = document.querySelector('.igor-log');

// One key per submission. Retrying the same text after a failure reuses it, so
// a request that did reach Igor returns the same conversation instead of a second one.
let submission = null;
function keyFor(message) {
  if (submission?.message !== message) {
    const key = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('');
    submission = { message, key };
  }
  return submission.key;
}

function showError(text) {
  const item = document.createElement('li');
  item.className = 'igor-entry igor-entry--status';
  const who = document.createElement('span');
  who.className = 'igor-who';
  who.textContent = 'Igor could not open a conversation';
  const body = document.createElement('p');
  body.textContent = text;
  item.append(who, body);
  log.replaceChildren(item);
}

if (form) {
  input.disabled = false;
  send.disabled = false;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const message = input.value.trim();
    if (!message) { input.focus(); return; }
    send.disabled = true;
    try {
      const response = await fetch('/igor/api/conversations', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ idempotencyKey: keyFor(message), message }) });
      const result = await response.json().catch(() => null);
      if ((response.status === 200 || response.status === 201) && typeof result?.route === 'string' && result.route.startsWith('/igor/c/')) {
        location.assign(result.route);
        return;
      }
      showError(result?.error || 'Igor is not available right now.');
    } catch {
      showError('Igor could not be reached. Try again.');
    }
    send.disabled = false;
    input.focus();
  });
}
