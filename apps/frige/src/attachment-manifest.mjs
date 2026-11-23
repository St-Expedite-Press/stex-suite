/** Frige's shared attachment metadata boundary for both publishing APIs. */
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

const writes = new Map();
const unavailable = () => Object.assign(new Error('Attachment metadata is unavailable.'), { status: 503, code: 'ATTACHMENTS_UNAVAILABLE' });

/** Orders every in-process attachment mutation for the same book. */
export async function mutateAttachments(root, task) {
  const key = await realpath(root).catch((error) => {
    if (error.code === 'ENOENT') throw new Error('Book not found.');
    throw unavailable();
  });
  const run = (writes.get(key) ?? Promise.resolve()).then(task);
  const tail = run.catch(() => {});
  writes.set(key, tail);
  try { return await run; }
  finally { if (writes.get(key) === tail) writes.delete(key); }
}

/** Loads metadata without treating corruption or a temporary file error as absence. */
export async function readAttachmentManifest(root) {
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
    const manifest = JSON.parse(decoder.decode(await readFile(path.join(root, '.texgraph', 'documents.json'))));
    if (!Array.isArray(manifest) || manifest.some((entry) => !entry || typeof entry.id !== 'string')) throw new Error('Invalid manifest');
    return manifest;
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw unavailable();
  }
}
