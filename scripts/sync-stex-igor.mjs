// Keeps stex-igor's copies of suite-owned files identical to their sources:
//   packages/design-system (tracked files)  ->  stex-igor/vendor/design-system
//   apps/pantheon/public/media/masthead      ->  stex-igor/apps/igor/public/media/masthead
// stex-suite is the source of truth. `--check` fails on any difference, missing,
// or extra file (part of `corepack pnpm test`); without it, the copies are
// rewritten and must then be committed in stex-igor.
//
//   node scripts/sync-stex-igor.mjs [--check]
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');
const lfsPointer = Buffer.from('version https://git-lfs.github.com/spec/v1');
const textExtensions = new Set(['.css', '.md', '.json', '.svg', '.txt', '.mjs', '.js', '.html']);

const pairs = [
  { source: 'packages/design-system', target: 'stex-igor/vendor/design-system', files: () => tracked('packages/design-system') },
  { source: 'apps/pantheon/public/media/masthead', target: 'stex-igor/apps/igor/public/media/masthead', files: () => tracked('apps/pantheon/public/media/masthead') },
];

function tracked(directory) {
  return execFileSync('git', ['ls-files', '-z', directory], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean).map((file) => file.slice(directory.length + 1));
}

async function listFiles(directory, prefix = '') {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); } catch { return []; }
  const nested = await Promise.all(entries.filter((entry) => entry.name !== 'node_modules').map((entry) => (entry.isDirectory()
    ? listFiles(path.join(directory, entry.name), `${prefix}${entry.name}/`)
    : [`${prefix}${entry.name}`])));
  return nested.flat();
}

// Text compares without line-ending differences (Windows checkouts); binaries byte for byte.
const comparable = (file, bytes) => (textExtensions.has(path.extname(file).toLowerCase()) ? Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n')) : bytes);

if (!existsSync(path.join(root, 'stex-igor', 'package.json'))) {
  console.error('stex-igor is not checked out: run "git submodule update --init" (with Git LFS installed).');
  process.exit(1);
}

const problems = [];
for (const pair of pairs) {
  const sources = pair.files();
  for (const file of sources) {
    const from = path.join(root, pair.source, file);
    const to = path.join(root, pair.target, file);
    const bytes = await readFile(from);
    if (bytes.subarray(0, lfsPointer.length).equals(lfsPointer)) { problems.push(`${pair.source}/${file} is an unresolved Git LFS pointer; run "git lfs pull".`); continue; }
    const current = existsSync(to) ? await readFile(to) : null;
    if (current && comparable(file, current).equals(comparable(file, bytes))) continue;
    if (check) { problems.push(`${pair.target}/${file} ${current ? 'differs from' : 'is missing; source'} ${pair.source}/${file}`); continue; }
    await mkdir(path.dirname(to), { recursive: true });
    await writeFile(to, bytes);
    console.log(`updated ${pair.target}/${file}`);
  }
  const expected = new Set(sources);
  for (const file of await listFiles(path.join(root, pair.target))) {
    if (expected.has(file)) continue;
    if (check) { problems.push(`${pair.target}/${file} has no source in ${pair.source}`); continue; }
    await rm(path.join(root, pair.target, file));
    console.log(`removed ${pair.target}/${file}`);
  }
}

if (problems.length) {
  for (const problem of problems) console.error(problem);
  console.error(check ? 'stex-igor copies are out of date: run "corepack pnpm sync:stex-igor", then commit inside stex-igor.' : 'Sync stopped.');
  process.exit(1);
}
console.log(check ? 'stex-igor copies match their stex-suite sources.' : 'stex-igor copies are up to date; commit the changes inside stex-igor.');
