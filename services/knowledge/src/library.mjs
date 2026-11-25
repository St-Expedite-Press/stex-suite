/**
 * Per-person knowledge journals (D-028, milestone D2).
 *
 * Purpose: hosted Pantheon serves several signed-in people from one process.
 * Knowledge is personal state, so each person gets their own journal, opened
 * lazily from a hashed username directory under `<root>/people/`. Each directory
 * keeps the single-writer lock and atomic journal of `projections.mjs`; this
 * module only chooses which directory a request may use.
 *
 * Ownership: the knowledge service. Security boundary: the caller passes the
 * username Pantheon's hosted gate admitted, never a header or body field, and
 * a lease on one person's journal can never address another's directory.
 *
 * Modes:
 * - local (`hosted: false`): exactly today's behaviour. One journal in the
 *   configured directory, opened eagerly, actor `local`; the user is ignored.
 * - hosted: a request with no admitted user is refused (401). The pre-existing
 *   root journal is never moved, rewritten or deleted. Only the user named by
 *   `legacyOwner` reaches it; if nobody is named it is reachable by no one and
 *   `legacyState()` reports `unassigned` (without exposing its contents).
 *
 * Failure behaviour: a journal that cannot open (lock held, corrupt, oversized)
 * fails closed for that user only with 503; nothing is cached for it, so the
 * next request retries. The cache of open journals is bounded; only idle
 * journals are evicted, and eviction closes the journal, releasing its lock.
 */
import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { openKnowledge } from './projections.mjs';

/** Default bound on simultaneously open per-person journals (each holds one lock file and one in-memory journal of at most 8 MB). */
export const DEFAULT_OPEN_LIMIT = 32;
const ROOT_JOURNAL_FILE = 'knowledge.v1.json';

/** Builds this boundary's failure shape. */
const fail = (status, code, message) => Object.assign(new Error(message), { status, code });

/**
 * Maps a username to its stable, filesystem-safe directory name. The hash
 * keeps hostile or unusual usernames (separators, dots, case tricks) out of
 * paths; usernames are compared exactly as Igor reports them.
 *
 * @param {string} username  The admitted Igor username.
 * @returns {string}  First 32 hex characters of the username digest.
 */
export function personDirectoryName(username) {
  const hash = createHash('sha256');
  if (username.isWellFormed()) {
    hash.update(username, 'utf8');
  } else {
    // 0xff cannot occur in UTF-8. Reserve it to separate escaped usernames
    // from the existing UTF-8 inputs, which must keep their journal paths.
    hash.update(Buffer.from([0xff])).update(JSON.stringify(username), 'utf8');
  }
  return hash.digest('hex').slice(0, 32);
}

/**
 * @typedef {object} KnowledgeLease
 * @property {Awaited<ReturnType<typeof openKnowledge>>} knowledge  The caller's journal, valid until release().
 * @property {() => void} release  Marks the journal idle again; call exactly once, in a finally block.
 */

/**
 * Opens the knowledge library for a host process.
 *
 * @param {object} options
 * @param {string} [options.directory]  STEX_KNOWLEDGE_DATA_DIR; empty disables knowledge.
 * @param {boolean} [options.hosted]  Whether requests carry an admitted person.
 * @param {string} [options.legacyOwner]  Hosted only: the username that owns the pre-existing root journal.
 * @param {number} [options.limit]  Bound on open per-person journals.
 * @param {typeof openKnowledge} [options.open]  Test seam for the journal opener.
 * @returns {Promise<{
 *   lease: (username: string | null) => Promise<KnowledgeLease>,
 *   legacyState: () => Promise<'none' | 'assigned' | 'unassigned'>,
 *   openCount: () => number,
 *   close: () => Promise<void>,
 * }>}
 * @throws {Error} in local mode when the single journal cannot open (as before).
 */
