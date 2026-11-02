// Line-level difference used to review proposed manuscript changes. Rows are
// { type: 'same' | 'add' | 'del', text }; unchanged runs further than `context`
// lines from a change collapse to { type: 'skip', count }.
export function lineDiff(before, after, context = 2) {
  const left = String(before).replace(/\r\n?/g, '\n').split('\n');
  const right = String(after).replace(/\r\n?/g, '\n').split('\n');
  let rows;
  if (left.length * right.length > 4_000_000) {
    rows = [...left.map((text) => ({ type: 'del', text })), ...right.map((text) => ({ type: 'add', text }))];
  } else {
    // Longest common subsequence, filled from the end so the walk can run forward.
    const table = Array.from({ length: left.length + 1 }, () => new Uint32Array(right.length + 1));
    for (let i = left.length - 1; i >= 0; i -= 1) {
      for (let j = right.length - 1; j >= 0; j -= 1) table[i][j] = left[i] === right[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
    rows = []; let i = 0; let j = 0;
    while (i < left.length && j < right.length) {
      if (left[i] === right[j]) { rows.push({ type: 'same', text: left[i] }); i += 1; j += 1; }
      else if (table[i + 1][j] >= table[i][j + 1]) rows.push({ type: 'del', text: left[i++] });
      else rows.push({ type: 'add', text: right[j++] });
    }
    while (i < left.length) rows.push({ type: 'del', text: left[i++] });
    while (j < right.length) rows.push({ type: 'add', text: right[j++] });
  }
  const near = rows.map((row, index) => rows.slice(Math.max(0, index - context), index + context + 1).some((entry) => entry.type !== 'same'));
  const result = []; let skipped = 0;
  rows.forEach((row, index) => {
    if (!near[index]) { skipped += 1; return; }
    if (skipped) { result.push({ type: 'skip', count: skipped }); skipped = 0; }
    result.push(row);
  });
  if (skipped) result.push({ type: 'skip', count: skipped });
  return result;
}
