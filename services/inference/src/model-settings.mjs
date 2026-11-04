import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

// The agent roster and each agent's model stack: an ordered list of OpenRouter
// model ids, tried in turn when a model is unavailable. Kept in the gateway's
// ignored state directory; it holds model choices, never credentials.

// Roles the gateway knows. Only roles listed in USED_BY are called today; the
// others are kept so a stack is ready when that agent is built.
export const USED_BY = { director: ['TexGraph conversations', 'TexGraph page turns', 'Book interview'] };
const BUILT_IN = [
  { id: 'director', name: 'Director (Hermes)', description: 'Leads conversations and proposes changes.' },
  { id: 'worker-general', name: 'General worker', description: 'Bounded research, extraction, verification and classification.' },
  { id: 'worker-visual', name: 'Visual worker', description: 'Image and visual-comparison tasks.' },
  { id: 'embedding', name: 'Embedding', description: 'Text embeddings for retrieval.' },
];

const ROLE_ID = /^[a-z][a-z0-9-]{1,40}$/;
// OpenRouter ids look like "vendor/model" with an optional ":variant".
const MODEL_ID = /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*(?::[a-z0-9._-]+)?$/i;
const text = (value, maximum) => (typeof value === 'string' ? value.trim().slice(0, maximum) : '');

export function defaultSettings() {
  return { version: 1, roles: BUILT_IN.map((role) => ({ ...role, stack: [], temperature: null, maxOutputTokens: null })) };
}

// Strict validation for a save. Built-in roles cannot be removed; custom roles can.
export function validateSettings(input, { knownModels = null } = {}) {
  const errors = [];
  if (!input || typeof input !== 'object' || !Array.isArray(input.roles)) return { settings: null, errors: ['Settings must list roles.'] };
  if (input.roles.length > 24) errors.push('At most 24 agent roles.');
  const roles = []; const seen = new Set();
  for (const raw of input.roles.slice(0, 24)) {
    const id = text(raw?.id, 41);
    if (!ROLE_ID.test(id)) { errors.push(`Role id ${JSON.stringify(id)} must be lowercase letters, digits and hyphens.`); continue; }
    if (seen.has(id)) { errors.push(`Role ${id} appears twice.`); continue; }
    seen.add(id);
    const name = text(raw.name, 60) || id;
    const stack = Array.isArray(raw.stack) ? [...new Set(raw.stack.map((model) => text(model, 120)))] : [];
    if (stack.length > 6) errors.push(`${name}: at most 6 models in a stack.`);
    for (const model of stack) {
      if (!MODEL_ID.test(model)) errors.push(`${name}: ${JSON.stringify(model)} is not an OpenRouter model id.`);
      else if (knownModels && !knownModels.has(model)) errors.push(`${name}: OpenRouter has no model ${model}.`);
    }
    const temperature = raw.temperature === null || raw.temperature === undefined || raw.temperature === '' ? null : Number(raw.temperature);
    if (temperature !== null && !(temperature >= 0 && temperature <= 2)) errors.push(`${name}: temperature must be between 0 and 2.`);
    const maxOutputTokens = raw.maxOutputTokens === null || raw.maxOutputTokens === undefined || raw.maxOutputTokens === '' ? null : Number(raw.maxOutputTokens);
    if (maxOutputTokens !== null && !(Number.isInteger(maxOutputTokens) && maxOutputTokens >= 1 && maxOutputTokens <= 64_000)) errors.push(`${name}: output tokens must be a whole number from 1 to 64,000.`);
    roles.push({ id, name, description: text(raw.description, 200), stack: stack.slice(0, 6), temperature, maxOutputTokens });
  }
  for (const role of BUILT_IN) if (!seen.has(role.id)) errors.push(`The built-in role ${role.name} cannot be removed.`);
  return errors.length ? { settings: null, errors } : { settings: { version: 1, roles }, errors: [] };
}

export function createModelSettings({ file, envModel = '' }) {
  let current = defaultSettings();
  let writing = Promise.resolve();
  // A role's effective stack; the director falls back to OPENROUTER_MODEL when it has none.
  const profile = (roleId) => {
    const role = current.roles.find((entry) => entry.id === roleId);
    const stack = role?.stack?.length ? role.stack : roleId === 'director' && envModel ? [envModel] : [];
    return { roleId, stack, temperature: role?.temperature ?? null, maxOutputTokens: role?.maxOutputTokens ?? null, fromEnvironment: Boolean(roleId === 'director' && !role?.stack?.length && envModel) };
  };
  return {
    async load() {
      let raw;
      try { raw = await readFile(file, 'utf8'); } catch { return current; /* no saved settings yet */ }
      let parsed = null; try { parsed = JSON.parse(raw); } catch { /* reported below */ }
      // Built-in roles added after a file was saved are merged in before validating.
      if (Array.isArray(parsed?.roles)) parsed.roles.push(...defaultSettings().roles.filter((role) => !parsed.roles.some((entry) => entry?.id === role.id)));
      const { settings, errors } = validateSettings(parsed);
      if (settings) current = settings;
      else console.warn(`Ignoring ${file}: ${errors.join(' ')}`);
      return current;
    },
    get: () => ({ ...current, usedBy: USED_BY, builtIn: BUILT_IN.map((role) => role.id), environmentModel: envModel || null }),
    profile,
    async save(input, options) {
      const { settings, errors } = validateSettings(input, options);
      if (!settings) return { settings: null, errors };
      // Saves are written one at a time, each through a temporary file.
      const write = writing.then(async () => {
        await mkdir(path.dirname(file), { recursive: true });
        const temporary = `${file}.${process.pid}.tmp`;
        await writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
        await rename(temporary, file);
        current = settings;
      });
      writing = write.catch(() => {});
      await write;
      return { settings: current, errors: [] };
    },
  };
}
