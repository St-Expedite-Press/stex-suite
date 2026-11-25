/**
 * Knowledge library source that reads selected portable Markdown notes from a bounded vault path.
 *
 * Ownership: services/knowledge. Status: UNEXPOSED. Nothing routes to this
 * adapter; the Obsidian gate (docs/PLATFORM-TRANSITION.md#direct-obsidian-integration)
 * requires the negative tests in `test/local-adapter-negative.test.mjs` to pass
 * before any vault read is exposed.
 *
 * Security boundary: `read()` returns the bytes of a regular file whose real
 * path lies inside the real vault root and is reached without crossing a
 * symbolic link, Windows junction, or a name that Windows can alias. Rejected
 * on purpose: `..`, absolute and drive/UNC paths, alternate data streams (`:`),
 * 8.3 short names (`~N`), trailing dots or spaces, reserved device names
 * (CON, NUL, ...), control characters, and the `.obsidian` configuration
 * directory in any letter case. `notes()` lists only what `read()` would accept.
 *
 * Residual risk (documented, not solved here): checks and the read are separate
 * system calls, so a link swapped in between them (TOCTOU) is not prevented by
 * this adapter; the vault must not be writable by untrusted code. Hard links
 * and bind mounts are not detectable from inside the vault.
 */
import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

/** Windows device names, reserved with or without an extension. */
const DEVICE_NAME = /^(con|prn|aux|nul|conin\$|conout\$|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i;
/** Characters Windows treats specially or forbids in a file name; `:` opens alternate data streams. */
const FORBIDDEN_NAME_CHARACTERS = /[\u0000-\u001f<>:"|?*]/;
/** Case-insensitive path comparison where the platform file systems are case-insensitive. */
const caseFold = (value) => (process.platform === 'win32' || process.platform === 'darwin' ? value.toLowerCase() : value);

/**
 * Explains why a single path segment is unsafe, or returns null when it is fine.
 * Applied to every segment of a requested path and to every directory entry
 * during listing, so the two cannot disagree.
 * @param {string} name One path segment.
 * @returns {string|null} A human-readable reason, or null.
 */
function unsafeSegment(name) {
  if (!name || name === '.' || name === '..') return 'empty or relative segment';
  if (FORBIDDEN_NAME_CHARACTERS.test(name)) return 'control, stream or reserved character';
  if (/[. ]$/.test(name)) return 'trailing dot or space';
  if (/~\d/.test(name)) return '8.3 short-name alias';
  if (DEVICE_NAME.test(name)) return 'reserved device name';
  if (name.toLowerCase() === '.obsidian') return 'Obsidian configuration directory';
  return null;
}

/**
 * Validates and splits a vault-relative Markdown path.
 * @param {unknown} value Caller-supplied path (either separator accepted).
 * @returns {string[]} The validated segments.
 * @throws {Error} When the path is not a safe relative Markdown path.
 */
function safeSegments(value) {
  const normalized = String(value || '').replaceAll('\\', '/');
  if (!normalized || normalized.startsWith('/')) throw new Error('Invalid vault note path.');
  const segments = normalized.split('/');
  if (segments.some((segment) => unsafeSegment(segment))) throw new Error('Invalid vault note path.');
  if (!normalized.endsWith('.md')) throw new Error('Vault notes must be Markdown.');
  return segments;
}

/**
 * Resolves a requested note to a verified regular file under the real root.
 * Every component is `lstat`ed so links and junctions are refused wherever they
 * sit in the chain, and the final real path must equal the lexical path (modulo
 * case on case-insensitive systems) and stay inside the real root.
 * @param {string} realRoot Real path of the vault root.
 * @param {unknown} relative Requested vault-relative path.
 * @returns {Promise<string>} Absolute path safe to read.
 * @throws {Error} `Invalid vault note path.` for any refusal.
 */
async function verifiedFile(realRoot, relative) {
  const segments = safeSegments(relative);
  let current = realRoot;
  for (const [index, segment] of segments.entries()) {
    current = path.join(current, segment);
    let stats;
    try { stats = await lstat(current); } catch { throw new Error('Invalid vault note path.'); }
    // Node reports Windows junctions and directory symlinks as symbolic links.
    if (stats.isSymbolicLink()) throw new Error('Invalid vault note path.');
    if (index < segments.length - 1 ? !stats.isDirectory() : !stats.isFile()) throw new Error('Invalid vault note path.');
  }
  const real = await realpath(current);
  const inside = caseFold(real).startsWith(`${caseFold(realRoot)}${path.sep}`);
  if (!inside || caseFold(real) !== caseFold(current)) throw new Error('Invalid vault note path.');
  return real;
}

/**
 * Opens the configured read-only Markdown adapter.
 * @param {string} [root] Vault directory; defaults to `STEX_VAULT_PATH`. Empty disables the adapter.
 * @returns {Readonly<{enabled: boolean, notes: () => Promise<string[]>, read: (relative: string) => Promise<string>}>}
 */
export function localKnowledgeAdapter(root = process.env.STEX_VAULT_PATH) {
  if (!root) return Object.freeze({ enabled: false, /** Lists metadata for the permitted notes under the selected vault. */ async notes() { return []; }, /** Reads the requested note through the configured allow-list. */ async read() { throw new Error('The User Graph is disabled.'); } });
  const configuredRoot = path.resolve(root);
  return Object.freeze({
    enabled: true,
    /** Lists the vault-relative paths of notes that `read()` would accept; links and aliased names are skipped. */
    async notes() {
      const realRoot = await realpath(configuredRoot);
      const records = [];
      /** Visits a child directory or entry during a bounded walk. */
      async function visit(current, prefix = '') {
        for (const entry of await readdir(current, { withFileTypes: true })) {
          if (unsafeSegment(entry.name) || entry.isSymbolicLink()) continue;
          const relative = `${prefix}${entry.name}`;
          if (entry.isDirectory()) await visit(path.join(current, entry.name), `${relative}/`);
          else if (entry.isFile() && entry.name.endsWith('.md')) records.push(relative);
        }
      }
      await visit(realRoot); return records.sort();
    },
    /** Reads one verified regular Markdown file inside the real vault root. */
    async read(relative) { return readFile(await verifiedFile(await realpath(configuredRoot), relative), 'utf8'); },
  });
}