export async function openKnowledgeLibrary({ directory = '', hosted = false, legacyOwner = '', limit = DEFAULT_OPEN_LIMIT, open = openKnowledge } = {}) {
  if (!Number.isInteger(limit) || limit < 1) throw new Error('The open-journal limit must be a positive integer.');
  if (!directory) {
    // Disabled: one inert journal serves everyone; no directory is ever created.
    const disabled = await open({ directory: '' });
    return { lease: async () => ({ knowledge: disabled, release() {} }), legacyState: async () => 'none', openCount: () => 0, close: () => disabled.close() };
  }
  const root = path.resolve(directory);
  if (!hosted) {
    // Local mode keeps today's eager open: a held lock stops startup, existing data is used in place.
    const single = await open({ directory: root });
    return { lease: async () => ({ knowledge: single, release() {} }), legacyState: async () => 'none', openCount: () => 1, close: () => single.close() };
  }

  /** @type {Map<string, { promise: Promise<object>, leases: number }>}  Insertion order doubles as least-recently-used order. */
  const cache = new Map();
  let closed = false;
  // Igor trims and lower-cases every username before reporting it, so the configured owner is normalised
  // the same way; otherwise `Alice` in the env file would silently match nobody (independent review finding).
  const legacyName = String(legacyOwner || '').trim().toLowerCase();

  /** Journal directory for a person: the legacy root for its named owner, otherwise a hashed people/ folder. */
  const directoryFor = (username) => (legacyName && username === legacyName ? root : path.join(root, 'people', personDirectoryName(username)));

  /** Closes idle least-recently-used journals until one slot is free; refuses when every journal is in use. */
  async function makeRoom() {
    while (cache.size >= limit) {
      const victim = [...cache].find(([, entry]) => entry.leases === 0);
      if (!victim) throw fail(503, 'KNOWLEDGE_BUSY', 'Too many people are using knowledge at once. Try again shortly.');
      cache.delete(victim[0]);
      // Awaiting close lets the writer queue drain; a failed close must not poison the new request.
      await victim[1].promise.then((journal) => journal.close()).catch(() => {});
    }
  }

  return {
    /**
     * Leases the admitted person's journal, opening it on first use.
     *
     * @param {string | null} username  The username the hosted gate admitted.
     * @returns {Promise<KnowledgeLease>}
     * @throws {Error} 401 without a user, 503 when this person's journal cannot open or the library is closed.
     */
    async lease(username) {
      if (closed) throw fail(503, 'KNOWLEDGE_CLOSED', 'Knowledge is shutting down.');
      if (typeof username !== 'string' || !username) throw fail(401, 'SIGN_IN_REQUIRED', 'Sign in to use knowledge.');
      let entry = cache.get(username);
      if (entry) { cache.delete(username); cache.set(username, entry); } // refresh recency
      else {
        await makeRoom();
        // A concurrent first request may have created the entry while room was being made.
        entry = cache.get(username);
        if (!entry) {
          // Concurrent first requests may have refilled the slots made above; never exceed the bound.
          if (cache.size >= limit) throw fail(503, 'KNOWLEDGE_BUSY', 'Too many people are using knowledge at once. Try again shortly.');
          // Opening is deduplicated through the cached promise: two requests must not both try to take the lock.
          entry = { leases: 0, promise: open({ directory: directoryFor(username) }) };
          cache.set(username, entry);
        }
      }
      entry.leases += 1;
      const held = entry;
      let journal;
      try { journal = await held.promise; }
      catch (error) {
        // Fail closed for this person only, and cache nothing so a fixed journal or released lock recovers.
        held.leases -= 1;
        if (cache.get(username) === held) cache.delete(username);
        throw error?.status ? error : fail(503, 'KNOWLEDGE_UNAVAILABLE', 'Your knowledge journal cannot be opened; it has been preserved.');
      }
      let released = false;
      return { knowledge: journal, release() { if (!released) { released = true; held.leases -= 1; } } };
    },
    /**
     * Whether a pre-existing root journal is present and who can reach it.
     *
     * @returns {Promise<'none' | 'assigned' | 'unassigned'>}  Presence only; never contents.
     */
    async legacyState() {
      try { await stat(path.join(root, ROOT_JOURNAL_FILE)); } catch { return 'none'; }
      return legacyName ? 'assigned' : 'unassigned';
    },
    /** @returns {number}  Journals currently held open (including opening ones). */
    openCount: () => cache.size,
    /** Closes every open journal, releasing all writer locks. Idempotent. */
    async close() {
      closed = true;
      const entries = [...cache.values()]; cache.clear();
      await Promise.all(entries.map((entry) => entry.promise.then((journal) => journal.close()).catch(() => {})));
    },
  };
}
