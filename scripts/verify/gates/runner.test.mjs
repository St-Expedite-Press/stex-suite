/**
 * Negative and positive tests for the canonical gate runner. Each failure mode
 * (non-zero exit, misleading "PASS" text, timeout, missing prerequisite,
 * fail-fast, partial selection, content changing mid-run, stale evidence) must
 * make the aggregate gate exit non-zero and say why. Every case runs in a
 * disposable git repository with injected check manifests.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { countTestSkips, parseChain, releaseEligibility, tally, verdictOf } from './runner.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(here, '..', 'run-gates.mjs');
const realSuiteRoot = path.resolve(here, '..', '..', '..');
const scratch = [];
after(() => { for (const directory of scratch) rmSync(directory, { recursive: true, force: true }); });

/** Makes a disposable directory that is removed after the suite. */
function temporary(prefix) {
  const directory = mkdtempSync(path.join(os.tmpdir(), prefix));
  scratch.push(directory);
  return directory;
}

/** Runs git in a disposable repository with a fixed identity. */
function git(cwd, ...args) {
  const result = spawnSync('git', ['-c', 'user.name=Gate Test', '-c', 'user.email=gate-test@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

/** A committed, clean repository standing in for the suite. */
function repository() {
  const root = temporary('stex-gate-repo-');
  git(root, 'init', '-q');
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'gate-fixture', private: true, scripts: { test: 'corepack pnpm run test:a' } }));
  writeFileSync(path.join(root, 'source.txt'), 'original\n');
  git(root, 'add', '.');
  git(root, 'commit', '-q', '-m', 'fixture');
  return root;
}

/** A check that runs inline JavaScript with the current Node, no shell. */
const node = (id, code, extra = {}) => ({ id, repository: 'suite', command: [process.execPath, '-e', code], ...extra });

/**
 * Runs the CLI against a fixture repository with the given checks.
 * @returns {{ status: number|null, stdout: string, stderr: string, report: any, out: string }}
 */
function runGate(root, checks, ...flags) {
  const manifestDirectory = temporary('stex-gate-manifest-');
  const manifest = path.join(manifestDirectory, 'checks.json');
  writeFileSync(manifest, JSON.stringify(checks.map((check) => ({ cwd: root, ...check }))));
  const out = path.join(temporary('stex-gate-out-'), 'run');
  const result = spawnSync(process.execPath, [cli, '--suite-root', root, '--manifest', manifest, '--out', out, ...flags], { encoding: 'utf8' });
  const reportFile = path.join(out, 'report.json');
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, out, report: existsSync(reportFile) ? JSON.parse(readFileSync(reportFile, 'utf8')) : null };
}

/** Runs the CLI's stale-evidence check. */
function checkReport(root, out, ...flags) {
  return spawnSync(process.execPath, [cli, '--suite-root', root, '--check', path.join(out, 'report.json'), ...flags], { encoding: 'utf8' });
}

describe('gate definition', () => {
  test('parses a chain of pnpm run steps', () => {
    assert.deepEqual(parseChain('corepack pnpm run test:a && corepack pnpm run test:b-c'), ['test:a', 'test:b-c']);
  });
  test('refuses shell syntax and unknown steps instead of dropping them', () => {
    for (const script of ['corepack pnpm run a || true', 'corepack pnpm run a; corepack pnpm run b', 'corepack pnpm run a | tee log', 'echo ok && corepack pnpm run a', 'corepack pnpm run a > log', '']) {
      assert.throws(() => parseChain(script), undefined, script);
    }
  });
  test('the real suite and Igor gates parse and name every test step', () => {
    const suite = JSON.parse(readFileSync(path.join(realSuiteRoot, 'package.json'), 'utf8'));
    const names = parseChain(suite.scripts.test);
    assert.ok(names.includes('test:gates'), 'the suite gate runs the runner tests');
    for (const name of names) assert.ok(suite.scripts[name], `missing script ${name}`);
    const igorPackage = path.join(realSuiteRoot, 'stex-igor', 'package.json');
    if (existsSync(igorPackage)) parseChain(JSON.parse(readFileSync(igorPackage, 'utf8')).scripts.test);
  });
});

describe('status accounting', () => {
  test('counts skips from Node and pytest summaries, and keeps unknown distinct from zero', () => {
    assert.equal(countTestSkips('ℹ tests 4\nℹ skipped 2\n'), 2);
    assert.equal(countTestSkips('# skip 1\n'), 1);
    assert.equal(countTestSkips('======= 85 passed, 1 skipped in 3.20s =======\n'), 1);
    assert.equal(countTestSkips('..s..   [100%]\n97 passed, 1 skipped in 2.15s\n'), 1, 'pytest -q prints the summary unframed');
    assert.equal(countTestSkips('3 failed, 10 passed, 2 skipped, 1 warning in 4.00s\n'), 2);
    assert.equal(countTestSkips('all good\n'), null);
  });
  test('only an all-passed run is a pass', () => {
    const at = (status) => ({ status });
    assert.equal(verdictOf([at('passed'), at('passed')]), 'pass');
    assert.equal(verdictOf([at('passed'), at('failed'), at('skipped')]), 'fail');
    assert.equal(verdictOf([at('passed'), at('skipped')]), 'incomplete');
    assert.equal(verdictOf([at('passed'), at('unexecuted')]), 'incomplete');
    assert.equal(verdictOf([]), 'incomplete');
    assert.deepEqual(tally([at('passed'), at('failed'), at('unexecuted')]), { passed: 1, failed: 1, skipped: 0, unexecuted: 1 });
  });
});

