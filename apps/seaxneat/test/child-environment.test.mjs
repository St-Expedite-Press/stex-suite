import assert from 'node:assert/strict';
import test from 'node:test';
import { childEnvironment, workspaceEnvironment } from '../src/child-environment.mjs';
import { defaultRunner } from '../src/project-store.mjs';

const PLANTED = {
  STEX_INFERENCE_SHARED_SECRET: 'planted-inference-secret',
  STEX_HERMES_API_KEY: 'planted-hermes-key',
  OPENROUTER_API_KEY: 'planted-provider-key',
  GITHUB_TOKEN: 'planted-github-token',
  npm_config__authToken: 'planted-npm-token',
  COREPACK_NPM_TOKEN: 'planted-corepack-token',
  STEX_SEAXNEAT_DATA_DIR: '/planted/data',
};

test('generated-workspace processes receive only allow-listed variables', () => {
  const source = { ...PLANTED, PATH: '/bin', Path: 'C:\\bin', SystemRoot: 'C:\\Windows', HOME: '/home/u', TEMP: '/tmp', LANG: 'C', HTTPS_PROXY: 'http://proxy.invalid', NEXT_BASE_PATH: '/elsewhere' };
  const environment = workspaceEnvironment('demo', source);
  for (const name of Object.keys(PLANTED)) assert.equal(environment[name], undefined, name);
  assert.deepEqual(environment, { PATH: '/bin', Path: 'C:\\bin', SystemRoot: 'C:\\Windows', HOME: '/home/u', TEMP: '/tmp', LANG: 'C', HTTPS_PROXY: 'http://proxy.invalid', NEXT_BASE_PATH: '/seaxneat/api/projects/demo/preview', NEXT_TELEMETRY_DISABLED: '1' });
  assert.deepEqual(childEnvironment({ EXTRA: '1' }, { OPENROUTER_API_KEY: 'x' }), { EXTRA: '1' });
});

test('the build runner does not pass Seaxneat secrets to the processes it starts', async (context) => {
  const saved = Object.fromEntries(Object.keys(PLANTED).map((name) => [name, process.env[name]]));
  context.after(() => { for (const [name, value] of Object.entries(saved)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; } });
  Object.assign(process.env, PLANTED);
  const result = await defaultRunner(process.execPath, ['-e', 'process.stdout.write(JSON.stringify(process.env))'], process.cwd(), { env: { NEXT_BASE_PATH: '/seaxneat/api/projects/demo/preview' } });
  assert.equal(result.ok, true, result.stderr);
  const seen = JSON.parse(result.stdout);
  for (const name of Object.keys(PLANTED)) assert.equal(seen[name], undefined, name);
  assert.ok(!Object.values(PLANTED).some((value) => result.stdout.includes(value)), 'a planted value reached the child');
  assert.equal(seen.NEXT_BASE_PATH, '/seaxneat/api/projects/demo/preview');
});
