/**
 * Frige platform-actor receiver (`stex.platform.actor.v1`, D-028).
 *
 * Purpose: decide which signed-in person, if any, made a request that reached
 * Frige through hosted Pantheon, so records Frige creates can carry that
 * person's id as attribution.
 *
 * Ownership: Pantheon is the only sender; this module is the Frige receiver.
 * It grants nothing: every signed-in account keeps the access it already had.
 *
 * Invariants:
 *  - With no `STEX_PLATFORM_ACTOR_SECRET` (local mode) actor headers are
 *    ignored entirely and the actor is `{ id: 'local', role: 'owner', verified: false }`.
 *  - With the secret set, an actor exists only when the shared token matches
 *    (constant-time) and the username and role are valid; otherwise there is
 *    none, and state-changing requests are refused by the caller.
 *  - A secret shorter than the contract's 32 characters is a misconfiguration
 *    and fails closed: no request can ever resolve to an actor.
 *  - The token is never logged, returned, or placed in an error message.
 *
 * Contract: protocol/platform/README.md#platform-actor-v1.
 */
import { timingSafeEqual } from 'node:crypto';

/** Environment variable holding the secret Pantheon and the engines share. */
export const ACTOR_SECRET_ENV = 'STEX_PLATFORM_ACTOR_SECRET';
/** Shortest shared secret the contract accepts. */
export const MIN_SECRET_LENGTH = 32;
/** Methods that can change state; reads (GET, HEAD, OPTIONS) never need an actor. */
export const STATE_CHANGING_METHODS = Object.freeze(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * A resolved actor.
 *
 * @typedef {object} Actor
 * @property {string} id         The Igor username, or `local` in local mode.
 * @property {'owner' | 'member'} role
 * @property {boolean} verified  `true` only when Pantheon's token was verified.
 */

/** The actor of every request in local mode, which has no secret and no accounts. */
export const LOCAL_ACTOR = Object.freeze({ id: 'local', role: 'owner', verified: false });

/** Visible ASCII (0x21-0x7e), 1 to 128 characters: the contract's username form. */
const USERNAME = /^[\x21-\x7e]{1,128}$/;

/**
 * Reads the configured shared secret.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}  The secret, or an empty string in local mode.
 */
export const actorSecret = (env = process.env) => String(env[ACTOR_SECRET_ENV] || '');

/**
 * Whether actor enforcement is on for this process.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {boolean}
 */
export const actorEnforced = (env = process.env) => actorSecret(env) !== '';

/**
 * Compares two strings in constant time. Unequal lengths are unequal without
 * a comparison, because `timingSafeEqual` requires equal-length buffers; only
 * the length of the secret could leak that way, and it is a fixed deployment value.
 *
 * @param {string} left
 * @param {string} right
 * @returns {boolean}
 */
function sameSecret(left, right) {
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Resolves the actor of one request per the contract table.
 *
 * @param {import('node:http').IncomingHttpHeaders} headers
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Actor | null}  `null` when a secret is configured and the request
 *   carries no valid, verified actor.
 */
export function resolveActor(headers, env = process.env) {
  const secret = actorSecret(env);
  if (!secret) return LOCAL_ACTOR;
  if (secret.length < MIN_SECRET_LENGTH) return null;
  const token = headers['x-stex-platform-token'];
  const id = headers['x-stex-actor'];
  const role = headers['x-stex-actor-role'];
  // A repeated header arrives joined or as an array; neither is a single valid value.
  if (typeof token !== 'string' || typeof id !== 'string' || typeof role !== 'string') return null;
  if (!sameSecret(token, secret)) return null;
  if (!USERNAME.test(id) || (role !== 'owner' && role !== 'member')) return null;
  return { id, role, verified: true };
}

/**
 * Whether a request must carry a verified actor before it is handled.
 *
 * @param {string} method
 * @param {Actor | null} actor  The result of {@link resolveActor}.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {boolean}  `true` when the request must be refused with `401 ACTOR_REQUIRED`.
 */
export function actorRefused(method, actor, env = process.env) {
  return actorEnforced(env) && STATE_CHANGING_METHODS.includes(method) && actor === null;
}
