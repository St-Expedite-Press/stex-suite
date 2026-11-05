import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

// Read-only check of the local toolchain STEX shells out to. Required tools
// fail the run; recommended and optional tools only report what is missing.
const root = process.cwd();
const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const corepackEntry = path.join(path.dirname(process.execPath), 'node_modules', 'corepack', 'dist', 'corepack.js');

function probe(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 60_000 });
  if (result.error || result.status !== 0) return null;
  return `${result.stdout || ''}${result.stderr || ''}`.trim();
}

const firstLine = (text) => text.split(/\r?\n/)[0].trim();
const version = (text) => (/(\d+)\.(\d+)\.(\d+)/.exec(text) || []).slice(1).map(Number);
const atLeast = (actual, minimum) => {
  for (let index = 0; index < 3; index += 1) if (actual[index] !== minimum[index]) return actual[index] > minimum[index];
  return true;
};

function corepack(args) {
  return process.platform === 'win32' ? probe(process.execPath, [corepackEntry, ...args]) : probe('corepack', args);
}

const nodeMinimum = version(manifest.engines.node);
const nodeMajor = Number(process.versions.node.split('.')[0]);
const pnpmExpected = manifest.packageManager.split('@')[1];

const checks = [
  {
    level: 'required', name: 'Node.js', need: `${manifest.engines.node}, 22 or 24 LTS`,
    run: () => atLeast(version(process.versions.node), nodeMinimum) ? `v${process.versions.node}` : null,
  },
  {
    level: 'required', name: 'Corepack', need: 'bundled with Node (removed in Node 25+)',
    run: () => {
      if (process.platform === 'win32' && !existsSync(corepackEntry)) return null;
      const found = corepack(['--version']);
      return found && `${firstLine(found)}${nodeMajor >= 25 ? ' (not bundled with this Node; Windows launchers expect it)' : ''}`;
    },
  },
  {
    level: 'required', name: 'pnpm', need: pnpmExpected,
    run: () => { const found = corepack(['pnpm', '--version']); return found && firstLine(found) === pnpmExpected ? firstLine(found) : null; },
  },
  {
    level: 'required', name: 'Installed packages', need: 'corepack pnpm install --frozen-lockfile',
    run: () => existsSync(path.join(root, 'node_modules', '.modules.yaml')) ? 'node_modules present' : null,
  },
  {
    level: 'required', name: 'Git', need: 'Seaxneat workspaces and revisions',
    run: () => { const found = probe('git', ['--version']); return found && firstLine(found); },
  },
  {
    level: 'required', name: 'Git LFS', need: 'brand masters and splash media (then run: git lfs install)',
    run: () => { const found = probe('git', ['lfs', 'version']); return found && firstLine(found); },
  },
  {
    level: 'recommended', name: 'LuaLaTeX', need: 'Frige proofs; proof tests skip without it',
    run: () => { const found = probe('lualatex', ['--version']); return found && firstLine(found); },
  },
  {
    level: 'recommended', name: 'TeX packages', need: 'fontspec, microtype, geometry',
    run: () => {
      const found = probe('kpsewhich', ['fontspec.sty', 'microtype.sty', 'geometry.sty']);
      const paths = (found || '').split(/\r?\n/).filter((line) => line.endsWith('.sty'));
      return paths.length === 3 ? 'all found' : null;
    },
  },
  {
    level: 'optional', name: 'pdffonts', need: 'Frige font-embedding preflight (Poppler or MiKTeX)',
    run: () => { const found = probe('pdffonts', ['-v']); return found && firstLine(found); },
  },
  {
    level: 'optional', name: 'FFmpeg', need: 'rebuilding splash media (assets:splash)',
    run: () => { const found = probe('ffmpeg', ['-version']); return found && probe('ffprobe', ['-version']) ? firstLine(found) : null; },
  },
  {
    level: 'optional', name: 'Chrome or Edge', need: 'splash browser verification (verify:splash; or set STEX_BROWSER)',
    run: () => [process.env.STEX_BROWSER, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((candidate) => candidate && existsSync(candidate)) || null,
  },
];

let failed = false;
for (const check of checks) {
  const found = check.run();
  if (!found && check.level === 'required') failed = true;
  const status = found ? 'ok  ' : check.level === 'required' ? 'FAIL' : 'miss';
  console.log(`${status}  ${check.name.padEnd(18)} ${found || `missing (${check.level}): ${check.need}`}`);
}
if (failed) {
  console.log('\nA required tool is missing; see "Prerequisites" in README.md.');
  process.exit(1);
}
