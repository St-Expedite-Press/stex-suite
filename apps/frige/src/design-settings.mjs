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

// Strict: what an author saves must be wholly valid.
export function validateDesign(input = {}) {
  const errors = []; const design = { margins: {} };
  const take = (result, assign) => (result.error ? errors.push(result.error) : assign(result.value));
  for (const [key, rule] of Object.entries(rules)) take(rule(input[key] ?? DESIGN_DEFAULTS[key]), (value) => { design[key] = value; });
  for (const side of ['top', 'bottom', 'inner', 'outer']) take(margin(side, input.margins?.[side] ?? DESIGN_DEFAULTS.margins[side]), (value) => { design.margins[side] = value; });
  if (!errors.length && points(design.leading) < points(design.fontSize)) errors.push('Leading cannot be smaller than the body size.');
  return { design: errors.length ? null : design, errors };
}

// Lenient: a stored profile with an invalid value falls back to the defaults.
export function normalizeDesign(input) { const { design } = validateDesign(input || {}); return design || validateDesign({}).design; }
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
