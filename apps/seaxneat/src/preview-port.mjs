/**
 * Seaxneat engine source that chooses a free loopback port for a preview server.
 *
 * Ownership: the Seaxneat engine. Security boundary: only 127.0.0.1 is probed
 * and previews bind only there. The hashed starting port keeps a project's
 * preview address stable when nothing collides; a bounded probe over the next
 * ports keeps two projects (or a foreign listener) from colliding.
 */
import { createHash } from 'node:crypto';
import net from 'node:net';

export const PREVIEW_PORT_BASE = 4400;
export const PREVIEW_PORT_SPAN = 1000;
export const PREVIEW_PORT_ATTEMPTS = 25;

/**
 * Lists the ports to try for a project, starting at its hashed port and
 * wrapping inside [BASE, BASE + SPAN).
 * @param {string} projectId Validated project identifier.
 * @param {number} [count] How many candidates to return.
 * @returns {number[]}
 */
export function candidatePorts(projectId, count = PREVIEW_PORT_ATTEMPTS) {
  const start = parseInt(createHash('sha256').update(projectId).digest('hex').slice(0, 4), 16) % PREVIEW_PORT_SPAN;
  return Array.from({ length: count }, (_, index) => PREVIEW_PORT_BASE + ((start + index) % PREVIEW_PORT_SPAN));
}

/**
 * Reports whether anything accepts connections or holds a bind on the port.
 * A connect probe catches listeners bound to other addresses on Windows,
 * where binding 127.0.0.1 can succeed beside a wildcard listener.
 * @param {number} port
 * @returns {Promise<boolean>} True when the port is unavailable.
 */
export async function portInUse(port) {
  const connected = await new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    socket.setTimeout(500);
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('timeout', () => { socket.destroy(); resolve(false); });
    socket.once('error', () => resolve(false));
  });
  if (connected) return true;
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(true));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(false)));
  });
}

/**
 * Returns the first free port among the candidates.
 * @param {number[]} candidates
 * @param {(port: number) => Promise<boolean>} [inUse] Injectable probe for tests.
 * @param {Set<number>} [skip] Ports already known to be unusable.
 * @returns {Promise<number>}
 * @throws {Error} With code `NO_PREVIEW_PORT` when every candidate is taken.
 */
export async function firstFreePort(candidates, inUse = portInUse, skip = new Set()) {
  for (const port of candidates) if (!skip.has(port) && !(await inUse(port))) return port;
  throw Object.assign(new Error('No free preview port is available in the bounded range.'), { code: 'NO_PREVIEW_PORT' });
}
