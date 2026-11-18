import { createHash } from 'node:crypto';
import { TRIM_SIZES } from './lualatex.mjs';
import { escapeTeX } from './book-assembler.mjs';

// A book's publication profile. The defaults reproduce the proofs made before
// profiles existed, so a book's pagination changes only when its author changes
// a setting.
export const DESIGN_DEFAULTS = Object.freeze({
  trimSize: '6 × 9 in',
  margins: Object.freeze({ top: '0.5in', bottom: '0.5in', inner: '0.5in', outer: '0.5in' }),
  bodyFont: 'Latin Modern Roman',
  fontSize: '11pt',
  leading: '13.6pt',
  runningHeads: false,
  folios: false,
  rectoOpeners: true,
  // Verso running head; empty uses the book's title from its settings ticket or folder.
  headTitle: '',
});

const LENGTH = /^(\d+(?:\.\d+)?)\s*(in|mm|cm|pt)$/i;
const IN_POINTS = { in: 72.27, mm: 72.27 / 25.4, cm: 72.27 / 2.54, pt: 1 };
const points = (value) => { const match = LENGTH.exec(String(value).trim()); return match ? Number(match[1]) * IN_POINTS[match[2].toLowerCase()] : NaN; };
const length = (value) => { const match = LENGTH.exec(String(value ?? '').trim()); return match ? `${Number(match[1])}${match[2].toLowerCase()}` : null; };

// Each rule returns { value } when valid, or { error }.
const ok = (value) => ({ value }); const fail = (error) => ({ error });
const rules = {
  trimSize: (value) => (TRIM_SIZES.has(value) ? ok(value) : fail(`Trim size must be one of ${[...TRIM_SIZES.keys()].join(', ')}.`)),
  bodyFont: (value) => (/^[A-Za-z0-9 .-]{1,120}$/.test(String(value ?? '').trim()) ? ok(String(value).trim()) : fail('The body font name may use letters, digits, spaces, dots and hyphens.')),
  fontSize: (value) => { const size = length(value); return size?.endsWith('pt') && points(size) >= 8 && points(size) <= 18 ? ok(size) : fail('Body size must be between 8pt and 18pt.'); },
  leading: (value) => { const lead = length(value); return lead?.endsWith('pt') && points(lead) >= 8 && points(lead) <= 30 ? ok(lead) : fail('Leading must be between 8pt and 30pt.'); },
  runningHeads: (value) => (typeof value === 'boolean' ? ok(value) : fail('Running heads must be on or off.')),
  folios: (value) => (typeof value === 'boolean' ? ok(value) : fail('Folios must be on or off.')),
  rectoOpeners: (value) => (typeof value === 'boolean' ? ok(value) : fail('Recto openers must be on or off.')),
  headTitle: (value) => (typeof value === 'string' && value.trim().length <= 120 ? ok(value.trim()) : fail('The running-head title must be text of at most 120 characters.')),
};
const margin = (side, value) => { const size = length(value); const pts = size ? points(size) : NaN; return pts >= 18 && pts <= 144.6 ? ok(size) : fail(`The ${side} margin must be between 0.25in and 2in.`); };

// ---------------------------------------------------------------------------
// Overrides (program Wave 3a; decision D-012)
//
// A section or a piece may override a few settings of the book profile. The
// nearest level that sets a key wins: element, then section, then book. Page
// geometry, the body font, folios and running heads stay book-wide: a printed
// book has one page size and one apparatus.
//
// Stored in the profile as `sections: { <top-level folder>: {...} }` and
// `nodes: { <node id>: {...} }`, present only when non-empty, so a profile
// without overrides keeps the hash it had before overrides existed. Every
// value passes the same rules as the book profile; no LaTeX is accepted.
// ---------------------------------------------------------------------------

/**
 * Settings a section or a piece may override.
 *
 * - `fontSize` and `leading` are set together, so an override is always
 *   self-consistent whatever the book or section sets.
 * - `opensRecto`: a section's applies to its first piece; a piece's to itself.
 * - `headText` replaces the section's title in the recto running head.
 */
const OVERRIDE_KEYS = Object.freeze({
  section: Object.freeze(['fontSize', 'leading', 'opensRecto', 'headText']),
  node: Object.freeze(['fontSize', 'leading', 'opensRecto']),
});

/** A section is named by its top-level folder: one path segment, no control characters, at most 255 characters as file systems allow. */
const SECTION_KEY = /^(?!\.{1,2}$)[^/\\\u0000-\u001f]{1,255}$/;
/** The form of a manuscript node id, as `ProjectStore` issues them. */
const NODE_KEY = /^[a-z][a-z0-9-]{5,80}$/;

