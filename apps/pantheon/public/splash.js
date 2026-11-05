// Plays the splash loop only when motion is welcome, and always lets the
// visitor stop it (WCAG 2.2.2). Without this script the still image stays.
const page = document.body;
const video = document.querySelector('.splash-motion');
const toggle = document.querySelector('.splash-motion-toggle');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const saveData = navigator.connection?.saveData === true;
const storageKey = 'stex.splash.motion';

function remembered() { try { return localStorage.getItem(storageKey); } catch { return null; } }
function remember(value) { try { localStorage.setItem(storageKey, value); } catch { /* kept in memory for this visit */ } }

// A choice made during this visit wins. A stored "off" always holds; a stored
// "on" from an earlier visit yields to a reduced-motion preference. Otherwise
// motion follows the reduced-motion and data-saver preferences.
let choice = null;
function preferred() {
  const stored = choice ?? remembered();
  if (stored === 'off') return false;
  if (stored === 'on') return choice === 'on' || !reducedMotion.matches;
  return !reducedMotion.matches && !saveData;
}
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
