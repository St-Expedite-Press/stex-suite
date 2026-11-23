/** Suite local development source that builds, launches and stops the deterministic loopback stack. */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { get } from 'node:http';
import path from 'node:path';

const root = process.cwd();
const corepackEntry = path.join(path.dirname(process.execPath), 'node_modules', 'corepack', 'dist', 'corepack.js');
const shellPort = process.env.STEX_PANTHEON_PORT || '4300';
const frigePort = process.env.STEX_FRIGE_PORT || process.env.TEXGRAPH_PORT || '4310';
const seaxneatPort = process.env.SEAXNEAT_PORT || '4320';
const igorPort = process.env.STEX_IGOR_PORT || '4330';
const inferencePort = process.env.STEX_INFERENCE_PORT || '8100';
const platformPort = process.env.STEX_PLATFORM_PORT || '4340';
const useInferenceGateway = process.argv.includes('--use-inference-gateway');
const shared = process.env.STEX_INFERENCE_SHARED_SECRET || 'stex-alpha-local';
const inferenceUrl = useInferenceGateway
  ? await externalInferenceOrigin(process.env.STEX_INFERENCE_URL, process.env.STEX_INFERENCE_SHARED_SECRET)
  : `http://127.0.0.1:${inferencePort}`;
const privateEnvironment = new Set(['OPENROUTER_API_KEY', 'API_SERVER_KEY', 'STEX_HERMES_API_KEY', 'STEX_HERMES_TOKEN', 'STEX_INFERENCE_SHARED_SECRET']);
const childEnvironment = { ...process.env };
for (const name of Object.keys(childEnvironment)) {
  if (privateEnvironment.has(name.toUpperCase())) delete childEnvironment[name];
}

/** Checks the separately started loopback inference gateway without probing Hermes or sending a turn. */
async function externalInferenceOrigin(value, secret) {
  if (!secret?.trim()) throw new Error('--use-inference-gateway requires STEX_INFERENCE_SHARED_SECRET.');
  let url;
  try { url = new URL(value); } catch { throw new Error('--use-inference-gateway requires STEX_INFERENCE_URL.'); }
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.pathname !== '/' || url.username || url.password || url.search || url.hash) {
    throw new Error('STEX_INFERENCE_URL must be a loopback HTTP origin.');
  }
  let readiness;
  try {
    readiness = await gatewayRead(new URL('/v1/hermes/health', url));
  } catch { throw new Error('The separately started inference gateway did not answer its readiness check.'); }
  const health = readiness.health;
  if (readiness.status !== 200 || !health?.ok || health.contract !== 'stex.hermes.turn.v1' || !['fake', 'remote'].includes(health.transport) || !health.configured || health.agentConfig === 'unavailable') {
    throw new Error('The separately started inference gateway is not ready. Check its configuration before starting Pantheon.');
  }
  let authorization;
  try {
    authorization = await gatewayRead(new URL('/v1/agent-config', url), secret);
  } catch { throw new Error('The inference gateway did not answer the shared-token check.'); }
  if (authorization.status !== 200) throw new Error('The inference gateway did not authorize this workspace. Check STEX_INFERENCE_SHARED_SECRET and gateway configuration.');
  return url.origin;
}

/** Reads one bounded loopback response without following redirects or retaining company configuration. */
async function gatewayRead(url, secret) {
  const response = await new Promise((resolve, reject) => {
    const headers = secret ? { 'x-stex-inference-token': secret } : {};
    get(url, { headers, agent: false, signal: AbortSignal.timeout(3000) }, resolve).once('error', reject);
  });
  const limit = secret ? 512_000 : 16_384;
  const chunks = [];
  let bytes = 0;
  for await (const chunk of response) {
    bytes += chunk.byteLength;
    if (bytes > limit) throw new Error('Unexpected inference gateway response size.');
    if (!secret) chunks.push(chunk);
  }
  return { status: response.statusCode, health: secret ? null : JSON.parse(Buffer.concat(chunks).toString('utf8')) };
}

/** Starts a child pnpm command with its selected application environment. */
function run(args, environment = {}) {
  const command = process.platform === 'win32' ? process.execPath : 'corepack';
  const invocation = process.platform === 'win32' ? [corepackEntry, ...args] : args;
  return spawn(command, invocation, {
    cwd: root,
    env: { ...childEnvironment, ...environment },
    stdio: 'inherit',
    windowsHide: true,
  });
}

