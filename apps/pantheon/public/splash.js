/** Pantheon browser source that links the entrance controls to motion preferences and local navigation. */
// Splash motion; behaviour lives in motion.js. Without this script the still stays.
import { startMotion } from './motion.js';

startMotion({ page: document.body, video: document.querySelector('.splash-motion'), toggle: document.querySelector('.splash-motion-toggle') });
