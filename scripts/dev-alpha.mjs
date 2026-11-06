import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const corepackEntry = path.join(path.dirname(process.execPath), 'node_modules', 'corepack', 'dist', 'corepack.js');
const shellPort = process.env.STEX_PANTHEON_PORT || process.env.STEX_LAB_PORT || '4300';
const frigePort = process.env.STEX_FRIGE_PORT || process.env.TEXGRAPH_PORT || '4310';
const seaxneatPort = process.env.SEAXNEAT_PORT || '4320';
const igorPort = process.env.STEX_IGOR_PORT || '4330';
const inferencePort = process.env.STEX_INFERENCE_PORT || '8100';
const shared = process.env.STEX_INFERENCE_SHARED_SECRET || 'stex-alpha-local';

function run(args, environment = {}) {
  const command = process.platform === 'win32' ? process.execPath : 'corepack';
  const invocation = process.platform === 'win32' ? [corepackEntry, ...args] : args;
  return spawn(command, invocation, {
    cwd: root,
    env: { ...process.env, ...environment },
    stdio: 'inherit',
    windowsHide: true,
  });
}

// Seaxneat and Igor serve production builds; build both before anything starts.
function build(directory, environment = {}) {
  const command = process.platform === 'win32' ? process.execPath : 'corepack';
  const args = ['pnpm', '--dir', directory, 'build'];
  const result = spawnSync(command, process.platform === 'win32' ? [corepackEntry, ...args] : args, {
    cwd: root,
    env: { ...process.env, ...environment },
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.status !== 0) process.exit(result.status || 1);
}
build('apps/seaxneat', { SEAXNEAT_BASE_PATH: '/seaxneat/' });
build('apps/igor');

const children = [
  run(['pnpm', '--dir', 'services/inference', 'dev'], {
    STEX_INFERENCE_PORT: inferencePort,
    STEX_INFERENCE_SHARED_SECRET: shared,
    STEX_HERMES_TRANSPORT: 'fake',
  }),
  run(['pnpm', '--dir', 'apps/frige', 'dev'], {
    STEX_FRIGE_PORT: frigePort,
    STEX_FRIGE_BASE_PATH: '/frige',
    STEX_FRIGE_SHELL_URL: '/home/',
    STEX_FRIGE_INFERENCE_MODE: 'fake',
    STEX_INFERENCE_URL: `http://127.0.0.1:${inferencePort}`,
    STEX_INFERENCE_SHARED_SECRET: shared,
  }),
  run(['pnpm', '--dir', 'apps/seaxneat', 'dev'], {
    SEAXNEAT_PORT: seaxneatPort,
  }),
  // Igor holds the inference secret; Pantheon only proxies to it.
  run(['pnpm', '--dir', 'apps/igor', 'dev'], {
    STEX_IGOR_PORT: igorPort,
    STEX_INFERENCE_URL: `http://127.0.0.1:${inferencePort}`,
    STEX_INFERENCE_SHARED_SECRET: shared,
  }),
  run(['pnpm', '--dir', 'apps/pantheon', 'dev'], {
    STEX_PANTHEON_PORT: shellPort,
    STEX_FRIGE_URL: `http://127.0.0.1:${frigePort}`,
    STEX_SEAXNEAT_URL: `http://127.0.0.1:${seaxneatPort}`,
    STEX_IGOR_URL: `http://127.0.0.1:${igorPort}`,
  }),
];

let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
  process.exitCode = code;
}
for (const child of children) child.once('exit', (code) => { if (!stopping && code) stop(code); });
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
console.log(`STEX Alpha is starting at http://127.0.0.1:${shellPort}/`);
