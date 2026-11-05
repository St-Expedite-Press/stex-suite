import { readFile } from 'node:fs/promises';

const runtimeNames = ['igor', 'architect', 'developer', 'designer', 'artist', 'editor', 'knowledge', 'auditor'];

export function validateRuntimeProfiles(runtimeProfiles, roster) {
  if (runtimeProfiles?.schemaVersion !== 'stex.hermes.runtime-profiles.v1') throw new Error('Unsupported Hermes runtime-profile schema.');
  if (runtimeProfiles.requiredProvider !== 'openrouter') throw new Error('Hermes runtime profiles must use OpenRouter exclusively.');
  if (!Array.isArray(runtimeProfiles.profiles) || runtimeProfiles.profiles.length !== runtimeNames.length) throw new Error('The Hermes runtime profile catalog is incomplete.');

  const stexProfiles = new Set(roster.profiles);
  const rosterRoles = new Set(roster.roles.map((role) => role.slug));
  const seenRuntimeNames = new Set();
  const seenStexProfiles = new Set();
  let activeProfiles = 0;

  for (const profile of runtimeProfiles.profiles) {
    if (!profile || !runtimeNames.includes(profile.runtimeName) || seenRuntimeNames.has(profile.runtimeName)) throw new Error('A Hermes runtime profile name is invalid or duplicated.');
    if (!stexProfiles.has(profile.stexProfile) || seenStexProfiles.has(profile.stexProfile)) throw new Error('A Hermes runtime profile mapping is invalid or duplicated.');
    if (typeof profile.active !== 'boolean' || profile.provider !== runtimeProfiles.requiredProvider || !['high', 'medium'].includes(profile.modelTier) || !Array.isArray(profile.skills) || !Array.isArray(profile.roleSlugs) || profile.roleSlugs.length === 0) throw new Error(`Hermes runtime profile ${profile.runtimeName} is invalid.`);
    if (new Set(profile.roleSlugs).size !== profile.roleSlugs.length || !profile.roleSlugs.every((roleSlug) => rosterRoles.has(roleSlug))) throw new Error(`Hermes runtime profile ${profile.runtimeName} has an unknown or duplicated role.`);
    if (profile.roleSlugs.some((roleSlug) => roster.roles.find((role) => role.slug === roleSlug).profile !== profile.stexProfile)) throw new Error(`Hermes runtime profile ${profile.runtimeName} maps a role to the wrong STEX profile.`);
    seenRuntimeNames.add(profile.runtimeName);
    seenStexProfiles.add(profile.stexProfile);
    if (profile.active) activeProfiles += 1;
  }

  if (activeProfiles !== 1 || !runtimeProfiles.profiles.find((profile) => profile.runtimeName === 'igor')?.active) throw new Error('Igor must be the sole active runtime profile.');
  if (runtimeNames.some((name) => !seenRuntimeNames.has(name)) || stexProfiles.size !== seenStexProfiles.size) throw new Error('The Hermes runtime profile catalog is incomplete.');
  return runtimeProfiles;
}

export function reconcileRuntimeProfiles(runtimeProfiles, observedRuntimeNames, observedProviders = {}, runtimeVersion = 'unknown') {
  const observed = new Set(observedRuntimeNames);
  const expected = runtimeProfiles.profiles.map((profile) => profile.runtimeName);
  const missing = expected.filter((name) => !observed.has(name));
  const expectedProviders = Object.fromEntries([['default', runtimeProfiles.requiredProvider], ...runtimeProfiles.profiles.map((profile) => [profile.runtimeName, profile.provider])]);
  const providerMismatches = Object.entries(expectedProviders).filter(([name, provider]) => observedProviders[name] !== provider).map(([name, provider]) => ({ name, expected: provider, observed: observedProviders[name] ?? 'unknown' }));
  return { runtimeVersion, expected, observed: [...observed].sort(), observedProviders, missing, providerMismatches, ok: missing.length === 0 && providerMismatches.length === 0 };
}

export async function loadRuntimeProfiles(root = new URL('..', import.meta.url)) {
  const [runtimeProfiles, roster] = await Promise.all([
    readFile(new URL('runtime-profiles.json', root), 'utf8').then(JSON.parse),
    readFile(new URL('roster.yaml', root), 'utf8').then(JSON.parse),
  ]);
  return validateRuntimeProfiles(runtimeProfiles, roster);
}
