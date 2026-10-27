const surfaces = { s0: '#030303', s1: '#0a0a0b', s2: '#111113', s3: '#1a1a1d', s4: '#25252a' };
const schemes = [
  { id: 'acid', t1: '#f4f4f1', t2: '#a8a8a3', signal: '#d7ff3a', signal2: '#ff2e88', ink: '#0b0d00', bad: '#ff4d5e' },
  { id: 'riso', t1: '#f6f2f6', t2: '#aca5ad', signal: '#ff48b0', signal2: '#00e5ff', ink: '#14000b', bad: '#ff6a3d' },
  { id: 'ultraviolet', t1: '#f3f1ff', t2: '#a7a4b8', signal: '#8b5cff', signal2: '#b6ff3a', ink: '#08031a', bad: '#ff4d6d' },
  { id: 'ink', t1: '#f4efe6', t2: '#ada79c', signal: '#ff3b1f', signal2: '#ff8a3d', ink: '#140200', bad: '#ff5c9a' },
];
const hex = (value) => value.match(/[a-f\d]{2}/gi).map((part) => parseInt(part, 16));
const mix = (a, b, ratio) => `#${hex(a).map((part, index) => Math.round(part + (hex(b)[index] - part) * ratio).toString(16).padStart(2, '0')).join('')}`;
const ease = (value) => value < .5 ? 2 * value * value : 1 - ((-2 * value + 2) ** 2) / 2;
export function startScreenlabPalette(root = document.documentElement) {
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const apply = () => {
    const hold = 240_000, morph = 120_000, segment = hold + morph, elapsed = Date.now() % (segment * schemes.length);
    const index = Math.floor(elapsed / segment), inSegment = elapsed - index * segment, next = schemes[(index + 1) % schemes.length];
    const ratio = reduced || inSegment <= hold ? 0 : ease((inSegment - hold) / morph), current = schemes[index];
    const token = (key) => ratio ? mix(current[key], next[key], ratio) : current[key];
    Object.entries(surfaces).forEach(([key, value]) => root.style.setProperty(`--${key}`, value));
    root.style.setProperty('--t1', token('t1')); root.style.setProperty('--t2', token('t2')); root.style.setProperty('--signal', token('signal')); root.style.setProperty('--signal-2', token('signal2')); root.style.setProperty('--signal-ink', token('ink')); root.style.setProperty('--bad', token('bad'));
    root.dataset.palette = ratio > .5 ? next.id : current.id;
  };
  apply(); if (!reduced) setInterval(apply, 1_000);
}
