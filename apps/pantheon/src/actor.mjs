/**
 * Platform actor sender (stex.platform.actor.v1, D-028).
 *
 * Purpose: tell the engines that verify it (Frige; see ACTOR_RECEIVERS) which signed-in person made a
 * request that came through hosted Pantheon, for attribution and personal
 * state. Ownership: Pantheon is the ONLY sender; engines are receivers.
 * Security boundary: the three headers are authenticated by a shared secret,
 * so Pantheon deletes them from every incoming request in every mode (a
 * browser can never supply them) and sets them only on requests it proxies to
 * an engine for a user its hosted gate admitted. They are never sent to Igor
 * (its own session) and the token is never logged. This grants no access.
 */

import { createHash } from 'node:crypto';

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
 * Applications that verify the actor. Others never receive the token, which
 * they could not check (independent review finding, 2026-11-25). Igor is never
 * one: it has its own session.
 */
export const ACTOR_RECEIVERS = new Set(['frige']);

/** Usernames that can travel in the header as they are: visible ASCII, 1 to 128 characters. */
const HEADER_SAFE = /^[\x21-\x7e]{1,128}$/;

/**
 * The actor id sent for a username.
 *
 * Igor accepts usernames of up to 254 characters that may hold spaces or
 * non-ASCII letters. Those cannot travel in a header, but sending no actor
 * would leave that person unable to change anything in an engine that
 * requires one. So such a username travels as a stable digest instead:
 * `sha256-` and the 64 hex digits of its UTF-8 bytes. Every change is still
 * attributed to the same person.
 *
 * @param {string} username  The username Igor confirmed (Igor has already trimmed and lower-cased it).
 * @returns {string | null}  The id to send, or null for an empty or oversized username.
 */
export function actorId(username) {
  if (HEADER_SAFE.test(username)) return username;
  if (!username || username.length > 1024) return null;
  return `sha256-${createHash('sha256').update(username, 'utf8').digest('hex')}`;
}

/**
 * Builds the actor headers for one admitted user.
 *
 * @param {{ username?: unknown, role?: unknown } | null | undefined} user  The user the hosted gate admitted.
 * @param {string | null} secret  The configured secret, or null.
 * @returns {Record<string, string> | null}  The three headers, or null when nothing may be sent (no user, no secret, or an empty or oversized username; see `actorId`). A role other than `owner` becomes `member`.
 */
export function actorHeaders(user, secret) {
  if (!secret || !user || typeof user.username !== 'string') return null;
  const id = actorId(user.username);
  if (!id) return null;
  return { [ACTOR_HEADER]: id, [ACTOR_ROLE_HEADER]: user.role === 'owner' ? 'owner' : 'member', [ACTOR_TOKEN_HEADER]: secret };
}
