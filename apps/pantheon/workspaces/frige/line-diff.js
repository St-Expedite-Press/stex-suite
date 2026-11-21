// Line-level difference used to review proposed manuscript changes.
//
// Rows are { type: 'same' | 'add' | 'del', text, left?, right? }: `left` is the
// row's 1-based line number in the current text (same and del rows) and
// `right` its number in the proposed text (same and add rows). Unchanged runs
// further than `context` lines from a change collapse to { type: 'skip', count }.
//
// Lines shared at the start and the end are matched first, so a localized edit
// to a long piece costs only the size of the edited region. A region still too
// large for the longest common subsequence (over four million line pairs; for
// example, edits near both ends of a long piece) is split at lines that occur
// exactly once on each side, in order, and each gap is compared on its own, so
// distant edits remain separate passages. Only a large region with no such
// line is shown as removed and then added.

/** Line pairs above which a region is not compared with a full LCS table. */
const MAX_TABLE = 4_000_000;

/**
 * @typedef {{ type: 'same' | 'add' | 'del', text: string, left?: number, right?: number }} DiffLine
 * @typedef {{ type: 'skip', count: number }} DiffSkip
 * @typedef {DiffLine | DiffSkip} DiffRow
 */

/**
 * Every row of the difference, none collapsed.
 *
 * @param {string} before  Current text.
 * @param {string} after   Proposed text.
 * @returns {DiffLine[]}
 */
