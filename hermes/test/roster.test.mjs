import assert from 'node:assert/strict';
import test from 'node:test';
import { loadRoster, validateRoster } from '../src/roster.mjs';

test('the authoritative Hermes roster declares bounded, resolvable roles', async () => {
  const roster = await loadRoster();
  assert.equal(roster.director, 'pantheon-director');
  assert.equal(roster.roles.length, 18);
  assert.equal(new Set(roster.roles.map((role) => role.slug)).size, 18);
});

test('the roster refuses unknown skill references', () => {
  assert.throws(() => validateRoster({ schemaVersion: 'stex.hermes.roster.v1', director: 'pantheon-director', profiles: ['pantheon-director', 'architect', 'developer', 'designer', 'artist', 'editor', 'knowledge', 'auditor'], roles: [] }, []), /18 declared roles/);
});
