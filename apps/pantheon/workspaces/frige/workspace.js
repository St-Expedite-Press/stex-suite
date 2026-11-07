// Workstation layout below desktop width. Presentation state only: it shows
// and hides panes and never reads or changes a book.
//   >= 1024px  three columns; this module does nothing.
//   640-1023px conversation and proof side by side; Contents opens the
//              manuscript navigator as a drawer.
//   < 640px    one region at a time: Contents, Editor, or Proof.
const shell = document.querySelector('.studio-shell');
const navigatorPane = document.querySelector('#navigator');
const scrim = document.querySelector('.drawer-scrim');
const buttons = [...document.querySelectorAll('.workspace-views [data-view]')];
const contents = buttons.find((button) => button.dataset.view === 'contents');
// The panes the open drawer covers; inert keeps Tab and screen readers in the drawer.
const covered = [...document.querySelectorAll('.skip-link, .masthead, .tabs, .publishing-toolbar, .workspace-views, .conversation, .preview')];
const phone = matchMedia('(max-width: 639.98px)');
const tablet = matchMedia('(min-width: 640px) and (max-width: 1023.98px)');

function setView(view) {
  shell.dataset.view = view;
  for (const button of buttons) button.setAttribute('aria-pressed', String(button.dataset.view === view));
}

function setDrawer(open, { restoreFocus = false } = {}) {
  shell.dataset.drawer = open ? 'open' : 'closed';
  contents.setAttribute('aria-expanded', String(open));
  scrim.hidden = !open;
  for (const pane of covered) pane.inert = open;
  if (open) navigatorPane.querySelector('button, [tabindex="0"]')?.focus();
  else if (restoreFocus) contents.focus();
}

// The same buttons are view switches on phones and a drawer toggle on tablets.
function applyMode() {
  setDrawer(false);
  if (phone.matches) { contents.removeAttribute('aria-expanded'); setView(shell.dataset.view || 'editor'); }
  else { for (const button of buttons) button.removeAttribute('aria-pressed'); if (!tablet.matches) contents.removeAttribute('aria-expanded'); }
}

for (const button of buttons) {
  button.addEventListener('click', () => {
    if (phone.matches) setView(button.dataset.view);
    else if (tablet.matches && button === contents) setDrawer(shell.dataset.drawer !== 'open');
  });
}
scrim.addEventListener('click', () => setDrawer(false, { restoreFocus: true }));
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && shell.dataset.drawer === 'open') setDrawer(false, { restoreFocus: true });
  if (event.key === 'Tab' && shell.dataset.drawer === 'open') {
    const controls = [...navigatorPane.querySelectorAll('button, a[href], input, select, textarea, [tabindex="0"]')].filter((node) => !node.disabled && node.getClientRects().length);
    const first = controls[0]; const last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
});
// Choosing a piece, section, or the whole book moves on to it: the drawer
// closes, and a phone shows the editor.
document.querySelector('#book-tree').addEventListener('click', (event) => {
  if (!event.target.closest('button') || event.target.closest('.tree-toggle')) return;
  if (tablet.matches) setDrawer(false);
  if (phone.matches) setView('editor');
});
// "Show pages in proof" is a request to see the proof.
document.querySelector('#node-pages').addEventListener('click', () => { if (phone.matches) setView('proof'); });
// On a phone the skip link's target may be in a hidden view; show the editor first.
document.querySelector('.skip-link')?.addEventListener('click', () => { if (phone.matches) setView('editor'); });
phone.addEventListener('change', applyMode);
tablet.addEventListener('change', applyMode);
applyMode();
