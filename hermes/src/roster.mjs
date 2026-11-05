import { readFile } from 'node:fs/promises';

const requiredProfiles = ['pantheon-director', 'architect', 'developer', 'designer', 'artist', 'editor', 'knowledge', 'auditor'];

export function validateRoster(roster, skills) {
  if (roster?.schemaVersion !== 'stex.hermes.roster.v1') throw new Error('Unsupported Hermes roster schema.');
  if (!Array.isArray(roster.profiles) || roster.profiles.length !== requiredProfiles.length || requiredProfiles.some((profile) => !roster.profiles.includes(profile))) throw new Error('The Hermes profile catalog is incomplete.');
  if (!Array.isArray(skills) || new Set(skills).size !== skills.length) throw new Error('The Hermes skill catalog is invalid.');
  if (!Array.isArray(roster.roles) || roster.roles.length !== 18) throw new Error('The Hermes roster must contain the 18 declared roles.');
  const slugs = new Set();
  for (const role of roster.roles) {
    if (!role || !/^[a-z][a-z0-9-]{1,63}$/.test(role.slug) || slugs.has(role.slug)) throw new Error('A Hermes role slug is invalid or duplicated.');
    if (typeof role.name !== 'string' || !requiredProfiles.includes(role.profile) || !Array.isArray(role.tools) || !Array.isArray(role.skills) || !role.skills.every((skill) => skills.includes(skill)) || !Number.isInteger(role.budget) || role.budget < 1 || typeof role.approval !== 'string' || typeof role.output !== 'string') throw new Error(`Hermes role ${role.slug} is invalid.`);
    slugs.add(role.slug);
  }
  if (roster.director !== 'pantheon-director' || !slugs.has(roster.director)) throw new Error('The Pantheon Director is missing.');
  return roster;
}

export async function loadRoster(root = new URL('..', import.meta.url)) {
  const [roster, skills] = await Promise.all([
    readFile(new URL('roster.yaml', root), 'utf8').then(JSON.parse),
    readFile(new URL('skills.json', root), 'utf8').then(JSON.parse),
  ]);
  return validateRoster(roster, skills);
}
