import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loadRuntimeProfiles, reconcileRuntimeProfiles } from './runtime-profiles.mjs';

const execFileAsync = promisify(execFile);
const hermesBin = process.env.HERMES_BIN || 'hermes';

try {
  const [runtimeProfiles, versionResult, profileResult] = await Promise.all([
    loadRuntimeProfiles(),
    execFileAsync(hermesBin, ['--version']),
    execFileAsync(hermesBin, ['profile', 'list']),
  ]);
  const names = runtimeProfiles.profiles
    .map((profile) => profile.runtimeName)
    .filter((name) => new RegExp(`(?:^|\\r?\\n).*\\b${name}\\b`, 'm').test(profileResult.stdout));
  const providerEntries = await Promise.all([
    ['default', []],
    ...runtimeProfiles.profiles.map((profile) => [profile.runtimeName, ['-p', profile.runtimeName]]),
  ].map(async ([name, prefix]) => {
    const { stdout } = await execFileAsync(hermesBin, [...prefix, 'config', 'get', 'model.provider']);
    return [name, stdout.trim().split(/\r?\n/).at(-1)];
  }));
  const report = reconcileRuntimeProfiles(runtimeProfiles, names, Object.fromEntries(providerEntries), versionResult.stdout.trim());
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
} catch (error) {
  console.error(`Hermes runtime reconciliation failed: ${error.message}`);
  process.exitCode = 1;
}
