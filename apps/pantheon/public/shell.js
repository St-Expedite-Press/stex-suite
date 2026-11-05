// Masthead motion for the editorial pages; behaviour lives in motion.js.
import { startMotion } from './motion.js';

startMotion({ page: document.body, video: document.querySelector('.masthead-motion'), toggle: document.querySelector('.motion-toggle') });
