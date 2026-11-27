/**
 * Canonical verification gate runner (library).
 *
 * Runs every required check of a repository gate as its own subprocess, keeps
 * each exit status, and produces one report that says which checks passed,
 * failed, were skipped or never ran, against which exact revisions, pins and
 * environment. The CLI is `scripts/verify/run-gates.mjs`; this module holds the
 * pure and testable parts.
 *
 * Rules the runner enforces mechanically:
 * - A check passes only on exit status 0 with no signal, timeout or spawn
 *   error. Output text never overrides the exit status.
 * - Checks run without a shell wherever possible, so no pipeline can mask a
 *   status. The only shell use is Windows' `.cmd` shims, with each argument
 *   validated against a safe character set first.
 * - The gate's verdict is `pass` only when every selected check passed and
 *   none was skipped or left unexecuted. Anything else exits non-zero.
 * - A report is evidence only for the revisions and worktree contents it
 *   fingerprints; `compareFingerprints` rejects it once either changes.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Report format identifier; bump on any incompatible change. */
export const REPORT_FORMAT = 'stex.verification.run.v1';

/** Process exit codes of the CLI, by outcome. */
export const EXIT = Object.freeze({ pass: 0, fail: 1, usage: 2, incomplete: 3, stale: 4, interrupted: 130 });

/**
 * @typedef {object} CheckDefinition
 * @property {string} id Stable check identifier, e.g. `suite/test:frige`.
 * @property {string} repository Repository key (`suite` or `igor`).
 * @property {string[]} command Argument vector; `command[0]` is the program.
 * @property {string} cwd Absolute working directory.
 * @property {string[]} [requires] Programs that must be on PATH; when one is missing the check is `skipped`.
 *
 * @typedef {'passed'|'failed'|'skipped'|'unexecuted'} CheckStatus
 *
 * @typedef {object} CheckResult
 * @property {string} id
 * @property {string} repository
 * @property {string[]} command
 * @property {CheckStatus} status
 * @property {number|null} exitCode Child exit status, `null` when it never exited normally.
 * @property {string|null} signal Terminating signal, if any.
 * @property {string|null} reason Why the check failed, was skipped or did not run.
 * @property {number} durationMs
 * @property {number|null} testSkips Skipped tests reported inside the check's own output, when recognisable.
 * @property {string|null} log Path of the full output log.
 *
 * @typedef {object} RepoFingerprint
 * @property {string} root Absolute repository root.
 * @property {string} head Commit SHA of HEAD.
 * @property {string} tree Tree SHA of HEAD.
 * @property {string|null} branch Current branch, `null` when detached.
 * @property {boolean} dirty Whether tracked or untracked (non-ignored) files differ from HEAD.
 * @property {string} contentDigest sha256 over HEAD's tree and every worktree difference.
 * @property {string[]} changedPaths Paths that differ from HEAD (tracked and untracked).
 */

const SAFE_ARGUMENT = /^[\w:./=@+-]+$/;

/**
 * Splits a package script made only of `corepack pnpm run <name>` steps joined
 * by `&&` into its script names. Anything else (another command, `||`, `;`,
 * pipes, redirection) is refused, so the runner never silently drops a step it
 * does not understand.
 *
 * @param {string} script The package.json script text.
 * @returns {string[]} Script names in order.
 */