describe('aggregate gate', () => {
  test('passes only when every check exits 0, and records revisions and pins', () => {
    const root = repository();
    const run = runGate(root, [node('suite/a', 'process.exit(0)'), node('suite/b', 'console.log("ok")')]);
    assert.equal(run.status, 0, run.stdout + run.stderr);
    assert.equal(run.report.verdict, 'pass');
    assert.equal(run.report.repositories.suite.head, git(root, 'rev-parse', 'HEAD'));
    assert.equal(run.report.repositories.suite.dirty, false);
    assert.ok(run.report.environment.os.platform);
    assert.deepEqual(run.report.gate, { scope: 'all', custom: true, only: null });
    assert.equal(run.report.releaseEvidence.eligible, false, 'an injected manifest is never release evidence');
    assert.ok(run.report.releaseEvidence.reasons.some((reason) => /injected check manifest/.test(reason)));
    assert.ok(readFileSync(path.join(run.out, 'report.md'), 'utf8').includes('STEX gate: PASS'));
  });

  test('one failing check fails the gate, keeps its exit status, and later checks still run', () => {
    const root = repository();
    const run = runGate(root, [node('suite/a', 'process.exit(0)'), node('suite/b', 'process.exit(3)'), node('suite/c', 'process.exit(0)')]);
    assert.equal(run.status, 1);
    assert.equal(run.report.verdict, 'fail');
    const [a, b, c] = run.report.checks;
    assert.equal(a.status, 'passed');
    assert.deepEqual([b.status, b.exitCode], ['failed', 3]);
    assert.equal(c.status, 'passed', 'the runner does not hide later results behind the first failure');
    assert.equal(run.report.releaseEvidence.eligible, false);
  });

  test('output that claims success never overrides a non-zero exit', () => {
    const root = repository();
    const run = runGate(root, [node('suite/liar', 'console.log("PASS: all 12 tests passed"); process.exitCode = 1')]);
    assert.equal(run.status, 1);
    assert.equal(run.report.checks[0].status, 'failed');
  });

  test('a check killed by a signal or that cannot start fails', () => {
    const root = repository();
    const run = runGate(root, [
      node('suite/abort', 'process.abort()'),
      { id: 'suite/missing', repository: 'suite', command: [path.join(root, 'no-such-program.exe')] },
    ]);
    assert.equal(run.status, 1);
    assert.deepEqual(run.report.checks.map((check) => check.status), ['failed', 'failed']);
  });

  test('a timed-out check is killed and fails', () => {
    const root = repository();
    const run = runGate(root, [node('suite/slow', 'setTimeout(() => {}, 60000)')], '--timeout-minutes', '0.02');
    assert.equal(run.status, 1);
    assert.match(run.report.checks[0].reason, /timed out/);
  });

  test('a timeout stops descendants that hold the output open, so the check still ends', () => {
    const root = repository();
    const grandchild = `require('node:child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'inherit' }); setTimeout(() => {}, 60000)`;
    const started = Date.now();
    const run = runGate(root, [node('suite/holds-pipe', grandchild)], '--timeout-minutes', '0.02');
    assert.equal(run.status, 1);
    assert.match(run.report.checks[0].reason, /timed out/);
    assert.ok(Date.now() - started < 30_000, 'the gate did not wait for the orphaned grandchild');
  });

  test('fail-fast leaves the remaining checks unexecuted, not passed', () => {
    const root = repository();
    const run = runGate(root, [node('suite/a', 'process.exit(2)'), node('suite/b', 'process.exit(0)')], '--fail-fast');
    assert.equal(run.status, 1);
    assert.deepEqual(run.report.checks.map((check) => check.status), ['failed', 'unexecuted']);
    assert.deepEqual(run.report.counts, { passed: 0, failed: 1, skipped: 0, unexecuted: 1 });
  });

  test('a missing prerequisite skips the check and the gate is incomplete, not passed', () => {
    const root = repository();
    const run = runGate(root, [node('suite/a', 'process.exit(0)'), node('suite/needs-tool', 'process.exit(0)', { requires: ['stex-no-such-tool-x9'] })]);
    assert.equal(run.status, 3);
    assert.equal(run.report.verdict, 'incomplete');
    assert.equal(run.report.checks[1].status, 'skipped');
  });

  test('a partial selection is incomplete', () => {
    const root = repository();
    const run = runGate(root, [node('suite/a', 'process.exit(0)'), node('suite/b', 'process.exit(0)')], '--only', 'suite/a');
    assert.equal(run.status, 3);
    assert.equal(run.report.checks[1].status, 'unexecuted');
  });

  test('content that changes while the gate runs fails the gate', () => {
    const root = repository();
    const run = runGate(root, [node('suite/mutate', `require('node:fs').writeFileSync(${JSON.stringify(path.join(root, 'source.txt'))}, 'changed\\n')`)]);
    assert.equal(run.status, 1);
    assert.equal(run.report.verdict, 'fail');
    assert.ok(run.report.contentChangedDuringRun.length > 0);
  });

  test('reports may not be written inside the tree under test', () => {
    const root = repository();
    const manifest = path.join(temporary('stex-gate-manifest-'), 'checks.json');
    writeFileSync(manifest, JSON.stringify([node('suite/a', 'process.exit(0)')]));
    const result = spawnSync(process.execPath, [cli, '--suite-root', root, '--manifest', manifest, '--out', path.join(root, 'evidence')], { encoding: 'utf8' });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /inside/);
  });

  test('usage errors exit 2', () => {
    const result = spawnSync(process.execPath, [cli, '--repo', 'everything'], { encoding: 'utf8' });
    assert.equal(result.status, 2);
  });
});

