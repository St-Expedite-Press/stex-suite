import { access, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

function safeRelative(value) {
  const normalized = String(value || '').replaceAll('\\', '/');
  if (!normalized || normalized.startsWith('/') || normalized.split('/').some((part) => !part || part === '.' || part === '..')) throw new Error('Invalid vault note path.');
  if (!normalized.endsWith('.md')) throw new Error('Vault notes must be Markdown.');
  return normalized;
}

export function localKnowledgeAdapter(root = process.env.STEX_VAULT_PATH) {
  if (!root) return Object.freeze({ enabled: false, async notes() { return []; }, async read() { throw new Error('The User Graph is disabled.'); } });
  const vaultRoot = path.resolve(root);
  const fileFor = (relative) => {
    const file = path.resolve(vaultRoot, safeRelative(relative));
    if (!file.startsWith(`${vaultRoot}${path.sep}`)) throw new Error('Invalid vault note path.');
    return file;
  };
  return Object.freeze({
    enabled: true,
    async notes() {
      const records = [];
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
    async read(relative) { return readFile(fileFor(relative), 'utf8'); },
  });
}