// Seaxneat and Igor serve production builds; build both before anything starts.
/** Builds a workspace before service startup and exits on a failed build. */
function build(directory, environment = {}) {
  const command = process.platform === 'win32' ? process.execPath : 'corepack';
  const args = ['pnpm', '--dir', directory, 'build'];
  const result = spawnSync(command, process.platform === 'win32' ? [corepackEntry, ...args] : args, {
    cwd: root,
    env: { ...childEnvironment, ...environment },
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.status !== 0) process.exit(result.status || 1);
}
build('apps/seaxneat', { SEAXNEAT_BASE_PATH: '/seaxneat/' });
build('stex-igor/apps/igor');

// The Python platform API runs from the locked uv environment. Its interpreter is
// started directly (not through uv) so stopping dev:alpha stops it too.
const python = path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
// Pantheon falls back to per-studio loading without it, so the platform is optional
// here: a missing uv or a platform crash is reported but never stops the stack.
const synced = spawnSync('uv', ['sync', '--frozen'], { cwd: root, env: childEnvironment, stdio: 'inherit', windowsHide: true });
const platformReady = synced.status === 0 && existsSync(python);
if (!platformReady) console.warn('Platform API not started: uv sync --frozen failed (see docs/DEVELOPER-GUIDE.md#prerequisites). Pantheon will poll studios directly.');

const children = [];
if (!useInferenceGateway) {
  children.push(run(['pnpm', '--dir', 'stex-igor/services/inference', 'dev'], {
    STEX_INFERENCE_PORT: inferencePort,
    STEX_INFERENCE_SHARED_SECRET: shared,
    STEX_HERMES_TRANSPORT: 'fake',
  }));
}
children.push(
  run(['pnpm', '--dir', 'apps/frige', 'dev'], {
    STEX_FRIGE_PORT: frigePort,
    STEX_FRIGE_BASE_PATH: '/frige',
    STEX_FRIGE_SHELL_URL: '/home/',
    STEX_PANTHEON_URL: `http://127.0.0.1:${shellPort}`,
    STEX_FRIGE_INFERENCE_MODE: useInferenceGateway ? 'gateway' : 'fake',
    STEX_INFERENCE_URL: inferenceUrl,
    STEX_INFERENCE_SHARED_SECRET: shared,
  }),
  run(['pnpm', '--dir', 'apps/seaxneat', 'dev'], {
    SEAXNEAT_PORT: seaxneatPort,
    STEX_PANTHEON_URL: 'http://127.0.0.1:' + shellPort,
  }),
  // Igor holds the inference secret; Pantheon only proxies to it.
  run(['pnpm', '--dir', 'stex-igor/apps/igor', 'dev'], {
    STEX_IGOR_PORT: igorPort,
    STEX_FRIGE_URL: `http://127.0.0.1:${frigePort}`,
    STEX_SEAXNEAT_URL: `http://127.0.0.1:${seaxneatPort}`,
    STEX_INFERENCE_URL: inferenceUrl,
    STEX_INFERENCE_SHARED_SECRET: shared,
  }),
  run(['pnpm', '--dir', 'apps/pantheon', 'dev'], {
    STEX_PANTHEON_PORT: shellPort,
    STEX_FRIGE_URL: `http://127.0.0.1:${frigePort}`,
    STEX_SEAXNEAT_URL: `http://127.0.0.1:${seaxneatPort}`,
    STEX_IGOR_URL: `http://127.0.0.1:${igorPort}`,
    STEX_PLATFORM_URL: `http://127.0.0.1:${platformPort}`,
  }),
);

let platform = null;
if (platformReady) {
  platform = spawn(python, ['-m', 'stex'], {
    cwd: root,
    env: { ...childEnvironment, STEX_PLATFORM_PORT: platformPort, STEX_FRIGE_URL: `http://127.0.0.1:${frigePort}`, STEX_SEAXNEAT_URL: `http://127.0.0.1:${seaxneatPort}` },
    stdio: 'inherit',
    windowsHide: true,
  });
  platform.once('exit', (code) => { if (!stopping) console.warn(`Platform API stopped (${code}); Pantheon will poll studios directly.`); });
}

let stopping = false;
/** Stops the stack children once and retains the selected exit code. */
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
  if (platform && platform.exitCode === null) platform.kill();
  process.exitCode = code;
}
for (const child of children) child.once('exit', (code) => { if (!stopping && code) stop(code); });
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
console.log(`STEX Alpha is starting at http://127.0.0.1:${shellPort}/`);
