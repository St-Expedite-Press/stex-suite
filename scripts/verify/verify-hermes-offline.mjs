/**
 * A5: reproducible Hermes runtime, offline start and restart, and rollback without egress.
 *
 * Builds the staging Igor-host image (deploy/staging-compose/igor-host) with --no-cache --pull,
 * so every layer, the managed Hermes install (`setup-hermes.sh --runtime-only` at the candidate
 * pin) and its dependencies are resolved fresh, exactly as a release would. Then, with NO network
 * at all (`docker run --network none`), it starts the igor-profile gateway, checks health, stops it
 * with SIGTERM as systemd does, and starts it again.
 *
 * Rollback: a one-off container WITH network keeps the candidate runtime as a retained artifact
 * (a copy of ~hermes/hermes-agent and of the managed tool store), then installs the current
 * production pin by the VM procedure (git checkout + setup-hermes.sh --runtime-only). With no
 * network again it tries (a) starting the production pin, and (b) switching back to the retained
 * candidate artifact. Each outcome is recorded as observed, pass or not.
 *
 *   node scripts/verify/verify-hermes-offline.mjs [--hermes-source DIR] [--reuse-images]
 *
 * Needs Docker and a checkout of the candidate pin (default ~/stex-wt/hermes/ctx-managed/hermes-agent).
 * Builds need the network; every start runs offline. Synthetic configuration only; no provider,
 * no model call, no production contact. Prints a JSON report; exits non-zero when the candidate
 * cannot start or restart offline.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const pins = JSON.parse(readFileSync(path.join(root, 'stex-igor', 'hermes', 'eval', 'pins.json'), 'utf8'));
const argValue = (flag) => { const index = process.argv.indexOf(flag); return index > 0 ? process.argv[index + 1] : undefined; };
const source = path.resolve(argValue('--hermes-source') || path.join(os.homedir(), 'stex-wt', 'hermes', 'ctx-managed', 'hermes-agent'));
const reuse = process.argv.includes('--reuse-images');
const WORKSPACE = 'stex-a5-igor-workspace'; const HOST = 'stex-a5-hermes-host'; const ROLLBACK = 'stex-a5-hermes-rollback';
const env = { ...process.env, MSYS_NO_PATHCONV: '1', DOCKER_BUILDKIT: '1' };
const report = { candidate: pins.candidate, production: pins.current, checks: [], observations: {}, limits: [] };
const pass = (name, detail) => report.checks.push(detail === undefined ? name : { name, detail });

/** Runs docker and returns trimmed stdout, or throws with its stderr tail. */
function docker(args, { input, allowFail = false, timeout = 3_600_000 } = {}) {
  const result = spawnSync('docker', args, { encoding: 'utf8', env, input, timeout, maxBuffer: 256 * 1024 * 1024 });
  if (!allowFail && result.status !== 0) throw new Error(`docker ${args.slice(0, 3).join(' ')} failed (${result.status}): ${String(result.stderr).trim().split('\n').slice(-15).join('\n')}`);
  return { status: result.status, stdout: String(result.stdout).trim(), stderr: String(result.stderr).trim() };
}
const rm = (name) => docker(['rm', '-f', name], { allowFail: true });

// The in-container gateway check (profile secrets as on the VM; start, health, SIGTERM, start, health).
const apiKey = randomBytes(32).toString('hex');
// Bash in the container needs LF line endings whatever the checkout used.
const gatewayCheck = readFileSync(path.join(root, 'deploy', 'staging-compose', 'igor-host', 'offline-gateway-check.sh'), 'utf8').split(String.fromCharCode(13)).join('');

/** Runs the gateway check in a fresh container with no network; returns its output and status. */
function offlineGateway(image, name, prelude = '') {
  rm(name);
  const result = docker(['run', '--name', name, '--network', 'none', '-e', `KEY=${apiKey}`, '--entrypoint', 'bash', image, '-c', `${prelude}\n${gatewayCheck}`], { allowFail: true, timeout: 900_000 });
  rm(name);
  return { status: result.status, output: `${result.stdout}\n${result.stderr}`.trim() };
}

// 1. Clean, uncached build of the candidate runtime (network for the build only).
assert.equal(execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), pins.candidate.sha, 'the Hermes source checkout is not at the candidate pin');
const started = Date.now();
if (!reuse) {
  docker(['build', '--no-cache', '--pull', '-f', 'deploy/staging-compose/node.Dockerfile', '--target', 'igor', '-t', WORKSPACE, root.replaceAll('\\', '/')]);
  docker(['build', '--no-cache', '--pull', '-f', 'deploy/staging-compose/igor-host/Dockerfile',
    '--build-context', `hermes=${source.replaceAll('\\', '/')}`, '--build-context', `hermes-git=${path.join(source, '.git').replaceAll('\\', '/')}`,
    '--build-context', `igor-workspace=docker-image://${WORKSPACE}`,
    '--build-arg', `STEX_STAGING_HERMES_SHA=${pins.candidate.sha}`, '--build-arg', 'STEX_STAGING_INSTALL_CONNECTOR=0',
    '-t', HOST, root.replaceAll('\\', '/')]);
}
report.build = { uncached: !reuse, seconds: Math.round((Date.now() - started) / 1000), image: docker(['image', 'inspect', HOST, '--format', '{{.Id}}']).stdout };
// As the checkout's owner (git refuses another user's repository), and a git failure fails the check:
// an empty status must come from a successful `git status`, never from an error.
const runtime = docker(['run', '--rm', '--network', 'none', '-u', 'hermes', '--entrypoint', 'bash', HOST, '-c',
  'set -euo pipefail; git -C /home/hermes/hermes-agent rev-parse HEAD; s="$(git -C /home/hermes/hermes-agent status --porcelain)"; test -z "$s" && echo clean']).stdout.split('\n');