/**
 * @typedef {object} LayoutOverride
 * @property {string} [fontSize]    With `leading`; between 8pt and 18pt.
 * @property {string} [leading]     With `fontSize`; between 8pt and 30pt, not below the size.
 * @property {boolean} [opensRecto]
 * @property {string} [headText]    Sections only; at most 120 characters.
 */

/**
 * Validates one override.
 *
 * @param {'section' | 'node'} level
 * @param {unknown} input
 * @returns {{ override: LayoutOverride | null, errors: string[] }}  `override` is
 *   `null` when the input sets nothing, or when any value is invalid.
 */
function validateOverride(level, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { override: null, errors: ['An override must be an object of settings.'] };
  const errors = []; const override = {};
  for (const key of Object.keys(input)) if (!OVERRIDE_KEYS[level].includes(key)) errors.push(`${key} cannot be set for a ${level === 'node' ? 'piece' : 'section'}.`);
  // An empty field counts as not set, so filling in only one of the pair says so plainly.
  const given = (key) => Object.hasOwn(input, key) && input[key] !== '' && input[key] !== null && input[key] !== undefined;
  if (given('fontSize') !== given('leading')) errors.push('Body size and leading are set together.');
  else if (given('fontSize')) {
    for (const key of ['fontSize', 'leading']) { const result = rules[key](input[key]); if (result.error) errors.push(result.error); else override[key] = result.value; }
    if (override.fontSize && override.leading && points(override.leading) < points(override.fontSize)) errors.push('Leading cannot be smaller than the body size.');
  }
  if ('opensRecto' in input) { if (typeof input.opensRecto === 'boolean') override.opensRecto = input.opensRecto; else errors.push('Opening on a recto must be on or off.'); }
  if ('headText' in input && OVERRIDE_KEYS[level].includes('headText')) {
    const text = typeof input.headText === 'string' ? input.headText.trim() : null;
    // A line break would end the TeX argument it is set in and stop the build.
    if (text && text.length <= 120 && !/[\u0000-\u001f\u007f]/.test(text)) override.headText = text;
    else errors.push('The running-head text must be 1 to 120 characters on one line.');
  }
  return { override: errors.length || !Object.keys(override).length ? null : override, errors };
}

/**
 * Validates a map of overrides, keyed by section folder or node id, in a
 * stable key order so the profile hash does not depend on insertion order.
 *
 * @param {'section' | 'node'} level
 * @param {unknown} input
 * @param {{ lenient: boolean }} options  Lenient drops an invalid entry instead of reporting it.
 * @returns {{ overrides: Record<string, LayoutOverride>, errors: string[] }}
 */
function validateOverrides(level, input, { lenient }) {
  const overrides = {}; const errors = [];
  if (input === undefined || input === null) return { overrides, errors };
  if (typeof input !== 'object' || Array.isArray(input)) return { overrides, errors: lenient ? [] : [`${level === 'node' ? 'Piece' : 'Section'} overrides must be an object.`] };
  const pattern = level === 'node' ? NODE_KEY : SECTION_KEY;
  for (const key of Object.keys(input).sort()) {
    if (!pattern.test(key)) { if (!lenient) errors.push(`“${key}” does not name a ${level === 'node' ? 'piece' : 'section'}.`); continue; }
    const { override, errors: found } = validateOverride(level, input[key]);
    if (override) overrides[key] = override;
    else if (!lenient) errors.push(...found.map((message) => `${level === 'node' ? 'Piece' : 'Section'} “${key}”: ${message}`));
  }
  return { overrides, errors };
}

/**
 * Validates the book-level settings only.
 *
 * @param {object} input
 * @returns {{ design: object | null, errors: string[] }}
 */
function validateBook(input) {
  const errors = []; const design = { margins: {} };
  const take = (result, assign) => (result.error ? errors.push(result.error) : assign(result.value));
  for (const [key, rule] of Object.entries(rules)) take(rule(input[key] ?? DESIGN_DEFAULTS[key]), (value) => { design[key] = value; });
  for (const side of ['top', 'bottom', 'inner', 'outer']) take(margin(side, input.margins?.[side] ?? DESIGN_DEFAULTS.margins[side]), (value) => { design.margins[side] = value; });
  if (!errors.length && points(design.leading) < points(design.fontSize)) errors.push('Leading cannot be smaller than the body size.');
  return { design: errors.length ? null : design, errors };
}

/**
 * Adds non-empty override maps to a validated book profile.
 *
 * @param {object} design
 * @param {Record<string, LayoutOverride>} sections
 * @param {Record<string, LayoutOverride>} nodes
 * @returns {object}
 */
