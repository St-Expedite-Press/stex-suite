/**
 * Builds a self-contained release of the hosted Pantheon stack: the Pantheon
 * shell (with its Frige publishing workspace) and the Frige engine.
 *
 * The archive mirrors the repository paths the servers resolve relatively
 * (apps/pantheon, apps/frige, services/knowledge, protocol), and vendors the
 * only runtime packages they load (the design system and pdfjs-dist), so the
 * host needs Node alone and never runs a package manager.
 *
 * Manuscripts, local state and Seaxneat are never packaged: books are seeded
 * into the host's state directory separately, and Seaxneat is deferred until
 * its generated-code processes have an OS isolation boundary.
 *
 *   node scripts/release/build-pantheon-release.mjs [--out release] [--skip-build]
 *
 * Environment: STEX_RELEASE_SHA (full commit SHA; default HEAD) and
 * STEX_RELEASE_GENERATION (non-negative integer; default 0 for local builds).
 * Output: release/stex-pantheon-<rev>[-dirty]/ and its .tar.gz, plus
 * RELEASE.json { product, sha, generation, builtAt, source, dirty }.
 */
import { spawnSync } from 'node:child_process';
import { cp, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const outRoot = path.resolve(root, args.includes('--out') ? args[args.indexOf('--out') + 1] : 'release');

/** Runs a command from the repository root and throws on a non-zero exit. */
function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, { cwd: root, stdio: 'inherit', shell: false, ...options });
  if (result.status !== 0) throw new Error(`${command} ${commandArgs.join(' ')} failed`);
}
/** Reads one line of git output from the repository root. */
const git = (...gitArgs) => spawnSync('git', gitArgs, { cwd: root, encoding: 'utf8' }).stdout.trim();

const sha = (process.env.STEX_RELEASE_SHA || git('rev-parse', 'HEAD')).trim().toLowerCase();
if (!/^([0-9a-f]{40}|[0-9a-f]{64})$/.test(sha)) throw new Error('STEX_RELEASE_SHA must be a full commit SHA.');
const generationText = (process.env.STEX_RELEASE_GENERATION ?? '').trim() || '0';
if (!/^\d{1,15}$/.test(generationText)) throw new Error('STEX_RELEASE_GENERATION must be a non-negative integer.');
// Only the packaged paths decide whether this release differs from its commit.
const packaged = ['apps/pantheon', 'apps/frige/server.mjs', 'apps/frige/src', 'apps/frige/public', 'apps/frige/package.json', 'services/knowledge/src', 'protocol', 'packages/design-system', 'pnpm-lock.yaml'];
const dirty = git('status', '--porcelain', '--', ...packaged) !== '';
const name = `stex-pantheon-${sha.slice(0, 12)}${dirty ? '-dirty' : ''}`;
const stage = path.join(outRoot, name);
if (path.relative(outRoot, stage) !== name) throw new Error('The release staging path must stay inside its output directory.');

if (!args.includes('--skip-build')) {
  // Pantheon's Vite build produces dist/workspaces, which the shell serves.
  const buildArgs = ['pnpm', '--dir', 'apps/pantheon', 'build'];
  if (process.platform === 'win32') run(process.execPath, [path.join(path.dirname(process.execPath), 'node_modules', 'corepack', 'dist', 'corepack.js'), ...buildArgs]);
  else run('corepack', buildArgs);
}

await rm(stage, { recursive: true, force: true });
/** Copies a repository path into the stage, dereferencing pnpm symlinks. */
const copy = (from, to = from) => cp(path.isAbsolute(from) ? from : path.join(root, from), path.join(stage, to), { recursive: true, dereference: true });

// Pantheon shell. Tests, local projects and TypeScript sources stay behind.
for (const part of ['server.mjs', 'package.json', 'src', 'public', 'workspaces/frige', 'dist']) await copy(`apps/pantheon/${part}`);
// Frige engine, without books (protected manuscripts are host state, not code).
for (const part of ['server.mjs', 'package.json', 'src', 'public']) await copy(`apps/frige/${part}`);
await copy('services/knowledge/src');
await copy('services/knowledge/package.json');
await copy('protocol');

// The design system's public folders, resolved by both servers through node_modules.
for (const app of ['pantheon', 'frige']) {
  for (const part of ['package.json', 'src', 'fonts', 'brand', 'icons', 'specimen']) await copy(`packages/design-system/${part}`, `apps/${app}/node_modules/@stex/design-system/${part}`);
}
// pdfjs-dist: the viewer bundle Frige serves and the legacy build its preflight loads.
// Its optional native canvas binding is platform-specific and is not used.
const pdfjs = path.dirname(createRequire(path.join(root, 'apps/frige/package.json')).resolve('pdfjs-dist/package.json'));
for (const part of ['package.json', 'LICENSE', 'build', 'legacy/build']) await copy(path.join(pdfjs, part), `apps/frige/node_modules/pdfjs-dist/${part}`);

// Fail the build, not the host, when something the servers load is missing.
for (const required of ['apps/pantheon/dist/workspaces/seaxneat.js', 'apps/pantheon/public/index.html', 'protocol/applications/registry.v2.json', 'apps/frige/node_modules/pdfjs-dist/legacy/build/pdf.mjs', 'apps/frige/node_modules/pdfjs-dist/build/pdf.min.mjs']) {
  await stat(path.join(stage, required)).catch(() => { throw new Error(`The release is missing ${required}.`); });
}
// Local state and secrets never travel, even if a developer left them in place.
for (const forbidden of ['.env', '.local-data', '.local-projects', '.local-book', 'books']) {
  for (const app of ['pantheon', 'frige']) {
    const entries = await readdir(path.join(stage, 'apps', app));
    if (entries.includes(forbidden)) throw new Error(`The release unexpectedly contains apps/${app}/${forbidden}.`);
  }
}

await writeFile(path.join(stage, 'RELEASE'), `${sha.slice(0, 12)}${dirty ? ' (uncommitted changes)' : ''}\n`);
const source = process.env.GITHUB_ACTIONS === 'true' ? 'github-actions' : 'local';
await writeFile(path.join(stage, 'RELEASE.json'), `${JSON.stringify({ product: 'stex-pantheon', sha, generation: Number(generationText), builtAt: new Date().toISOString(), source, dirty }, null, 2)}\n`);

await mkdir(outRoot, { recursive: true });
const tarball = path.join(outRoot, `${name}.tar.gz`);
// Relative paths avoid GNU tar's drive-letter interpretation and work with Windows BSD tar.
run('tar', ['-czf', `${name}.tar.gz`, '-C', name, '.'], { cwd: outRoot });
console.log(`release=${name}`);
console.log(`tarball=${tarball}`);
