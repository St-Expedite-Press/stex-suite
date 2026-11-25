import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

/** Reads Git metadata without changing the repository or fetching objects. */
function git(directory, args) {
  const result = spawnSync('git', args, { cwd: directory, encoding: 'utf8', windowsHide: true, timeout: 60_000 });
  return result.status === 0 ? result.stdout.trim() : null;
}

/** Compares the private checkout with the suite's committed gitlink. */
export function checkIgorPin(suiteDirectory) {
  const igorDirectory = path.join(suiteDirectory, 'stex-igor');
  const treeEntry = git(suiteDirectory, ['ls-tree', 'HEAD', '--', 'stex-igor']);
  const expected = /^160000 commit ([0-9a-f]{40})\tstex-igor$/.exec(treeEntry || '')?.[1];
  if (!expected) return { problem: 'No committed stex-igor pin found. Use an authorized Git checkout.' };
  if (!existsSync(path.join(igorDirectory, '.git'))) {
    return { problem: 'Igor is missing. Run git submodule update --init stex-igor with authorized access.' };
  }
  const actual = git(igorDirectory, ['rev-parse', '--verify', 'HEAD']);
  if (actual !== expected) {
    return { problem: `Expected ${expected.slice(0, 12)}, found ${actual?.slice(0, 12) || 'no revision'}. Preserve local Igor work, then check out the suite pin.` };
  }
  return { ok: expected.slice(0, 12) };
}

/** Checks that tracked application media are materialized in this worktree. */
export function checkRuntimeMedia(directory, pullCommand) {
  if (!existsSync(path.join(directory, '.git'))) {
    return { problem: 'The repository must be checked out before its media can be verified.' };
  }
  const output = git(directory, ['lfs', 'ls-files', '--json', '--include', 'apps/*/public/media/**']);
  const files = output && JSON.parse(output).files;
  if (!Array.isArray(files) || files.length === 0) {
    return { problem: `Could not inspect runtime media. Check Git LFS and run ${pullCommand}.` };
  }
  const missing = files.find((file) => !file.checkout || !existsSync(path.join(directory, file.name)));
  if (missing) return { problem: `${JSON.stringify(missing.name)} is missing or an LFS pointer. Run ${pullCommand}.` };
  return { ok: `${files.length} available` };
}
