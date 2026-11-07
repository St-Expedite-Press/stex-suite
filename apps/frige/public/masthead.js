// Frige's masthead: the P11 loop over the P02 still, and the way back to
// Pantheon. Motion follows the same rules and the same stored choice
// (stex.pantheon.motion) as Pantheon's motion.js and Igor's masthead: it plays
// only when welcome, follows reduced-motion and data-saver preferences, pauses
// when the page is hidden or the art is off-screen, and the visitor can always
// stop it (WCAG 2.2.2). Presentation only: nothing here touches a book.
const storageKey = 'stex.pantheon.motion';

function remembered() { try { return localStorage.getItem(storageKey); } catch { return null; } }
function remember(value) { try { localStorage.setItem(storageKey, value); } catch { /* kept in memory for this visit */ } }

function startMotion({ masthead, video, toggle }) {
  if (!masthead || !video || !toggle) return;
  const verb = toggle.querySelector('.motion-verb') || toggle;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const saveData = navigator.connection?.saveData === true;

  // A choice made during this visit wins. A stored "off" always holds; a stored
  // "on" from an earlier visit yields to a reduced-motion preference.
  let choice = null;
  const preferred = () => {
    const stored = choice ?? remembered();
    if (stored === 'off') return false;
    if (stored === 'on') return choice === 'on' || !reducedMotion.matches;
    return !reducedMotion.matches && !saveData;
  };
  let wanted = preferred();
  let onScreen = true;

  const label = () => { verb.textContent = wanted ? 'Pause' : 'Play'; };
  async function update() {
    label();
    if (!wanted || !onScreen || document.hidden) { video.pause(); return; }
    try { await video.play(); }
    catch (error) {
      // Autoplay refused (power saving, browser policy): show the honest state without storing a choice.
      if (error.name === 'NotAllowedError' && choice === null) { wanted = false; label(); }
      if (error.name === 'NotSupportedError') toggle.hidden = true;
    }
  }

  // The still shows until the loop actually plays, and whenever motion is off.
  video.addEventListener('playing', () => { masthead.dataset.motion = 'playing'; });
  toggle.addEventListener('click', () => { wanted = !wanted; choice = wanted ? 'on' : 'off'; remember(choice); update(); });
  document.addEventListener('visibilitychange', update);
  reducedMotion.addEventListener('change', () => { wanted = preferred(); update(); });
  new IntersectionObserver(([entry]) => { onScreen = entry.isIntersecting; update(); }).observe(video);
  toggle.hidden = false;
  update();
}

// "‹ Pantheon" appears only when Frige runs inside the Pantheon shell: the
// server's runtime configuration names the shell's address (STEX_SHELL_URL),
// and a standalone Frige's shell address is its own root.
function showShellLink() {
  const shell = globalThis.STEX_SHELL_URL;
  const own = new URL('./', document.baseURI).pathname;
  for (const link of document.querySelectorAll('[data-shell-link]')) {
    if (!shell || new URL(shell, location.href).pathname === own) continue;
    link.href = shell; link.hidden = false;
  }
}

showShellLink();
startMotion({ masthead: document.querySelector('.masthead'), video: document.querySelector('.masthead-motion'), toggle: document.querySelector('.motion-toggle') });
