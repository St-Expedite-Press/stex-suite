import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { loadRuntimeProfiles, reconcileRuntimeProfiles, validateRuntimeProfiles } from '../src/runtime-profiles.mjs';

test('the runtime profile manifest maps every STEX profile and activates only Igor', async () => {
  const manifest = await loadRuntimeProfiles();
  assert.equal(manifest.profiles.length, 8);
  assert.deepEqual(manifest.profiles.filter((profile) => profile.active).map((profile) => profile.runtimeName), ['igor']);
  assert.equal(new Set(manifest.profiles.flatMap((profile) => profile.roleSlugs)).size, 18);
});

test('source profile specifications remain aligned with the runtime manifest and roster', async () => {
  const [manifest, roster] = await Promise.all([
    loadRuntimeProfiles(),
    readFile(new URL('../roster.yaml', import.meta.url), 'utf8').then(JSON.parse),
  ]);
  for (const runtimeProfile of manifest.profiles) {
    const specification = JSON.parse(await readFile(new URL(`../profiles/${runtimeProfile.stexProfile}/profile.json`, import.meta.url), 'utf8'));
    const roleSkills = [...new Set(roster.roles.filter((role) => runtimeProfile.roleSlugs.includes(role.slug)).flatMap((role) => role.skills))].sort();
    assert.equal(specification.id, runtimeProfile.stexProfile);
    assert.equal(specification.runtimeName, runtimeProfile.runtimeName);
    assert.equal(specification.provider, runtimeProfile.provider);
    assert.equal(specification.modelTier, runtimeProfile.modelTier);
    assert.deepEqual([...specification.skills].sort(), roleSkills);
    assert.deepEqual([...specification.roleSlugs].sort(), [...runtimeProfile.roleSlugs].sort());
    assert.match(specification.identityInstruction, /.+/);
  }
});

test('runtime reconciliation reports missing profiles without changing them', async () => {
  const manifest = await loadRuntimeProfiles();
  const providers = Object.fromEntries([['default', 'openrouter'], ...manifest.profiles.map((profile) => [profile.runtimeName, 'openrouter'])]);
  providers.architect = 'anthropic';
  const report = reconcileRuntimeProfiles(manifest, ['igor', 'architect'], providers, 'Hermes Agent test');
  assert.equal(report.ok, false);
  assert.deepEqual(report.missing, ['developer', 'designer', 'artist', 'editor', 'knowledge', 'auditor']);
  assert.deepEqual(report.providerMismatches, [{ name: 'architect', expected: 'openrouter', observed: 'anthropic' }]);
});

test('the manifest rejects a second active profile', async () => {
  const manifest = await loadRuntimeProfiles();
  const invalid = structuredClone(manifest);
  invalid.profiles[1].active = true;
  const roster = JSON.parse(await readFile(new URL('../roster.yaml', import.meta.url), 'utf8'));
  assert.throws(() => validateRuntimeProfiles(invalid, roster), /sole active/);
});
