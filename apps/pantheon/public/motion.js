// Shared behaviour for Pantheon's artwork loops (splash and masthead): motion
// plays only when welcome, pauses when hidden or off-screen, and the visitor
// can always stop it (WCAG 2.2.2). One stored choice covers every page.
const storageKey = 'stex.pantheon.motion';

function remembered() { try { return localStorage.getItem(storageKey); } catch { return null; } }
function remember(value) { try { localStorage.setItem(storageKey, value); } catch { /* kept in memory for this visit */ } }

export function startMotion({ page, video, toggle }) {
  if (!video || !toggle) return;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const saveData = navigator.connection?.saveData === true;

  // A choice made during this visit wins. A stored "off" always holds; a stored
  // "on" from an earlier visit yields to a reduced-motion preference. Otherwise
  // motion follows the reduced-motion and data-saver preferences.
  let choice = null;
  const preferred = () => {
    const stored = choice ?? remembered();
    if (stored === 'off') return false;
    if (stored === 'on') return choice === 'on' || !reducedMotion.matches;
    return !reducedMotion.matches && !saveData;
  };
  let wanted = preferred();
  let onScreen = true;

  async function update() {
    toggle.textContent = wanted ? 'Pause motion' : 'Play motion';
    if (!wanted || !onScreen || document.hidden) { video.pause(); return; }
    try { await video.play(); }
    catch (error) {
      // Autoplay refused (power saving, browser policy): show the honest state without storing a choice.
      if (error.name === 'NotAllowedError' && choice === null) { wanted = false; toggle.textContent = 'Play motion'; }
      if (error.name === 'NotSupportedError') toggle.hidden = true;
    }
  }

  video.addEventListener('playing', () => page.classList.add('has-motion'), { once: true });
  toggle.addEventListener('click', () => { wanted = !wanted; choice = wanted ? 'on' : 'off'; remember(choice); update(); });
  document.addEventListener('visibilitychange', update);
  reducedMotion.addEventListener('change', () => { wanted = preferred(); update(); });
  new IntersectionObserver(([entry]) => { onScreen = entry.isIntersecting; update(); }).observe(video);
  toggle.hidden = false;
  update();
}
