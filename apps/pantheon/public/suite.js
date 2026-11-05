import { startPantheonPalette } from './palette.js';
startPantheonPalette();

// The halftone loupe follows the pointer; one update per frame at most.
if (!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
  let frame = 0;
  window.addEventListener('pointermove', (event) => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      document.documentElement.style.setProperty('--mx', `${event.clientX}px`);
      document.documentElement.style.setProperty('--my', `${event.clientY}px`);
      frame = 0;
    });
  }, { passive: true });
}
