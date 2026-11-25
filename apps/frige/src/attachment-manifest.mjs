/** Frige's shared attachment metadata boundary for both publishing APIs. */
import { createHash, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';

const writes = new Map();
const unavailable = () => Object.assign(new Error('Attachment metadata is unavailable.'), { status: 503, code: 'ATTACHMENTS_UNAVAILABLE' });
const unsafeStoredFilename = /[^A-Za-z0-9._ -]|^\.{1,2}$/;
const sourceDigest = /^[a-f0-9]{64}$/;
const maximumCandidates = 64;
const maximumComparisonBytes = 32_000_000;

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

/** Verifies an available original without following a link or reading beyond the upload's length. */
async function originalMatches(file, bytes) {
  let handle;
  try {
    const entry = await lstat(file);
    if (!entry.isFile() || entry.size !== bytes.length || await realpath(file) !== file) return false;
    handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    const opened = await handle.stat();
    if (!opened.isFile() || opened.size !== bytes.length || opened.dev !== entry.dev || opened.ino !== entry.ino) return false;
    const content = Buffer.allocUnsafe(bytes.length + 1);
    let offset = 0;
    while (offset < content.length) {
      const { bytesRead } = await handle.read(content, offset, content.length - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    return offset === bytes.length && bytes.equals(content.subarray(0, offset));
  } catch {
    return false;
  } finally {
    await handle?.close().catch(() => {});
  }
}

/** Looks for an earlier identical original in this manifest, with bounded advisory checks. */
async function duplicateOriginal(sourceDirectory, manifest, bytes, hash) {
  let attempts = 0;
  let comparisonBytes = 0;
  for (const entry of manifest) {
    if (entry.bytes !== bytes.length || !/^[a-f0-9]{16}$/.test(entry.id)) continue;
    if (typeof entry.storedAs !== 'string' || !entry.storedAs || unsafeStoredFilename.test(entry.storedAs)) continue;
    if (typeof entry.sourceSha256 === 'string' && sourceDigest.test(entry.sourceSha256) && entry.sourceSha256 !== hash) continue;
    attempts += 1;
    comparisonBytes += bytes.length;
    if (attempts > maximumCandidates || comparisonBytes > maximumComparisonBytes) break;
    if (await originalMatches(path.join(sourceDirectory, entry.storedAs), bytes)) return entry.id;
  }
  return undefined;
}

/** Writes a fresh original under the caller's book lock and returns its metadata and advisory match. */
export async function storeAttachmentOriginal(root, manifest, name, bytes) {
  const sourceDirectory = path.join(await realpath(root), 'sources');
  await mkdir(sourceDirectory, { recursive: true });
  if (!(await lstat(sourceDirectory)).isDirectory()) throw unavailable();
  const sourceSha256 = createHash('sha256').update(bytes).digest('hex');
  const duplicateOf = await duplicateOriginal(sourceDirectory, manifest, bytes, sourceSha256);
  let id;
  do { id = randomBytes(8).toString('hex'); } while (manifest.some((entry) => entry.id === id));
  const storedAs = `${Date.now()}-${id}-${name}`;
  await writeFile(path.join(sourceDirectory, storedAs), bytes, { flag: 'wx' });
  const record = { id, name, storedAs, bytes: bytes.length, sourceSha256, uploadedAt: new Date().toISOString(), contextState: 'awaiting-extraction' };
  return { record, duplicateOf };
}
