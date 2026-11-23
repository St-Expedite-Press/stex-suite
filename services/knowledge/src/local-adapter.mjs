/** Knowledge library source that reads selected portable Markdown notes from a bounded vault path. */
import { access, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

/** Accepts a bounded relative path under the selected project. */
function safeRelative(value) {
  const normalized = String(value || '').replaceAll('\\', '/');
  if (!normalized || normalized.startsWith('/') || normalized.split('/').some((part) => !part || part === '.' || part === '..')) throw new Error('Invalid vault note path.');
  if (!normalized.endsWith('.md')) throw new Error('Vault notes must be Markdown.');
  return normalized;
}

/** Opens the configured read-only Markdown adapter. */
export function localKnowledgeAdapter(root = process.env.STEX_VAULT_PATH) {
  if (!root) return Object.freeze({ enabled: false, /** Lists metadata for the permitted notes under the selected vault. */ async notes() { return []; }, /** Reads the requested note through the configured allow-list. */ async read() { throw new Error('The User Graph is disabled.'); } });
  const vaultRoot = path.resolve(root);
  /** Resolves a note path under the selected vault root. */
  const fileFor = (relative) => {
    const file = path.resolve(vaultRoot, safeRelative(relative));
    if (!file.startsWith(`${vaultRoot}${path.sep}`)) throw new Error('Invalid vault note path.');
    return file;
  };
  return Object.freeze({
    enabled: true,
    /** Lists metadata for the permitted notes under the selected vault. */
    async notes() {
      const records = [];
      /** Visits a child directory or entry during a bounded walk. */
      async function visit(current, prefix = '') {
        for (const entry of await readdir(current, { withFileTypes: true })) {
          if (entry.name === '.obsidian') continue;
          const relative = `${prefix}${entry.name}`;
          if (entry.isDirectory()) await visit(path.join(current, entry.name), `${relative}/`);
          else if (entry.isFile() && entry.name.endsWith('.md')) records.push(relative);
        }
      }
      await access(vaultRoot); await visit(vaultRoot); return records.sort();
    },
    /** Reads the requested note through the configured allow-list. */
    async read(relative) { return readFile(fileFor(relative), 'utf8'); },
  });
}
