/**
 * Per-project passwords for Frige.
 *
 * A host may protect individual projects with a password, in addition to
 * whatever signs people in to the platform. The record lives in one
 * Frige-owned JSON file (STEX_FRIGE_ACCESS_FILE), outside every book, so
 * protecting a project never touches its manuscript:
 *
 *   { "schemaVersion": 1, "secret": "<64 hex>",
 *     "projects": { "book:<id>": { "hash": "scrypt$...", "version": 1, "updatedAt": "..." } } }
 *
 * Passwords are stored only as scrypt hashes. Unlocking a project sets a
 * signed, HttpOnly cookie scoped to Frige's mount path and to that project;
 * changing or clearing the password bumps its version and voids every
 * earlier unlock (a cleared password keeps its version, so setting one again
 * never revives an old cookie). Without STEX_FRIGE_ACCESS_FILE no project is
 * protected; once it is set, a missing file refuses every project (503)
 * instead of silently opening them. Attempts on one project run one at a
 * time and are counted before the check, so parallel guesses share the limit.
 *
 * Every route that reads or changes a project's content asks
 * `assertUnlocked` first. Server-to-server readers (Igor's project context,
 * the knowledge journal) carry no browser cookie, so a protected project is
 * unavailable to them; that is intended.
 */
import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { chmod, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_BYTES = 32;
const UNLOCK_SECONDS = 12 * 60 * 60;
const FAILURE_WINDOW_MS = 15 * 60_000;
const FAILURE_LIMIT = 10;
const KINDS = new Set(['book', 'project']);
const ID = /^[a-z0-9][a-z0-9-]{0,62}$/;
export const MIN_PASSWORD = 8;
export const MAX_PASSWORD = 1024;

/** An access failure carrying its HTTP status and stable code. */
export class AccessError extends Error {
  /**
   * @param {number} status  403 locked or wrong password, 429 too many attempts, 400 invalid request.
   * @param {string} code  PROJECT_LOCKED, WRONG_PASSWORD, RATE_LIMITED or INVALID_REQUEST.
   * @param {string} message  User-safe text; never echoes a password.
   */
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

/** Validates a project kind and id and returns the record key `kind:id`. */
export function projectKey(kind, id) {
  if (!KINDS.has(kind) || typeof id !== 'string' || !ID.test(id)) throw new AccessError(400, 'INVALID_REQUEST', 'Invalid project.');
  return `${kind}:${id}`;
}

/** Hashes a password as `scrypt$N$r$p$salt$key` (base64url parts). */
export async function hashProjectPassword(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD || password.length > MAX_PASSWORD) throw new AccessError(400, 'INVALID_REQUEST', `Project passwords must be ${MIN_PASSWORD} to ${MAX_PASSWORD} characters.`);
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize('NFC'), salt, KEY_BYTES, SCRYPT);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64url'), key.toString('base64url')].join('$');
}

/** Checks a password against a stored hash in constant time for the key comparison. */
async function passwordMatches(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [N, r, p] = parts.slice(1, 4).map(Number);
  if (![N, r, p].every(Number.isSafeInteger) || N > 2 ** 20) return false;
  const expected = Buffer.from(parts[5], 'base64url');
  if (expected.length !== KEY_BYTES) return false;
  const actual = await scrypt(String(password).normalize('NFC'), Buffer.from(parts[4], 'base64url'), KEY_BYTES, { N, r, p, maxmem: SCRYPT.maxmem });
  return timingSafeEqual(actual, expected);
}

/** Parses and validates an access document; throws on anything malformed so a broken file never unlocks. */
function parseDocument(text) {
  const document = JSON.parse(text);
  if (document?.schemaVersion !== 1 || !/^[0-9a-f]{64}$/.test(document.secret || '') || !document.projects || typeof document.projects !== 'object') throw new Error('The project access file is invalid.');
  for (const [key, record] of Object.entries(document.projects)) {
    const [kind, id] = key.split(':');
    projectKey(kind, id);
    // A cleared password keeps its version (no hash), so a later password never revives old unlocks.
    if (!Number.isSafeInteger(record?.version) || record.version < 1 || (record.cleared === true ? record.hash !== undefined : typeof record.hash !== 'string')) throw new Error('The project access file is invalid.');
  }
  return document;
}

/** Writes the access document atomically, readable by its owner only. */
async function writeDocument(file, document) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, file);
}

/**
 * Opens the project access record.
 *
 * @param {{ file?: string, now?: () => number }} options  The access file (unset: nothing is protected) and a clock seam.
 */