export function parseChain(script) {
  if (typeof script !== 'string' || !script.trim()) throw new Error('the gate script is empty');
  if (/\|\||;|\||>|<|`|\$\(/.test(script)) throw new Error(`the gate script uses shell syntax the runner refuses: ${script}`);
  return script.split('&&').map((part) => {
    const match = /^corepack pnpm run ([\w:.-]+)$/.exec(part.trim());
    if (!match) throw new Error(`unrecognised gate step "${part.trim()}"; express each step as "corepack pnpm run <script>"`);
    return match[1];
  });
}

/**
 * Builds the check list of one repository's gate from its package.json, so
 * the runner and `corepack pnpm test` share one definition.
 *
 * @param {object} options
 * @param {string} options.repository Repository key used in check ids.
 * @param {string} options.root Absolute repository root.
 * @param {string[]} [options.before] Scripts run before the `test` chain (CI order).
 * @param {string[]} [options.after] Scripts run after the `test` chain (CI order).
 * @param {Record<string, string[]>} [options.requires] Programs each script needs.
 * @returns {CheckDefinition[]}
 */
export function packageGate({ repository, root, before = [], after = [], requires = {} }) {
  const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  const scripts = manifest.scripts || {};
  const names = [...before, ...parseChain(scripts.test), ...after];
  return names.map((name) => {
    if (!scripts[name]) throw new Error(`${repository}: package.json has no script "${name}"`);
    return { id: `${repository}/${name}`, repository, command: ['corepack', 'pnpm', 'run', name], cwd: root, requires: requires[name] || [] };
  });
}

/**
 * The suite gate, in the order trusted CI runs it.
 * @param {string} root Suite repository root.
 * @returns {CheckDefinition[]}
 */
export function suiteGate(root) {
  return packageGate({ repository: 'suite', root, before: ['check:prereqs', 'build:pantheon'], requires: { 'test:platform': ['uv'] } });
}

/**
 * The stex-igor gate, in the order its CI runs it.
 * @param {string} root stex-igor repository root.
 * @returns {CheckDefinition[]}
 */
export function igorGate(root) {
  return packageGate({ repository: 'igor', root, after: ['typecheck:igor', 'build:igor'] });
}

/**
 * Finds a program on PATH without running it.
 * @param {string} program
 * @returns {boolean}
 */
export function onPath(program) {
  if (path.isAbsolute(program)) return existsSync(program);
  const extensions = process.platform === 'win32' ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';') : [''];
  for (const directory of (process.env.PATH || '').split(path.delimiter)) {
    if (!directory) continue;
    for (const extension of extensions) if (existsSync(path.join(directory, program + extension.toLowerCase())) || existsSync(path.join(directory, program + extension))) return true;
  }
  return false;
}

/**
 * Resolves how to spawn a command. `corepack` runs through Node's bundled
 * entry point when it exists, which needs no shell on any platform; other bare
 * programs on Windows go through `cmd` only after every argument is checked.
 *
 * @param {string[]} command
 * @returns {{ file: string, args: string[], shell: boolean }}
 */
export function spawnPlan(command) {
  const [program, ...args] = command;
  if (program === 'corepack') {
    for (const entry of [
      path.join(path.dirname(process.execPath), 'node_modules', 'corepack', 'dist', 'corepack.js'),
      path.join(path.dirname(process.execPath), '..', 'lib', 'node_modules', 'corepack', 'dist', 'corepack.js'),
    ]) if (existsSync(entry)) return { file: process.execPath, args: [entry, ...args], shell: false };
  }
  if (process.platform === 'win32' && !path.isAbsolute(program)) {
    for (const part of command) if (!SAFE_ARGUMENT.test(part)) throw new Error(`refusing to pass "${part}" through the Windows shell`);
    return { file: command.join(' '), args: [], shell: true };
  }
  return { file: program, args, shell: false };
}

/**
 * Counts skipped tests a check reported in its own output. Recognises the Node
 * test runner (spec and TAP reporters) and pytest summaries; returns `null`
 * when no summary is found, so "no skips" and "unknown" stay distinct.
 *
 * @param {string} output
 * @returns {number|null}
 */
export function countTestSkips(output) {
  let total = null;
  const add = (value) => { total = (total ?? 0) + Number(value); };
  for (const match of output.matchAll(/^[ℹ#]\s+skipped\s+(\d+)\s*$/gmu)) add(match[1]);
  for (const match of output.matchAll(/^# skip (\d+)\s*$/gm)) add(match[1]);
  // pytest's final summary, framed with `=` by default and bare under `-q`.
  for (const match of output.matchAll(/^(?:=+ )?(?:\d+ [a-z]+, )*(\d+) skipped(?:, \d+ [a-z]+)* in [\d.]+s\b/gm)) add(match[1]);
  return total;
}

/**
 * Runs one check as a subprocess and classifies it from its exit status.
 *
 * @param {CheckDefinition} check
 * @param {object} options
 * @param {number} options.timeoutMs Kill the check after this long and mark it failed.
 * @param {(chunk: string) => void} [options.onOutput] Receives output as it arrives.
 * @param {(child: import('node:child_process').ChildProcess) => void} [options.onSpawn] Lets the caller track the running child.
 * @returns {Promise<{ result: CheckResult, output: string }>}
 */
export function runCheck(check, { timeoutMs, onOutput = () => {}, onSpawn = () => {} }) {
  const started = Date.now();
  /** @type {(fields: Partial<CheckResult>) => CheckResult} */
  const finish = (fields) => ({ id: check.id, repository: check.repository, command: check.command, status: 'failed', exitCode: null, signal: null, reason: null, durationMs: Date.now() - started, testSkips: null, log: null, ...fields });
  for (const program of check.requires || []) {
    if (!onPath(program)) return Promise.resolve({ result: finish({ status: 'skipped', reason: `required program "${program}" is not on PATH` }), output: '' });
  }
  let plan;
  try { plan = spawnPlan(check.command); } catch (error) {
    return Promise.resolve({ result: finish({ reason: `could not start: ${error.message}` }), output: '' });
  }
  return new Promise((resolve) => {
    let output = '';
    let timedOut = false;
    let settled = false;
    // POSIX: its own process group, so a timeout can stop pnpm's descendants too (killTree).
    const child = spawn(plan.file, plan.args, { cwd: check.cwd, shell: plan.shell, windowsHide: true, detached: process.platform !== 'win32', env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    onSpawn(child);
    const collect = (data) => { const text = data.toString('utf8'); output += text; onOutput(text); };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    const timer = setTimeout(() => { timedOut = true; killTree(child); }, timeoutMs);
    const settle = (fields) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ result: finish({ testSkips: countTestSkips(output), ...fields }), output });
    };
    child.on('error', (error) => settle({ reason: `could not start: ${error.message}` }));
    child.on('close', (code, signal) => {
      if (timedOut) return settle({ exitCode: code, signal, reason: `timed out after ${Math.round(timeoutMs / 1000)} s` });
      if (signal) return settle({ exitCode: code, signal, reason: `terminated by ${signal}` });
      if (code === 0) return settle({ status: 'passed', exitCode: 0 });
      return settle({ exitCode: code, reason: `exit status ${code}` });
    });
  });
}

/**
 * Stops a check and its descendants (pnpm spawns shells, Node and pytest). A
 * descendant left alive would hold the output pipes open, so the check would
 * never close and its timeout would never be recorded. Windows kills the tree
 * with taskkill; POSIX signals the check's process group (it was spawned
 * detached), then escalates to SIGKILL after five seconds.
 * @param {import('node:child_process').ChildProcess} child
 */
export function killTree(child) {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true });
    return;
  }
  const signalGroup = (signal) => { try { process.kill(-child.pid, signal); } catch { /* the group is already gone */ } };
  signalGroup('SIGTERM');
  setTimeout(() => signalGroup('SIGKILL'), 5000).unref();
}

/**
 * The gate verdict: `fail` if any check failed, `incomplete` if none failed
 * but some were skipped or never ran, `pass` only when every check passed.
 *
 * @param {CheckResult[]} results
 * @returns {'pass'|'fail'|'incomplete'}
 */
export function verdictOf(results) {
  if (results.length === 0) return 'incomplete';
  if (results.some((result) => result.status === 'failed')) return 'fail';
  if (results.some((result) => result.status !== 'passed')) return 'incomplete';
  return 'pass';
}

/**
 * Counts results by status.
 * @param {CheckResult[]} results
 * @returns {Record<CheckStatus, number>}
 */
export function tally(results) {
  const counts = { passed: 0, failed: 0, skipped: 0, unexecuted: 0 };
  for (const result of results) counts[result.status] += 1;
  return counts;
}

/**
 * Runs git and returns trimmed stdout, or throws with git's message.
 * @param {string} cwd
 * @param {string[]} args
 * @param {{ raw?: boolean }} [options] `raw` returns a Buffer.
 */
function git(cwd, args, { raw = false } = {}) {
  const result = spawnSync('git', args, { cwd, windowsHide: true, maxBuffer: 512 * 1024 * 1024, encoding: raw ? 'buffer' : 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed in ${cwd}: ${String(result.stderr).trim()}`);
  return raw ? result.stdout : result.stdout.trim();
}

