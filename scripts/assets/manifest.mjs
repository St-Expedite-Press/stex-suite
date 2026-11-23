/** Suite asset tooling source that reads and writes asset metadata and measures derived files. */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Shared by the asset build and verification scripts. Paths in the manifest are
// repository-relative and always use forward slashes.
export const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const manifestPath = 'assets/manifest.json';

/** Loads and decodes the canonical asset manifest. */
export async function readManifest(root = repositoryRoot) {
  return JSON.parse(await readFile(path.join(root, manifestPath), 'utf8'));
}

/** Serializes the supplied manifest in the canonical source location. */
export async function writeManifest(manifest, root = repositoryRoot) {
  await writeFile(path.join(root, manifestPath), `${JSON.stringify(manifest, null, 2)}\n`);
}

/** Computes checksums and file properties for an asset entry. */
export async function fileRecord(relativePath, root = repositoryRoot) {
  const bytes = await readFile(path.join(root, relativePath));
  return { sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length };
}