assert.deepEqual(runtime, [pins.candidate.sha, 'clean']);
pass('clean uncached build installs the candidate runtime at its exact pin', { seconds: report.build.seconds, connector: 'not installed (production default)' });

// 2. Offline start and restart of the candidate.
const candidate = offlineGateway(HOST, 'stex-a5-offline');
report.observations.candidateOffline = candidate.output.split('\n').filter((line) => /^(interfaces|RUNTIME|START_|STOP|NETWORK|  )/.test(line));
assert.doesNotMatch(candidate.output, /NETWORK_REACHABLE/, 'the offline container reached the network');
assert.equal(candidate.status, 0, candidate.output.slice(-1500));
assert.match(candidate.output, /START_first=ok/); assert.match(candidate.output, /START_second=ok/);
pass('candidate gateway starts, stops on SIGTERM and starts again with no network at all');

// 3. Rollback artifacts: keep the candidate runtime, install the production pin with network (as the VM procedure does).
rm('stex-a5-rollback-build');
docker(['run', '--name', 'stex-a5-rollback-build', '--entrypoint', 'bash', HOST, '-c', [
  'set -euo pipefail',
  'H=(setpriv --reuid=hermes --regid=hermes --init-groups env HOME=/home/hermes USER=hermes LOGNAME=hermes)',
  // The retained artifact: the whole runtime checkout (with its managed environment) and the tool store.
  '"${H[@]}" bash -c "cp -a ~/hermes-agent ~/retained-candidate-agent && mkdir -p ~/retained-candidate-home && for d in tools installs; do [ -d ~/.hermes/\\$d ] && cp -a ~/.hermes/\\$d ~/retained-candidate-home/; done; true"',
  `"\${H[@]}" bash -c "cd ~/hermes-agent && git fetch -q --depth 1 origin ${pins.current.sha} && git checkout -q --detach ${pins.current.sha} && test \\"\\$(git rev-parse HEAD)\\" = ${pins.current.sha} && ./setup-hermes.sh --runtime-only >/tmp/setup.log 2>&1 || { tail -20 /tmp/setup.log; exit 1; }"`,
].join('\n')], { timeout: 1_800_000 });
docker(['commit', 'stex-a5-rollback-build', ROLLBACK]);
rm('stex-a5-rollback-build');
pass('production pin installed by the VM procedure (git checkout + setup-hermes.sh --runtime-only), with network, beside a retained copy of the candidate runtime');

// 3a. The production pin with no network.
const production = offlineGateway(ROLLBACK, 'stex-a5-production-offline');
report.observations.productionPinOffline = { status: production.status, lines: production.output.split('\n').filter((line) => /^(RUNTIME|START_|STOP|  )/.test(line)) };
// 3b. Switching back to the retained candidate artifact with no network.
const swap = [
  'H=(setpriv --reuid=hermes --regid=hermes --init-groups env HOME=/home/hermes USER=hermes LOGNAME=hermes)',
  '"${H[@]}" bash -c "mv ~/hermes-agent ~/production-agent && mv ~/retained-candidate-agent ~/hermes-agent && for d in tools installs; do if [ -d ~/retained-candidate-home/\\$d ]; then rm -rf ~/.hermes/\\$d && cp -a ~/retained-candidate-home/\\$d ~/.hermes/; fi; done"',
].join('\n');
const retained = offlineGateway(ROLLBACK, 'stex-a5-retained-offline', swap);
report.observations.retainedCandidateOffline = { status: retained.status, lines: retained.output.split('\n').filter((line) => /^(RUNTIME|START_|STOP|  )/.test(line)) };

report.conclusions = {
  candidateOffline: 'starts and restarts with no network',
  productionPinOffline: production.status === 0 ? 'starts and restarts with no network' : `does not start offline (exit ${production.status})`,
  retainedArtifactSwitchOffline: retained.status === 0 ? 'a retained runtime directory plus tool store restores the candidate with no network' : `retained-artifact switch failed offline (exit ${retained.status})`,
};
report.limits.push('Docker on a developer machine, Debian 12 like the VM; the gateway is started, health-checked and stopped but no model turn is made (no provider).');
for (const name of [ROLLBACK]) docker(['image', 'rm', name], { allowFail: true });
console.log(JSON.stringify(report, null, 2));
