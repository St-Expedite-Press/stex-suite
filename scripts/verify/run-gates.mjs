#!/usr/bin/env node
/**
 * Canonical verification gate for stex-suite and stex-igor.
 *
 * Usage:
 *   node scripts/verify/run-gates.mjs [--repo suite|igor|all] [--out DIR]
 *       [--fail-fast] [--only ID,...] [--timeout-minutes N]
 *       [--summary-file FILE] [--manifest FILE] [--verbose]
 *   node scripts/verify/run-gates.mjs --check REPORT.json [--release]
 *
 * Run mode executes every check of the selected gates as separate processes
 * (see gates/runner.mjs), writes `report.json` (`stex.verification.run.v1`),
 * `report.md` and one log per check to DIR (default: a new directory under the
 * system temporary directory), and exits:
 *   0 every check passed · 1 a check failed · 3 nothing failed but a check was
 *   skipped or never ran · 2 usage error · 130 interrupted.
 *
 * Check mode re-fingerprints both repositories and exits 4 when the report no
 * longer describes the checked-out content (a new commit, an edited, added or
 * removed file), 1 when its verdict was not `pass`, and with `--release` also
 * 1 when the report is not release evidence (dirty tree, gitlink drift or a
 * toolchain that differs from the pins). It never re-runs checks.
 *
 * `--manifest` replaces the gates with a JSON list of check definitions; the
 * runner's own tests use it to inject failing checks.
 */
import { mkdirSync, readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EXIT, REPORT_FORMAT, compareFingerprints, describeEnvironment, fingerprint, igorGate, killTree,
  readPins, releaseEligibility, renderMarkdown, runCheck, suiteGate, tally, verdictOf,
} from './gates/runner.mjs';

const defaultSuiteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Parses command-line flags; unknown flags are a usage error.
 * @param {string[]} argv
 */
function parseArgs(argv) {
  const options = { repo: 'all', out: null, failFast: false, only: null, timeoutMinutes: 30, summaryFile: null, manifest: null, check: null, release: false, verbose: false, suiteRoot: defaultSuiteRoot };
  const valueOf = (index, flag) => {
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`${flag} needs a value`);
    return value;
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    switch (flag) {
      case '--repo': options.repo = valueOf(index, flag); index += 1; break;
      case '--out': options.out = path.resolve(valueOf(index, flag)); index += 1; break;
      case '--fail-fast': options.failFast = true; break;
      case '--only': options.only = valueOf(index, flag).split(',').map((id) => id.trim()).filter(Boolean); index += 1; break;
      case '--timeout-minutes': options.timeoutMinutes = Number(valueOf(index, flag)); index += 1; break;
      case '--summary-file': options.summaryFile = valueOf(index, flag); index += 1; break;
      case '--manifest': options.manifest = path.resolve(valueOf(index, flag)); index += 1; break;
      case '--check': options.check = path.resolve(valueOf(index, flag)); index += 1; break;
      case '--release': options.release = true; break;
      case '--verbose': options.verbose = true; break;
      case '--suite-root': options.suiteRoot = path.resolve(valueOf(index, flag)); index += 1; break;
      default: throw new Error(`unknown argument ${flag}`);
    }
  }
  if (!['suite', 'igor', 'all'].includes(options.repo)) throw new Error('--repo must be suite, igor or all');
  if (!Number.isFinite(options.timeoutMinutes) || options.timeoutMinutes <= 0) throw new Error('--timeout-minutes must be a positive number');
  return options;
}

/**
 * The repositories a run fingerprints: the suite and, when checked out, Igor.
 * @param {string} suiteRoot
 */
function repositories(suiteRoot) {
  const igorRoot = path.join(suiteRoot, 'stex-igor');
  const hasIgor = existsSync(path.join(igorRoot, 'package.json'));
  return { suiteRoot, igorRoot: hasIgor ? igorRoot : null };
}

/**
 * Re-checks an existing report against the checkout without running anything.
 * @param {ReturnType<typeof parseArgs>} options
 * @returns {number} Exit code.
 */
function checkReport(options) {
  const report = JSON.parse(readFileSync(options.check, 'utf8'));
  if (report.format !== REPORT_FORMAT) { console.error(`not a ${REPORT_FORMAT} report: ${options.check}`); return EXIT.usage; }
  const { suiteRoot, igorRoot } = repositories(options.suiteRoot);
  const current = { suite: fingerprint(suiteRoot), igor: igorRoot && report.repositories.igor ? fingerprint(igorRoot) : null };
  const recorded = { suite: report.repositories.suite ?? null, igor: report.repositories.igor ?? null };
  const differences = compareFingerprints(recorded, current);
  if (differences.length) {
    console.error('STALE: the report does not describe the checked-out content.');
    for (const difference of differences) console.error(`  - ${difference}`);
    return EXIT.stale;
  }
  if (report.verdict !== 'pass') { console.error(`FAIL: the report's verdict is ${report.verdict}.`); return EXIT.fail; }
  if (options.release && !report.releaseEvidence?.eligible) {
    console.error(`NOT RELEASE EVIDENCE: ${(report.releaseEvidence?.reasons || ['unknown']).join('; ')}`);
    return EXIT.fail;
  }
  console.log(`CURRENT: the report (${report.verdict}) describes the checked-out content${options.release ? ' and is release evidence' : ''}.`);
  return EXIT.pass;
}

