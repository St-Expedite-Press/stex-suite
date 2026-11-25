/**
 * Platform actor sender (stex.platform.actor.v1, D-028).
 *
 * Purpose: tell the engines (Frige, Seaxneat) which signed-in person made a
 * request that came through hosted Pantheon, for attribution and personal
 * state. Ownership: Pantheon is the ONLY sender; engines are receivers.
 * Security boundary: the three headers are authenticated by a shared secret,
 * so Pantheon deletes them from every incoming request in every mode (a
 * browser can never supply them) and sets them only on requests it proxies to
 * an engine for a user its hosted gate admitted. They are never sent to Igor
 * (its own session) and the token is never logged. This grants no access.
 */

/** Header carrying the Igor username. */
export const ACTOR_HEADER = 'x-stex-actor';
/** Header carrying the role, `owner` or `member`. */
export const ACTOR_ROLE_HEADER = 'x-stex-actor-role';
/** Header carrying the shared secret. */
export const ACTOR_TOKEN_HEADER = 'x-stex-platform-token';
/** Minimum secret length the contract requires. */
export const ACTOR_SECRET_MIN = 32;

/**
 * Reads the actor secret.
 *
 * @param {Record<string, string | undefined>} env  Process environment.
 * @returns {string | null}  The secret, or null when none is configured.
 * @throws {Error} when STEX_PLATFORM_ACTOR_SECRET is set but shorter than 32 characters (refuse to start rather than send a guessable token).
 */
export function actorSecret(env) {
  const value = env.STEX_PLATFORM_ACTOR_SECRET;
  if (value === undefined || value === '') return null;
  if (value.length < ACTOR_SECRET_MIN) throw new Error(`STEX_PLATFORM_ACTOR_SECRET must be at least ${ACTOR_SECRET_MIN} characters.`);
  return value;
}

/**
 * Deletes every actor header from an incoming request, in place. Run before
 * any routing so a client-supplied value can never reach an engine.
 *
 * @param {import('node:http').IncomingMessage['headers']} headers  Mutable request headers.
 */
export function stripActorHeaders(headers) {
  delete headers[ACTOR_HEADER]; delete headers[ACTOR_ROLE_HEADER]; delete headers[ACTOR_TOKEN_HEADER];
}

/**
 * Builds the actor headers for one admitted user.
 *
 * @param {{ username?: unknown, role?: unknown } | null | undefined} user  The user the hosted gate admitted.
 * @param {string | null} secret  The configured secret, or null.
 * @returns {Record<string, string> | null}  The three headers, or null when nothing may be sent (no user, no secret, or an invalid username: visible ASCII 0x21-0x7e, 1 to 128 characters). A role other than `owner` becomes `member`.
 */
export function actorHeaders(user, secret) {
  if (!secret || !user || typeof user.username !== 'string') return null;
  if (!/^[\x21-\x7e]{1,128}$/.test(user.username)) return null;
  return { [ACTOR_HEADER]: user.username, [ACTOR_ROLE_HEADER]: user.role === 'owner' ? 'owner' : 'member', [ACTOR_TOKEN_HEADER]: secret };
}