export function diffRows(before, after) {
  const left = String(before).replace(/\r\n?/g, '\n').split('\n');
  const right = String(after).replace(/\r\n?/g, '\n').split('\n');

  /** @type {DiffLine[]} */
  const rows = [];
  const same = (i, j) => rows.push({ type: 'same', text: left[i], left: i + 1, right: j + 1 });
  const del = (i) => rows.push({ type: 'del', text: left[i], left: i + 1 });
  const add = (j) => rows.push({ type: 'add', text: right[j], right: j + 1 });

  /**
   * Appends the rows for `left[lo1, hi1)` against `right[lo2, hi2)`, in order.
   *
   * @param {number} lo1 @param {number} hi1 @param {number} lo2 @param {number} hi2
   */
  const compare = (lo1, hi1, lo2, hi2) => {
    while (lo1 < hi1 && lo2 < hi2 && left[lo1] === right[lo2]) same(lo1++, lo2++);
    let tail = 0;
    while (hi1 - tail > lo1 && hi2 - tail > lo2 && left[hi1 - 1 - tail] === right[hi2 - 1 - tail]) tail += 1;
    const [end1, end2] = [hi1 - tail, hi2 - tail];
    const [n, m] = [end1 - lo1, end2 - lo2];
    if (n === 0 || m === 0) {
      for (let i = lo1; i < end1; i += 1) del(i);
      for (let j = lo2; j < end2; j += 1) add(j);
    } else if (n * m <= MAX_TABLE) {
      // Longest common subsequence of the region, filled from the end so the walk can run forward.
      const table = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
      for (let i = n - 1; i >= 0; i -= 1) {
        for (let j = m - 1; j >= 0; j -= 1) table[i][j] = left[lo1 + i] === right[lo2 + j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
      }
      let i = 0; let j = 0;
      while (i < n && j < m) {
        if (left[lo1 + i] === right[lo2 + j]) { same(lo1 + i, lo2 + j); i += 1; j += 1; }
        else if (table[i + 1][j] >= table[i][j + 1]) del(lo1 + i++);
        else add(lo2 + j++);
      }
      while (i < n) del(lo1 + i++);
      while (j < m) add(lo2 + j++);
    } else {
      const anchors = uniqueAnchors(lo1, end1, lo2, end2);
      if (!anchors.length) {
        for (let i = lo1; i < end1; i += 1) del(i);
        for (let j = lo2; j < end2; j += 1) add(j);
      } else {
        let [from1, from2] = [lo1, lo2];
        for (const [i, j] of anchors) { compare(from1, i, from2, j); same(i, j); [from1, from2] = [i + 1, j + 1]; }
        compare(from1, end1, from2, end2);
      }
    }
    for (let k = tail; k > 0; k -= 1) same(hi1 - k, hi2 - k);
  };

  /**
   * Lines that occur exactly once in each region, paired, keeping the longest
   * run whose positions increase on both sides (patience sorting).
   *
   * @returns {Array<[number, number]>}  Pairs of indices into `left` and `right`, in order.
   */
  const uniqueAnchors = (lo1, hi1, lo2, hi2) => {
    /** @type {Map<string, { count1: number, count2: number, at1: number, at2: number }>} */
    const seen = new Map();
    const entry = (text) => { let found = seen.get(text); if (!found) { found = { count1: 0, count2: 0, at1: -1, at2: -1 }; seen.set(text, found); } return found; };
    for (let i = lo1; i < hi1; i += 1) { const found = entry(left[i]); found.count1 += 1; found.at1 = i; }
    for (let j = lo2; j < hi2; j += 1) { const found = entry(right[j]); found.count2 += 1; found.at2 = j; }
    const pairs = [];
    for (let i = lo1; i < hi1; i += 1) { const found = seen.get(left[i]); if (found.count1 === 1 && found.count2 === 1) pairs.push([i, found.at2]); }
    // Longest increasing subsequence of the right-hand positions.
    const tails = []; const previous = new Int32Array(pairs.length).fill(-1);
    for (let k = 0; k < pairs.length; k += 1) {
      let [low, high] = [0, tails.length];
      while (low < high) { const middle = (low + high) >> 1; if (pairs[tails[middle]][1] < pairs[k][1]) low = middle + 1; else high = middle; }
      if (low > 0) previous[k] = tails[low - 1];
      tails[low] = k;
    }
    const chain = [];
    for (let k = tails.length ? tails[tails.length - 1] : -1; k !== -1; k = previous[k]) chain.push(pairs[k]);
    return chain.reverse();
  };

  compare(0, left.length, 0, right.length);
  return rows;
}

/**
 * Keeps every changed row and `context` unchanged rows around it, and counts
 * the rest as skips.
 *
 * @param {DiffLine[]} rows  As `diffRows` returns them.
 * @param {number} [context]
 * @returns {DiffRow[]}
 */
export function collapse(rows, context = 2) {
  const changed = rows.map((row) => row.type !== 'same');
  const keep = new Uint8Array(rows.length);
  changed.forEach((isChange, index) => {
    if (!isChange) return;
    for (let k = Math.max(0, index - context); k <= Math.min(rows.length - 1, index + context); k += 1) keep[k] = 1;
  });
  /** @type {DiffRow[]} */
  const result = []; let skipped = 0;
  rows.forEach((row, index) => {
    if (!keep[index]) { skipped += 1; return; }
    if (skipped) { result.push({ type: 'skip', count: skipped }); skipped = 0; }
    result.push(row);
  });
  if (skipped) result.push({ type: 'skip', count: skipped });
  return result;
}

/**
 * The difference with distant unchanged lines collapsed.
 *
 * @param {string} before  Current text.
 * @param {string} after   Proposed text.
 * @param {number} [context]  Unchanged lines kept on each side of a change.
 * @returns {DiffRow[]}
 */
export function lineDiff(before, after, context = 2) {
  return collapse(diffRows(before, after), context);
}

/**
 * Whether any line the diff shows as unchanged ends differently before and
 * after (CRLF, lone CR, lone LF, or none at the end). A line diff compares
 * text only, so this is the change it cannot show. Changed lines are already
 * shown as removed and added.
 *
 * @param {string} before
 * @param {string} after
 * @param {DiffLine[]} rows  `diffRows(before, after)`.
 * @returns {boolean}
 */
export function lineEndingsDiffer(before, after, rows) {
  // Splitting with a capture keeps each separator at an odd index: line k ends with parts[2k + 1].
  const endings = (text) => String(text).split(/(\r\n|\r|\n)/).filter((_, index) => index % 2 === 1);
  const [was, will] = [endings(before), endings(after)];
  return rows.some((row) => row.type === 'same' && (was[row.left - 1] ?? '') !== (will[row.right - 1] ?? ''));
}

/**
 * Where a run of shown rows sits in the piece, for the heading above it:
 * `Lines 12–15` when the numbering is unchanged, otherwise
 * `Lines 12–15, becoming 12–17`. Line numbers count from the first line of the
 * piece's source file, as the editor shows it.
 *
 * @param {DiffLine[]} hunk  Consecutive rows between two skips.
 * @returns {string}
 */
export function hunkLabel(hunk) {
  // Rows are in source order, so each side's numbers ascend: the first and last bound the run.
  const span = (numbers) => {
    if (!numbers.length) return null;
    const [first, last] = [numbers[0], numbers.at(-1)];
    return first === last ? `${first}` : `${first}–${last}`;
  };
  const was = span(hunk.filter((row) => row.left !== undefined).map((row) => row.left));
  const will = span(hunk.filter((row) => row.right !== undefined).map((row) => row.right));
  const lines = (range) => `${range.includes('–') ? 'Lines' : 'Line'} ${range}`;
  if (!was) return `New ${lines(will).toLowerCase()}`;
  if (!will) return `${lines(was)}, removed`;
  return was === will ? lines(was) : `${lines(was)}, becoming ${will}`;
}

/**
 * Splits diff rows into the runs a reviewer reads, each with its heading.
 *
 * @param {DiffRow[]} rows  As `lineDiff` returns them.
 * @returns {Array<{ type: 'hunk', label: string, rows: DiffLine[] } | DiffSkip>}
 */
export function diffHunks(rows) {
  /** @type {Array<{ type: 'hunk', label: string, rows: DiffLine[] } | DiffSkip>} */
  const result = [];
  /** @type {DiffLine[]} */
  let current = [];
  const close = () => { if (current.length) result.push({ type: 'hunk', label: hunkLabel(current), rows: current }); current = []; };
  for (const row of rows) {
    if (row.type === 'skip') { close(); result.push(row); } else current.push(row);
  }
  close();
  return result;
}