describe('stale evidence', () => {
  test('only the whole canonical gate can be release evidence', () => {
    const at = (gate) => releaseEligibility({ verdict: 'pass', gate, repositories: {}, pins: { igorGitlinkConsistent: true }, environment: { mismatches: [] } });
    assert.equal(at({ scope: 'all', custom: false }).eligible, true);
    assert.equal(at({ scope: 'igor', custom: false }).eligible, false);
    assert.equal(at({ scope: 'suite', custom: false }).eligible, false);
    assert.equal(at({ scope: 'all', custom: true }).eligible, false);
    assert.equal(at(undefined).eligible, false, 'a report without a recorded gate is not evidence');
  });

  test('a report stays current only while HEAD and the worktree are unchanged', () => {
    const root = repository();
    const run = runGate(root, [node('suite/a', 'process.exit(0)')]);
    assert.equal(run.status, 0);
    assert.equal(checkReport(root, run.out).status, 0);
    const release = checkReport(root, run.out, '--release');
    assert.equal(release.status, 1, 'current, but a one-check injected gate is not release evidence');
    assert.match(release.stderr, /NOT RELEASE EVIDENCE/);

    writeFileSync(path.join(root, 'source.txt'), 'edited\n');
    const edited = checkReport(root, run.out);
    assert.equal(edited.status, 4, 'an edited tracked file makes the report stale');
    assert.match(edited.stderr, /STALE/);

    writeFileSync(path.join(root, 'source.txt'), 'original\n');
    assert.equal(checkReport(root, run.out).status, 0, 'reverting restores the exact content');

    writeFileSync(path.join(root, 'added.txt'), 'new\n');
    assert.equal(checkReport(root, run.out).status, 4, 'an untracked file makes the report stale');

    git(root, 'add', 'added.txt');
    git(root, 'commit', '-q', '-m', 'second');
    assert.equal(checkReport(root, run.out).status, 4, 'a new commit makes the report stale');
  });

  test('a failed or dirty report is not accepted', () => {
    const root = repository();
    const failed = runGate(root, [node('suite/a', 'process.exit(1)')]);
    assert.equal(checkReport(root, failed.out).status, 1);

    writeFileSync(path.join(root, 'scratch.txt'), 'local\n');
    const dirty = runGate(root, [node('suite/a', 'process.exit(0)')]);
    assert.equal(dirty.status, 0);
    assert.equal(dirty.report.releaseEvidence.eligible, false);
    assert.equal(checkReport(root, dirty.out).status, 0, 'still current for local use');
    assert.equal(checkReport(root, dirty.out, '--release').status, 1, 'but never release evidence');
  });
});

describe('trusted CI', () => {
  test('workflows run bash with pipefail and the suite CI runs the canonical gate', () => {
    const workflows = [path.join(realSuiteRoot, '.github', 'workflows', 'ci.yml')];
    for (const name of ['ci.yml', 'deploy.yml']) {
      const file = path.join(realSuiteRoot, 'stex-igor', '.github', 'workflows', name);
      if (existsSync(file)) workflows.push(file);
    }
    /** Reads a workflow with LF line endings and without comment-only lines. */
    const read = (file) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n').replace(/^[ \t]*#.*\n/gm, '');
    for (const file of workflows) {
      // GitHub's explicit `shell: bash` runs `bash --noprofile --norc -eo pipefail {0}`.
      assert.match(read(file), /^defaults:\n {2}run:\n {4}shell: bash$/m, `${file} must default to bash`);
    }
    const suiteCi = read(workflows[0]);
    // Both repositories in one run: anything narrower is never release evidence.
    assert.match(suiteCi, /node scripts\/verify\/run-gates\.mjs --repo all /);
    assert.match(suiteCi, /corepack pnpm --dir stex-igor install --frozen-lockfile/);
    assert.doesNotMatch(suiteCi, /run: corepack pnpm test$/m, 'CI runs the gate through the runner, not the fail-fast chain');
  });
});
