// Line-level difference used to review proposed manuscript changes.
//
// Rows are { type: 'same' | 'add' | 'del', text, left?, right? }: `left` is the
// row's 1-based line number in the current text (same and del rows) and
// `right` its number in the proposed text (same and add rows). Unchanged runs
// further than `context` lines from a change collapse to { type: 'skip', count }.
//
// Lines shared at the start and the end are matched before the longest common
// subsequence runs, so a localized edit to a long piece costs only the size of
// the edited region and is shown as that region, never as the whole piece
// deleted and re-added. Only a changed region too large to compare line by
// line (over four million line pairs) is shown as removed and then added.

/**
 * @typedef {{ type: 'same' | 'add' | 'del', text: string, left?: number, right?: number }} DiffLine
 * @typedef {{ type: 'skip', count: number }} DiffSkip
 * @typedef {DiffLine | DiffSkip} DiffRow
 */

/**
 * @param {string} before  Current text.
 * @param {string} after   Proposed text.
 * @param {number} [context]  Unchanged lines kept on each side of a change.
 * @returns {DiffRow[]}
 */
export function lineDiff(before, after, context = 2) {
  const left = String(before).replace(/\r\n?/g, '\n').split('\n');
  const right = String(after).replace(/\r\n?/g, '\n').split('\n');
  let head = 0;
  while (head < left.length && head < right.length && left[head] === right[head]) head += 1;
  let tail = 0;
  while (tail < left.length - head && tail < right.length - head && left[left.length - 1 - tail] === right[right.length - 1 - tail]) tail += 1;
  const middleLeft = left.slice(head, left.length - tail);
  const middleRight = right.slice(head, right.length - tail);

  /** @type {DiffLine[]} */
  const rows = [];
  const same = (i, j) => rows.push({ type: 'same', text: left[i], left: i + 1, right: j + 1 });
  const del = (i) => rows.push({ type: 'del', text: left[i], left: i + 1 });
  const add = (j) => rows.push({ type: 'add', text: right[j], right: j + 1 });
  for (let k = 0; k < head; k += 1) same(k, k);
  if (middleLeft.length * middleRight.length > 4_000_000) {
    middleLeft.forEach((_, k) => del(head + k));
    middleRight.forEach((_, k) => add(head + k));
  } else {
    // Longest common subsequence of the changed region, filled from the end so the walk can run forward.
    const table = Array.from({ length: middleLeft.length + 1 }, () => new Uint32Array(middleRight.length + 1));
    for (let i = middleLeft.length - 1; i >= 0; i -= 1) {
      for (let j = middleRight.length - 1; j >= 0; j -= 1) table[i][j] = middleLeft[i] === middleRight[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
    let i = 0; let j = 0;
    while (i < middleLeft.length && j < middleRight.length) {
      if (middleLeft[i] === middleRight[j]) { same(head + i, head + j); i += 1; j += 1; }
      else if (table[i + 1][j] >= table[i][j + 1]) del(head + i++);
      else add(head + j++);
    }
    while (i < middleLeft.length) del(head + i++);
    while (j < middleRight.length) add(head + j++);
  }
  for (let k = tail; k > 0; k -= 1) same(left.length - k, right.length - k);

  // Keep every changed row and `context` unchanged rows around it; count the rest.
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