/**
 * Runs the selected gates and writes the report.
 * @param {ReturnType<typeof parseArgs>} options
 * @returns {Promise<number>} Exit code.
 */
async function runGates(options) {
  const { suiteRoot, igorRoot } = repositories(options.suiteRoot);
  /** @type {import('./gates/runner.mjs').CheckDefinition[]} */
  let checks;
  if (options.manifest) {
    checks = JSON.parse(readFileSync(options.manifest, 'utf8')).map((check) => ({ ...check, cwd: path.resolve(path.dirname(options.manifest), check.cwd || '.') }));
  } else {
    checks = [];
    if (options.repo !== 'igor') checks.push(...suiteGate(suiteRoot));
    if (options.repo !== 'suite') {
      if (!igorRoot) throw new Error('stex-igor is not checked out; run git submodule update --init or choose --repo suite');
      checks.push(...igorGate(igorRoot));
    }
  }
  const out = options.out ?? path.join(os.tmpdir(), 'stex-verification', new Date().toISOString().replace(/[:.]/g, '-'));
  // Writing evidence into the tree under test would change the content it fingerprints.
  for (const root of [suiteRoot, igorRoot].filter(Boolean)) {
    const relative = path.relative(root, out);
    if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) throw new Error(`--out ${out} is inside ${root}; write reports outside the repositories (the default is the system temporary directory)`);
  }
  mkdirSync(path.join(out, 'logs'), { recursive: true });

  const before = { suite: fingerprint(suiteRoot), igor: igorRoot ? fingerprint(igorRoot) : null };
  const pins = readPins(suiteRoot, igorRoot);
  const environment = describeEnvironment(pins);
  const startedAt = new Date().toISOString();
  const started = Date.now();
  /** @type {import('./gates/runner.mjs').CheckResult[]} */
  const results = [];
  let running = null;
  let interrupted = false;
  const onSignal = () => { interrupted = true; if (running) killTree(running); };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  for (const check of checks) {
    const unexecuted = (reason) => ({ id: check.id, repository: check.repository, command: check.command, status: 'unexecuted', exitCode: null, signal: null, reason, durationMs: 0, testSkips: null, log: null });
    if (options.only && !options.only.includes(check.id)) { results.push(unexecuted('not selected (--only)')); continue; }
    if (interrupted) { results.push(unexecuted('the run was interrupted')); continue; }
    if (options.failFast && results.some((result) => result.status === 'failed')) { results.push(unexecuted('an earlier check failed (--fail-fast)')); continue; }
    process.stdout.write(`… ${check.id}\n`);
    const { result, output } = await runCheck(check, {
      timeoutMs: options.timeoutMinutes * 60_000,
      onOutput: options.verbose ? (text) => process.stdout.write(text) : undefined,
      onSpawn: (child) => { running = child; },
    });
    running = null;
    if (interrupted && result.status === 'passed') Object.assign(result, { status: 'failed', reason: 'the run was interrupted' });
    const log = path.join(out, 'logs', `${check.id.replace(/[^\w.-]+/g, '_')}.log`);
    writeFileSync(log, output);
    result.log = log;
    results.push(result);
    const mark = { passed: 'PASS', failed: 'FAIL', skipped: 'SKIP' }[result.status];
    process.stdout.write(`${mark} ${check.id} (${(result.durationMs / 1000).toFixed(1)} s${result.reason ? `; ${result.reason}` : ''})\n`);
    if (result.status === 'failed' && !options.verbose) {
      const tail = output.trimEnd().split(/\r?\n/).slice(-40).join('\n');
      process.stdout.write(`--- last lines of ${log}\n${tail}\n---\n`);
    }
  }

  // A tree that changed while the gate ran was not the tree it tested.
  const after = { suite: fingerprint(suiteRoot), igor: igorRoot ? fingerprint(igorRoot) : null };
  const drift = compareFingerprints(before, after);
  const verdict = drift.length ? 'fail' : verdictOf(results);
  const report = {
    format: REPORT_FORMAT,
    startedAt,
    durationMs: Date.now() - started,
    verdict,
    counts: tally(results),
    contentChangedDuringRun: drift,
    repositories: before,
    pins,
    environment,
    checks: results,
  };
  report.releaseEvidence = releaseEligibility(report);
  if (drift.length) report.releaseEvidence = { eligible: false, reasons: [...report.releaseEvidence.reasons, ...drift.map((item) => `changed during the run: ${item}`)] };
  writeFileSync(path.join(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  const markdown = renderMarkdown(report);
  writeFileSync(path.join(out, 'report.md'), markdown);
  if (options.summaryFile) appendFileSync(options.summaryFile, markdown);
  process.stdout.write(`\n${markdown}\nReport: ${path.join(out, 'report.json')}\n`);
  if (interrupted) return EXIT.interrupted;
  return { pass: EXIT.pass, fail: EXIT.fail, incomplete: EXIT.incomplete }[verdict];
}

let options;
try { options = parseArgs(process.argv.slice(2)); } catch (error) {
  console.error(`run-gates: ${error.message}`);
  process.exit(EXIT.usage);
}
try {
  process.exitCode = options.check ? checkReport(options) : await runGates(options);
} catch (error) {
  console.error(`run-gates: ${error.message}`);
  process.exitCode = EXIT.usage;
}