export function openProjectAccess({ file = '', now = () => Date.now() } = {}) {
  const location = file ? path.resolve(file) : '';
  let cached = null; let cachedStamp = '';
  const failures = new Map();
  const attempts = new Map();

  /**
   * The current document, re-read whenever the file changes, so a password
   * change applies without a restart. Once a file is configured, a missing
   * file is an error (nothing opens) rather than "no project is protected":
   * a lost or mistyped record must never switch protection off.
   */
  async function current({ allowMissing = false } = {}) {
    if (!location) return null;
    let info;
    try { info = await stat(location); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      cached = null; cachedStamp = '';
      if (allowMissing) return null;
      throw new AccessError(503, 'ACCESS_UNAVAILABLE', 'Project protection is configured but its record is missing; nothing opens until it is restored.');
    }
    const stamp = `${info.mtimeMs}:${info.size}`;
    if (stamp !== cachedStamp) { cached = parseDocument(await readFile(location, 'utf8')); cachedStamp = stamp; }
    return cached;
  }

  const cookieName = (key) => `stex_frige_unlock_${key.replace(':', '_')}`;
  const sign = (secret, value) => createHmac('sha256', Buffer.from(secret, 'hex')).update(value).digest('base64url');

  /** Whether the request carries a valid, unexpired unlock for this exact project and password version. */
  function unlockedBy(headers, document, key) {
    const record = document.projects[key];
    const name = `${cookieName(key)}=`;
    const raw = String(headers.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(name));
    if (!raw) return false;
    const [version, expires, signature] = raw.slice(name.length).split('.');
    if (Number(version) !== record.version || !(Number(expires) * 1000 > now()) || !signature) return false;
    const expected = Buffer.from(sign(document.secret, `${key}:${version}:${expires}`));
    const given = Buffer.from(signature);
    return expected.length === given.length && timingSafeEqual(expected, given);
  }

  return {
    /** Whether any project protection is configured on this host. */
    enabled: Boolean(location),

    /** Whether a project has a password. */
    async isProtected(kind, id) {
      const document = await current();
      return Boolean(document?.projects[projectKey(kind, id)]?.hash);
    },

    /** Throws PROJECT_LOCKED unless the project is unprotected or the request has unlocked it. */
    async assertUnlocked(kind, id, headers) {
      const key = projectKey(kind, id);
      const document = await current();
      if (!document?.projects[key]?.hash) return;
      if (!unlockedBy(headers, document, key)) throw new AccessError(403, 'PROJECT_LOCKED', 'This project is password protected. Enter its password to open it.');
    },

    /**
     * Checks a password and returns the Set-Cookie value that unlocks the project.
     *
     * @param {{ kind: string, id: string, password: string, cookiePath: string, secure: boolean }} request
     */
    async unlock({ kind, id, password, cookiePath, secure }) {
      const key = projectKey(kind, id);
      // Attempts on one project run one at a time and are counted before the
      // slow check, so parallel guesses cannot slip past the limit.
      const previous = attempts.get(key) || Promise.resolve();
      let release;
      const turn = new Promise((resolve) => { release = resolve; });
      const chained = previous.then(() => turn);
      attempts.set(key, chained);
      await previous;
      try {
        const document = await current();
        const record = document?.projects[key];
        if (!record?.hash) throw new AccessError(400, 'INVALID_REQUEST', 'This project has no password.');
        const recent = (failures.get(key) || []).filter((time) => now() - time < FAILURE_WINDOW_MS);
        failures.set(key, recent);
        if (recent.length >= FAILURE_LIMIT) throw new AccessError(429, 'RATE_LIMITED', 'Too many wrong passwords. Wait fifteen minutes and try again.');
        const attempt = now(); recent.push(attempt);
        if (typeof password !== 'string' || !password || password.length > MAX_PASSWORD || !(await passwordMatches(password, record.hash))) {
          throw new AccessError(403, 'WRONG_PASSWORD', 'That password is not right.');
        }
        failures.delete(key);
        const expires = Math.floor(now() / 1000) + UNLOCK_SECONDS;
        const value = `${record.version}.${expires}.${sign(document.secret, `${key}:${record.version}:${expires}`)}`;
        return `${cookieName(key)}=${value}; Path=${cookiePath}; Max-Age=${UNLOCK_SECONDS}; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`;
      } finally {
        release();
        if (attempts.get(key) === chained) attempts.delete(key);
      }
    },

    /** The Set-Cookie value that forgets this browser's unlock of a project. */
    lockCookie(kind, id, cookiePath) {
      return `${cookieName(projectKey(kind, id))}=; Path=${cookiePath}; Max-Age=0; HttpOnly; SameSite=Strict`;
    },

    /** Sets or replaces a project's password (operator tool); every earlier unlock stops working. */
    /** Creates an empty record when none exists (operator tool); an existing record is kept. */
    async initialize() {
      if (!location) throw new Error('STEX_FRIGE_ACCESS_FILE is not set.');
      if (await current({ allowMissing: true })) return { created: false };
      await writeDocument(location, { schemaVersion: 1, secret: randomBytes(32).toString('hex'), projects: {} });
      cachedStamp = '';
      return { created: true };
    },

    async setPassword(kind, id, password) {
      if (!location) throw new Error('STEX_FRIGE_ACCESS_FILE is not set.');
      const key = projectKey(kind, id);
      const document = (await current({ allowMissing: true })) || { schemaVersion: 1, secret: randomBytes(32).toString('hex'), projects: {} };
      const previous = document.projects[key];
      const next = { ...document, projects: { ...document.projects, [key]: { hash: await hashProjectPassword(password), version: (previous?.version || 0) + 1, updatedAt: new Date(now()).toISOString() } } };
      await writeDocument(location, next);
      cachedStamp = '';
      return { key, version: next.projects[key].version };
    },

    /** Removes a project's password (operator tool). */
    async clearPassword(kind, id) {
      if (!location) throw new Error('STEX_FRIGE_ACCESS_FILE is not set.');
      const key = projectKey(kind, id);
      const document = await current();
      const record = document?.projects[key];
      if (!record?.hash) return { key, removed: false };
      // The version stays behind, so a later password continues from it.
      await writeDocument(location, { ...document, projects: { ...document.projects, [key]: { version: record.version, cleared: true, updatedAt: new Date(now()).toISOString() } } });
      cachedStamp = '';
      return { key, removed: true };
    },

    /** The project keys with their versions and whether a password is set, without hashes. */
    async list() {
      const document = await current();
      return Object.entries(document?.projects || {}).map(([key, record]) => ({ key, version: record.version, protected: Boolean(record.hash), updatedAt: record.updatedAt || null }));
    },
  };
}
