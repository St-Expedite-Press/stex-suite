import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const packageDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tokensCss = await readFile(path.join(packageDirectory, 'src', 'tokens.css'), 'utf8');
const fontsCss = await readFile(path.join(packageDirectory, 'src', 'fonts.css'), 'utf8');

const declarations = (block) => Object.fromEntries([...block.matchAll(/--(stex-[a-z0-9-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]));
const root = declarations(/:root\s*\{([\s\S]*?)\n\}/.exec(tokensCss)[1]);
const scopes = Object.fromEntries([...tokensCss.matchAll(/\[data-stex-app="([a-z]+)"\]\s*\{([^}]*)\}/g)].map(([, app, block]) => [app, declarations(block)]));

function resolve(name, scope = {}) {
  const value = scope[name] ?? root[name];
  assert.ok(value, `--${name} is not defined`);
  const reference = /^var\(--(stex-[a-z0-9-]+)\)$/.exec(value);
  return reference ? resolve(reference[1], scope) : value;
}

const channels = (hex) => hex.match(/[0-9a-f]{2}/gi).map((part) => parseInt(part, 16) / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
const luminance = (hex) => { const [r, g, b] = channels(hex); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
function lab(hex) {
  const [r, g, b] = channels(hex);
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const [x, y, z] = [(r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047, r * 0.2126 + g * 0.7152 + b * 0.0722, (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883].map(f);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
const deltaE = (a, b) => Math.hypot(...lab(a).map((value, index) => value - lab(b)[index]));

const surfaces = ['stex-bg', 'stex-surface', 'stex-surface-raised', 'stex-surface-hover'];
const applications = ['pantheon', 'frige', 'seaxneat', 'eostre', 'woden'];

test('palette matches Design Doctrine v1.1 exactly', () => {
  const doctrine = {
    'abyssal-ink': '#0B1518', 'cabinet-black': '#111D20', 'raised-slate': '#19272B', 'mineral-slate': '#25353A', 'engraving-slate': '#4D6268',
    'primary-parchment': '#F0E2C8', 'secondary-text': '#BFC8C2', 'muted-text': '#9FA9A5', 'warm-vellum': '#DBC39B', 'antique-ochre': '#BA9866', 'oxidized-copper': '#76503D',
    'dusty-garnet': '#C58F96', azurite: '#8CAEC4', 'burnished-amber': '#D69B65', juniper: '#A9B998',
  };
  for (const [name, value] of Object.entries(doctrine)) assert.equal(root[`stex-${name}`], value, `--stex-${name}`);
});

test('each application scope sets its signature accent', () => {
  assert.deepEqual(Object.fromEntries(applications.map((app) => [app, resolve('stex-accent', scopes[app])])),
    { pantheon: '#BA9866', frige: '#C58F96', seaxneat: '#8CAEC4', eostre: '#D69B65', woden: '#A9B998' });
});

test('text, actions, accents, and status colours reach WCAG AA (4.5:1) on every surface', () => {
  const text = ['stex-text', 'stex-text-secondary', 'stex-text-muted', 'stex-action', 'stex-success', 'stex-warning', 'stex-error', 'stex-info'];
  for (const app of applications) {
    for (const surface of surfaces) {
      for (const role of [...text, 'stex-accent']) {
        const ratio = contrast(resolve(role, scopes[app]), resolve(surface));
        assert.ok(ratio >= 4.5, `${app}: --${role} on --${surface} is ${ratio.toFixed(2)}:1`);
      }
    }
  }
  assert.ok(contrast(resolve('stex-action-text'), resolve('stex-action')) >= 4.5, 'primary button label');
  assert.ok(contrast(resolve('stex-action-text'), resolve('stex-action-hover')) >= 4.5, 'primary button hover label');
});

test('control borders, frames, and focus reach 3:1; decoration-only colours are not used for them', () => {
  for (const app of applications) {
    for (const role of ['stex-border-control', 'stex-frame', 'stex-focus']) {
      for (const surface of surfaces) {
        const ratio = contrast(resolve(role, scopes[app]), resolve(surface));
        assert.ok(ratio >= 3, `${app}: --${role} on --${surface} is ${ratio.toFixed(2)}:1`);
      }
    }
  }
  for (const decorative of ['stex-engraving-slate', 'stex-oxidized-copper']) {
    assert.ok(surfaces.every((surface) => contrast(resolve(decorative), resolve(surface)) < 3), `${decorative} is expected to be decoration-only`);
  }
});

test('status colours stay distinct from every studio accent and from each other', () => {
  const accents = ['stex-antique-ochre', 'stex-dusty-garnet', 'stex-azurite', 'stex-burnished-amber', 'stex-juniper', 'stex-warm-vellum'].map((name) => resolve(name));
  const statuses = ['stex-success', 'stex-warning', 'stex-error', 'stex-info'].map((name) => resolve(name));
  for (const status of statuses) for (const accent of accents) assert.ok(deltaE(status, accent) >= 20, `${status} vs ${accent}: ${deltaE(status, accent).toFixed(1)}`);
  for (const [index, status] of statuses.entries()) for (const other of statuses.slice(index + 1)) assert.ok(deltaE(status, other) >= 20, `${status} vs ${other}`);
});

test('base styles cannot leak into application content', async () => {
  const baseCss = (await readFile(path.join(packageDirectory, 'src', 'base.css'), 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(baseCss, /!important/, 'base.css must not force values over application styles');
  assert.doesNotMatch(baseCss, /@media/, 'base.css must not carry global motion or responsive overrides');
  for (const [, selector] of baseCss.matchAll(/([^{}]+)\{/g)) {
    assert.match(selector.trim(), /^:where\(\[data-stex-app\]\)|^:where\(html\[data-stex-app\]\)/, `unscoped base selector: ${selector.trim()}`);
  }
});

test('focus follows the accent of a nested studio scope', () => {
  assert.match(tokensCss, /\[data-stex-app\]\s*\{\s*--stex-focus:\s*var\(--stex-accent\);\s*\}/);
});

test('every font file exists and every family covers Ē (U+0112) for Ēostre', async () => {
  for (const [, file] of fontsCss.matchAll(/url\("\.\.\/(fonts\/[^"]+)"\)/g)) await access(path.join(packageDirectory, file));
  for (const family of ['Cormorant Garamond', 'EB Garamond', 'Inter', 'IBM Plex Mono']) {
    const faces = [...fontsCss.matchAll(/@font-face\s*\{([^}]*)\}/g)].map(([, body]) => body).filter((body) => body.includes(`font-family: "${family}"`));
    const covers = faces.some((body) => /U\+0100-02BA/.test(body));
    assert.ok(covers, `${family} has no face covering U+0112`);
  }
});