/**
 * Fingerprints a repository's exact content: HEAD, its tree, and every
 * difference in the worktree (tracked changes as a binary diff, untracked
 * non-ignored files by content). Any edit, addition or removal of a file
 * that git would see changes `contentDigest`.
 *
 * @param {string} root
 * @returns {RepoFingerprint}
 */
export function fingerprint(root) {
  const head = git(root, ['rev-parse', 'HEAD']);
  const tree = git(root, ['rev-parse', 'HEAD^{tree}']);
  const branchName = git(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const hash = createHash('sha256').update(`tree ${tree}\n`);
  // --ignore-submodules=none: a moved or modified submodule counts as a change here too.
  const diff = git(root, ['diff', 'HEAD', '--binary', '--no-color', '--no-ext-diff', '--ignore-submodules=none'], { raw: true });
  hash.update(diff);
  const tracked = git(root, ['diff', 'HEAD', '--name-only', '--ignore-submodules=none']).split('\n').filter(Boolean);
  const untracked = git(root, ['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean).sort();
  for (const file of untracked) {
    hash.update(`\nuntracked ${file}\n`);
    try { hash.update(readFileSync(path.join(root, file))); } catch { hash.update('<unreadable>'); }
  }
  // `assume-unchanged` (lower-case tag) and `skip-worktree` (S) make git, and so the diff above,
  // ignore a tracked file's edits. Such a file is hashed from disk and always counts as a change,
  // so a hidden edit can neither pass as clean nor leave a report current.
  const flagged = git(root, ['ls-files', '-v', '-z']).split('\0').filter(Boolean)
    .filter((entry) => /^[a-z] /.test(entry) || entry.startsWith('S ')).map((entry) => entry.slice(2)).sort();
  for (const file of flagged) {
    hash.update(`\nflagged ${file}\n`);
    try { hash.update(readFileSync(path.join(root, file))); } catch { hash.update('<unreadable>'); }
  }
  const changedPaths = [...tracked, ...untracked, ...flagged.map((file) => `${file} (assume-unchanged or skip-worktree)`)];
  return { root, head, tree, branch: branchName === 'HEAD' ? null : branchName, dirty: changedPaths.length > 0, contentDigest: hash.digest('hex'), changedPaths };
}

/**
 * Lists every way the current content differs from the content a report
 * recorded. An empty list means the report describes exactly this content.
 *
 * Content, not commit identity, decides: `contentDigest` covers HEAD's tree
 * (including the Igor gitlink) and every worktree difference. A different
 * commit with a byte-identical tree and the same worktree, such as GitHub's
 * synthetic pull-request merge of a branch whose base is current, is the same
 * content; it is reported in `notes`, never silently.
 *
 * @param {Record<string, RepoFingerprint|null>} recorded
 * @param {Record<string, RepoFingerprint|null>} current
 * @param {string[]} [notes] Receives same-content, different-commit observations.
 * @returns {string[]}
 */
export function compareFingerprints(recorded, current, notes = []) {
  const differences = [];
  for (const key of new Set([...Object.keys(recorded), ...Object.keys(current)])) {
    const before = recorded[key];
    const after = current[key];
    if (!before && !after) continue;
    if (!before || !after) { differences.push(`${key}: present in only one of the report and the checkout`); continue; }
    if (before.contentDigest !== after.contentDigest) {
      differences.push(before.tree !== after.tree
        ? `${key}: HEAD ${after.head.slice(0, 12)} (tree ${after.tree.slice(0, 12)}) differs from the tested ${before.head.slice(0, 12)} (tree ${before.tree.slice(0, 12)})`
        : `${key}: worktree content changed since the report (now: ${after.changedPaths.slice(0, 5).join(', ') || 'clean'})`);
    } else if (before.head !== after.head) {
      notes.push(`${key}: the report tested commit ${before.head.slice(0, 12)}; the checkout is ${after.head.slice(0, 12)} with the identical tree ${after.tree.slice(0, 12)} and worktree`);
    }
  }
  return differences;
}

/**
 * Reads a file's first line, or `null`.
 * @param {string} file
 */
function firstLineOf(file) {
  try { return readFileSync(file, 'utf8').split(/\r?\n/)[0].trim() || null; } catch { return null; }
}

/**
 * Hashes a file, or `null` when it does not exist.
 * @param {string} file
 */
function sha256Of(file) {
  try { return createHash('sha256').update(readFileSync(file)).digest('hex'); } catch { return null; }
}

/**
 * Runs a version probe without a shell and returns its first output line.
 * @param {string[]} command
 */
function probeVersion(command, cwd) {
  let plan;
  try { plan = spawnPlan(command); } catch { return null; }
  // In the suite root: corepack resolves pnpm from that packageManager, as the checks do.
  const result = spawnSync(plan.file, plan.args, { cwd, shell: plan.shell, encoding: 'utf8', windowsHide: true, timeout: 30_000 });
  if (result.error || result.status !== 0) return null;
  return `${result.stdout || ''}${result.stderr || ''}`.trim().split(/\r?\n/)[0] || null;
}

/**
 * Records the dependency and runtime pins the gate depends on, as declared in
 * the repositories, plus the submodule consistency the suite relies on.
 *
 * @param {string} suiteRoot
 * @param {string|null} igorRoot
 */
export function readPins(suiteRoot, igorRoot) {
  const pkg = JSON.parse(readFileSync(path.join(suiteRoot, 'package.json'), 'utf8'));
  const pins = {
    node: firstLineOf(path.join(suiteRoot, '.node-version')),
    python: firstLineOf(path.join(suiteRoot, '.python-version')),
    packageManager: pkg.packageManager || null,
    lockfiles: { 'pnpm-lock.yaml': sha256Of(path.join(suiteRoot, 'pnpm-lock.yaml')), 'uv.lock': sha256Of(path.join(suiteRoot, 'uv.lock')) },
    igorGitlink: null,
    igorCheckedOut: null,
    igorGitlinkConsistent: null,
    hermesRuntimeGitlink: null,
    hermesEval: null,
  };
  const line = spawnSync('git', ['ls-tree', 'HEAD', 'stex-igor'], { cwd: suiteRoot, encoding: 'utf8', windowsHide: true }).stdout || '';
  pins.igorGitlink = /^160000 commit ([0-9a-f]{40})\t/.exec(line)?.[1] ?? null;
  if (igorRoot) {
    pins.igorCheckedOut = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: igorRoot, encoding: 'utf8', windowsHide: true }).stdout.trim() || null;
    pins.igorGitlinkConsistent = pins.igorGitlink !== null && pins.igorGitlink === pins.igorCheckedOut;
    const runtime = spawnSync('git', ['ls-tree', 'HEAD', 'runtime/hermes-agent'], { cwd: igorRoot, encoding: 'utf8', windowsHide: true }).stdout || '';
    pins.hermesRuntimeGitlink = /^160000 commit ([0-9a-f]{40})\t/.exec(runtime)?.[1] ?? null;
    try {
      const evalPins = JSON.parse(readFileSync(path.join(igorRoot, 'hermes', 'eval', 'pins.json'), 'utf8'));
      pins.hermesEval = { current: evalPins.current?.sha ?? null, candidate: evalPins.candidate?.sha ?? null, obsidian: evalPins.obsidian?.sha ?? null };
    } catch { pins.hermesEval = null; }
  }
  return pins;
}

/**
 * Describes where the gate ran and compares the toolchain with the pins. Every
 * unknown counts against release evidence: a missing pin, an unprobeable pnpm,
 * or a `node` on PATH (which the checks run through pnpm) that differs from the
 * Node running the gate.
 * @param {ReturnType<typeof readPins>} pins
 * @param {string} [cwd] The suite root, where corepack and PATH resolve as for the checks.
 */
export function describeEnvironment(pins, cwd) {
  const nodeVersion = process.version.replace(/^v/, '');
  const pathNode = probeVersion(['node', '--version'], cwd)?.replace(/^v/, '') ?? null;
  const pnpmVersion = probeVersion(['corepack', 'pnpm', '--version'], cwd);
  const uvVersion = probeVersion(['uv', '--version'], cwd);
  const expectedPnpm = /^pnpm@(.+)$/.exec(pins.packageManager || '')?.[1] ?? null;
  const mismatches = [];
  if (!pins.node) mismatches.push('no .node-version pin to check Node against');
  else if (nodeVersion !== pins.node) mismatches.push(`Node ${nodeVersion} runs the gate; .node-version pins ${pins.node}`);
  if (pathNode && pathNode !== nodeVersion) mismatches.push(`the node on PATH (${pathNode}) differs from the Node running the gate (${nodeVersion})`);
  if (!expectedPnpm) mismatches.push('no packageManager pin to check pnpm against');
  else if (!pnpmVersion) mismatches.push('pnpm could not be probed');
  else if (pnpmVersion !== expectedPnpm) mismatches.push(`pnpm ${pnpmVersion} runs the gate; packageManager pins ${expectedPnpm}`);
  return {
    os: { platform: process.platform, release: os.release(), arch: process.arch, hostnameHash: createHash('sha256').update(os.hostname()).digest('hex').slice(0, 12) },
    node: nodeVersion,
    pathNode,
    pnpm: pnpmVersion,
    uv: uvVersion,
    ci: process.env.GITHUB_ACTIONS === 'true' ? { provider: 'github-actions', runId: process.env.GITHUB_RUN_ID || null, sha: process.env.GITHUB_SHA || null, ref: process.env.GITHUB_REF || null } : null,
    mismatches,
  };
}

/**
 * Whether a report may stand as release evidence: the gate passed, both
 * repositories were clean, the checked-out Igor matched the suite's gitlink,
 * and the toolchain matched the pins.
 *
 * It must also be the whole canonical gate: both repositories, the checks
 * derived from their package.json files, no injected manifest and no
 * `--only` selection (a partial selection already makes the verdict
 * `incomplete`).
 *
 * Summary fields are cross-checked against the raw data they summarise (the
 * verdict against each check's status, cleanliness against the changed paths,
 * gitlink consistency against both revisions, the toolchain against the pins),
 * so a summary edit alone cannot pass. A report file is still unsigned local
 * data, so this is a consistency check, not tamper evidence. The authoritative
 * release evidence is trusted CI, which runs `--check --release` on the report it
 * has just produced (see .github/workflows/ci.yml).
 *
 * @param {{ verdict: string, checks?: { status: string }[], gate?: { scope: string, custom: boolean }, repositories: Record<string, RepoFingerprint|null>, pins: ReturnType<typeof readPins>, environment: { node?: string, mismatches: string[] } }} report
 * @returns {{ eligible: boolean, reasons: string[] }}
 */
export function releaseEligibility(report) {
  const reasons = [];
  if (!report.gate || report.gate.custom) reasons.push('the run used an injected check manifest, not the canonical gate');
  else if (report.gate.scope !== 'all') reasons.push(`the run covered only --repo ${report.gate.scope}, not both repositories`);
  if (report.verdict !== 'pass') reasons.push(`verdict is ${report.verdict}`);
  if (Array.isArray(report.checks) && verdictOf(report.checks) !== 'pass') reasons.push('the checks themselves do not all pass');
  for (const [key, repo] of Object.entries(report.repositories)) {
    if (repo?.dirty || repo?.changedPaths?.length) reasons.push(`${key} worktree had uncommitted changes (${repo.changedPaths?.length ?? '?'} paths)`);
  }
  const { igorGitlink, igorCheckedOut } = report.pins;
  if (report.pins.igorGitlinkConsistent === false || (igorCheckedOut && igorGitlink !== igorCheckedOut)) reasons.push(`checked-out Igor ${String(igorCheckedOut).slice(0, 12)} differs from the suite gitlink ${String(igorGitlink).slice(0, 12)}`);
  if (report.environment.node !== undefined && report.environment.node !== report.pins.node) reasons.push(`recorded Node ${report.environment.node} differs from the pin ${report.pins.node}`);
  for (const mismatch of report.environment.mismatches) reasons.push(mismatch);
  return { eligible: reasons.length === 0, reasons: [...new Set(reasons)] };
}

/**
 * Renders the human-readable report.
 * @param {object} report A `stex.verification.run.v1` report.
 * @returns {string}
 */
export function renderMarkdown(report) {
  const counts = tally(report.checks);
  const lines = [
    `## STEX gate: ${report.verdict.toUpperCase()}`,
    '',
    `Release evidence: **${report.releaseEvidence.eligible ? 'eligible' : 'not eligible'}**${report.releaseEvidence.reasons.length ? ` — ${report.releaseEvidence.reasons.join('; ')}` : ''}`,
    '',
    `Checks: ${counts.passed} passed, ${counts.failed} failed, ${counts.skipped} skipped, ${counts.unexecuted} unexecuted. Started ${report.startedAt}, ${Math.round(report.durationMs / 1000)} s.`,
    '',
    '| Repository | HEAD | Branch | Clean |',
    '| --- | --- | --- | --- |',
  ];
  for (const [key, repo] of Object.entries(report.repositories)) if (repo) lines.push(`| ${key} | \`${repo.head.slice(0, 12)}\` | ${repo.branch ?? 'detached'} | ${repo.dirty ? `no (${repo.changedPaths.length} paths)` : 'yes'} |`);
  lines.push('', '| Check | Status | Exit | Seconds | Skipped tests | Reason |', '| --- | --- | --- | --- | --- | --- |');
  for (const check of report.checks) lines.push(`| \`${check.id}\` | ${check.status} | ${check.exitCode ?? '—'} | ${(check.durationMs / 1000).toFixed(1)} | ${check.testSkips ?? '—'} | ${check.reason ?? ''} |`);
  const pins = report.pins;
  lines.push('', `Pins: Node ${pins.node}, Python ${pins.python}, ${pins.packageManager}; Igor gitlink \`${pins.igorGitlink?.slice(0, 12) ?? 'none'}\` (checked out \`${pins.igorCheckedOut?.slice(0, 12) ?? 'none'}\`); Hermes runtime gitlink \`${pins.hermesRuntimeGitlink?.slice(0, 12) ?? 'none'}\`.`);
  const environment = report.environment;
  lines.push(`Environment: ${environment.os.platform} ${environment.os.release} ${environment.os.arch}; Node ${environment.node}; pnpm ${environment.pnpm ?? 'unknown'}; ${environment.uv ?? 'uv unavailable'}${environment.ci ? `; GitHub Actions run ${environment.ci.runId}` : '; local'}.`);
  return `${lines.join('\n')}\n`;
}