function withOverrides(design, sections, nodes) {
  return { ...design, ...(Object.keys(sections).length ? { sections } : {}), ...(Object.keys(nodes).length ? { nodes } : {}) };
}

/**
 * Strict: what an author saves must be wholly valid, overrides included.
 *
 * @param {object} [input]
 * @returns {{ design: object | null, errors: string[] }}
 */
export function validateDesign(input = {}) {
  const book = validateBook(input);
  const sections = validateOverrides('section', input.sections, { lenient: false });
  const nodes = validateOverrides('node', input.nodes, { lenient: false });
  const errors = [...book.errors, ...sections.errors, ...nodes.errors];
  return { design: errors.length ? null : withOverrides(book.design, sections.overrides, nodes.overrides), errors };
}

/**
 * Lenient: a stored profile with an invalid book value falls back to the
 * book defaults, and an invalid override is dropped on its own, so one bad
 * override never resets the rest of the profile.
 *
 * @param {object | null | undefined} input
 * @returns {object}
 */
export function normalizeDesign(input) {
  const source = input || {};
  const book = validateBook(source).design || validateBook({}).design;
  return withOverrides(book, validateOverrides('section', source.sections, { lenient: true }).overrides, validateOverrides('node', source.nodes, { lenient: true }).overrides);
}

/**
 * The settings in force for one piece, and where its type size comes from.
 *
 * @param {object} design  A profile; normalized here.
 * @param {{ sectionKey?: string | null, nodeId?: string | null }} [target]
 * @returns {{
 *   fontSize: string, leading: string, sizeFrom: 'book' | 'section' | 'element',
 *   nodeOpensRecto: boolean | undefined, sectionOpensRecto: boolean | undefined,
 *   headText: string | null,
 * }}  `opensRecto` is returned per level because whether a section's setting
 *   applies depends on whether the piece opens that section, which the caller knows.
 */
export function resolveLayout(design, { sectionKey = null, nodeId = null } = {}) {
  const profile = normalizeDesign(design);
  // Own keys only: a folder named `constructor` must not find an inherited property.
  const own = (map, key) => (key && map && Object.hasOwn(map, key) ? map[key] : undefined);
  const section = own(profile.sections, sectionKey);
  const node = own(profile.nodes, nodeId);
  const [sized, sizeFrom] = node?.fontSize ? [node, 'element'] : section?.fontSize ? [section, 'section'] : [profile, 'book'];
  return {
    fontSize: sized.fontSize, leading: sized.leading, sizeFrom,
    nodeOpensRecto: node?.opensRecto, sectionOpensRecto: section?.opensRecto,
    headText: section?.headText ?? null,
  };
}
export const designHash = (design) => createHash('sha256').update(JSON.stringify(normalizeDesign(design)), 'utf8').digest('hex').slice(0, 16);

// The book document skeleton for a profile; the body replaces %TEXGRAPH-BODY%.
// Fonts missing from the system fall back to Latin Modern and say so in the log.
export function designDocument(design, { title = '' } = {}) {
  const profile = normalizeDesign(design);
  const [width, height] = TRIM_SIZES.get(profile.trimSize);
  const { top, bottom, inner, outer } = profile.margins;
  const classSize = points(profile.fontSize) < 10.5 ? '10pt' : points(profile.fontSize) < 11.5 ? '11pt' : '12pt';
  const head = (content) => (profile.runningHeads ? `\\hfil{\\footnotesize\\scshape ${content}}\\hfil` : '\\hfil');
  const foot = profile.folios ? '\\hfil{\\footnotesize\\thepage}\\hfil' : '\\hfil';
  title = profile.headTitle || title;
  return String.raw`\documentclass[${classSize},twoside]{article}
\usepackage[paperwidth=${width},paperheight=${height},top=${top},bottom=${bottom},inner=${inner},outer=${outer}]{geometry}
\raggedbottom
\usepackage{fontspec}
\usepackage{microtype}
\IfFontExistsTF{${profile.bodyFont}}{\setmainfont{${profile.bodyFont}}}{\setmainfont{Latin Modern Roman}\typeout{TEXGRAPH-FONT-FALLBACK: ${profile.bodyFont}}}
\makeatletter
\renewcommand\normalsize{\@setfontsize\normalsize{${profile.fontSize}}{${profile.leading}}}
\def\ps@texgraph{\let\@mkboth\@gobbletwo\def\@evenhead{${head(escapeTeX(title))}}\def\@oddhead{${head('\\rightmark')}}\def\@evenfoot{${foot}}\def\@oddfoot{${foot}}}
\makeatother
\pagestyle{texgraph}
\begin{document}
\normalsize
%TEXGRAPH-BODY%
\end{document}
`;
}
