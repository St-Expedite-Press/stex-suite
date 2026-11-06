// The masthead loop plays only when welcome, the same rules as Pantheon's
// motion.js: it follows reduced-motion and data-saver preferences, pauses when
// the page is hidden or the art is off-screen, and the visitor can always stop
// it (WCAG 2.2.2). An explicit choice is remembered on this device.

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';

const STORAGE_KEY = 'stex.pantheon.motion';

function remembered(): string | null {
  try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
}
function remember(value: 'on' | 'off') {
  try { localStorage.setItem(STORAGE_KEY, value); } catch { /* kept for this visit only */ }
}

export type Motion = {
  /** True while motion is wanted (the control offers "Pause"). */
  wanted: boolean;
  /** True once the loop has actually started; the still shows until then. */
  playing: boolean;
  /** False when the browser cannot play the loop at all. */
  supported: boolean;
  toggle: () => void;
};

export function useMastheadMotion(video: RefObject<HTMLVideoElement | null>): Motion {
  // Read once: a fresh MediaQueryList each render would re-run the effect.
  const reduced = useMemo(() => (typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null), []);
  const saveData = useMemo(() => (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true, []);
  const choice = useRef<'on' | 'off' | null>(null);

  // A choice made this visit wins. A stored "off" always holds; a stored "on"
  // from an earlier visit yields to a reduced-motion preference.
  const preferred = useCallback(() => {
    const stored = choice.current ?? remembered();
    if (stored === 'off') return false;
    if (stored === 'on') return choice.current === 'on' || !reduced?.matches;
    return !reduced?.matches && !saveData;
  }, [reduced, saveData]);

  const [wanted, setWanted] = useState(preferred);
  const [playing, setPlaying] = useState(false);
  const [supported, setSupported] = useState(true);
  const onScreen = useRef(true);

  useEffect(() => {
    const element = video.current;
    if (!element) return;
    let current = wanted;
    const update = async () => {
      if (!current || !onScreen.current || document.hidden) { element.pause(); return; }
      try { await element.play(); }
      catch (error) {
        const name = (error as Error)?.name;
        // Autoplay refused (power saving, browser policy): show the honest state without storing a choice.
        if (name === 'NotAllowedError' && choice.current === null) { current = false; setWanted(false); }
        if (name === 'NotSupportedError') setSupported(false);
      }
    };
    const onPlaying = () => setPlaying(true);
    const onPreference = () => { current = preferred(); setWanted(current); };
    const observer = new IntersectionObserver(([entry]) => { onScreen.current = entry.isIntersecting; void update(); });
    element.addEventListener('playing', onPlaying);
    document.addEventListener('visibilitychange', update);
    reduced?.addEventListener('change', onPreference);
    observer.observe(element);
    void update();
    return () => {
      element.removeEventListener('playing', onPlaying);
      document.removeEventListener('visibilitychange', update);
      reduced?.removeEventListener('change', onPreference);
      observer.disconnect();
    };
  }, [video, wanted, preferred, reduced]);

  const toggle = useCallback(() => {
    setWanted((now) => {
      const next = !now;
      choice.current = next ? 'on' : 'off';
      remember(choice.current);
      return next;
    });
  }, []);

  return { wanted, playing, supported, toggle };
}
