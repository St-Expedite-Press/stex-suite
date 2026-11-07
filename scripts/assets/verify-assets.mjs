import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fileRecord, manifestPath, readManifest, repositoryRoot } from './manifest.mjs';

// Verifies assets/manifest.json against the files on disk: naming convention,
// checksums, byte budgets, unresolved Git LFS pointers, and unlisted files.
// Rules are documented in assets/README.md.

// `igor` is the user-facing assistant (internally the Hermes layer).
export const owners = ['stex', 'pantheon', 'frige', 'seaxneat', 'eostre', 'woden', 'hermes', 'igor', 'graph'];
const fileName = new RegExp(`^(${owners.join('|')})(-[a-z0-9]+)+\\.(png|webp|avif|mp4|webm|svg)$`);
const assetId = /^[PFSEWHGR]\d{2}$/;
// Every file under these roots must be listed in the manifest.
const managedRoots = ['assets/masters', 'assets/reference', 'packages/design-system/brand'];
const lfsPointer = 'version https://git-lfs.github.com/spec/v1';

async function filesUnder(root, relative) {
  let entries;
  try { entries = await readdir(path.join(root, relative), { withFileTypes: true }); } catch { return []; }
  const nested = await Promise.all(entries.map((entry) => {
    const child = `${relative}/${entry.name}`;
    return entry.isDirectory() ? filesUnder(root, child) : [child];
  }));
  return nested.flat();
}

async function mediaRoots(root) {
  const applications = await readdir(path.join(root, 'apps'), { withFileTypes: true }).catch(() => []);
  return applications.filter((entry) => entry.isDirectory()).map((entry) => `apps/${entry.name}/public/media`);
}

async function checkFile(root, record, label, errors) {
  const name = path.posix.basename(record.path);
  if (!fileName.test(name)) errors.push(`${label}: ${record.path} does not follow <owner>-<subject>[-<variant>][-<width>w].<ext>.`);
  let head;
  try { head = (await readFile(path.join(root, record.path))).subarray(0, lfsPointer.length).toString('utf8'); }
  catch { errors.push(`${label}: ${record.path} is missing.`); return; }
  if (head === lfsPointer) { errors.push(`${label}: ${record.path} is an unresolved Git LFS pointer; run "git lfs install" and "git lfs pull".`); return; }
  const actual = await fileRecord(record.path, root);
  if (actual.sha256 !== record.sha256 || actual.bytes !== record.bytes) errors.push(`${label}: ${record.path} does not match its manifest checksum.`);
  if (record.budgetBytes && actual.bytes > record.budgetBytes) errors.push(`${label}: ${record.path} is ${actual.bytes} bytes, over its ${record.budgetBytes}-byte budget.`);
}

export async function verifyAssets(root = repositoryRoot) {
  const errors = [];
  let manifest;
  try { manifest = await readManifest(root); } catch (error) { return [`${manifestPath} could not be read: ${error.message}`]; }
  if (manifest.schemaVersion !== 'stex.assets.manifest.v1' || !Array.isArray(manifest.assets)) return [`${manifestPath} is not a stex.assets.manifest.v1 document.`];

  const listed = new Set();
  const ids = new Set();
  for (const asset of manifest.assets) {
    const label = asset.id || '(no id)';
    if (!assetId.test(asset.id || '')) errors.push(`${label}: asset IDs are a family letter and two digits, such as P01.`);
    if (ids.has(asset.id)) errors.push(`${label}: duplicate asset ID.`);
    ids.add(asset.id);
    if (!owners.includes(asset.owner)) errors.push(`${label}: unknown owner "${asset.owner}".`);
    if (!asset.master?.path) { errors.push(`${label}: no master.`); continue; }
    if (!asset.provenance?.author || !asset.provenance?.rights) errors.push(`${label}: provenance needs an author and rights statement.`);
    if (!asset.alt) errors.push(`${label}: alt-text guidance is required.`);
    listed.add(asset.master.path);
    await checkFile(root, asset.master, label, errors);
    // Variants are separately drawn versions (such as a small-size emblem), not resizes.
    for (const variant of asset.variants || []) { listed.add(variant.path); await checkFile(root, variant, label, errors); }
    const stem = path.posix.basename(asset.master.path).replace(/\.[^.]+$/, '');
    for (const derivative of asset.derivatives || []) {
      listed.add(derivative.path);
      const expected = new RegExp(`^${stem}-${derivative.width}w\\.[a-z0-9]+$`);
      if (!expected.test(path.posix.basename(derivative.path))) errors.push(`${label}: derivative ${derivative.path} must be named ${stem}-${derivative.width}w.<ext>.`);
      await checkFile(root, derivative, label, errors);
      // A copy serves another application's derivative from its own origin
      // (applications never read each other's files). Its record must equal the
      // source's, and each file must match its record, so the bytes are identical.
      if (derivative.copyOf) {
        const source = (asset.derivatives || []).find((entry) => entry.path === derivative.copyOf && !entry.copyOf);
        if (!source) errors.push(`${label}: ${derivative.path} copies ${derivative.copyOf}, which is not a built derivative of this asset.`);
        else if (source.sha256 !== derivative.sha256 || source.bytes !== derivative.bytes || source.codecs !== derivative.codecs || path.posix.basename(source.path) !== path.posix.basename(derivative.path)) errors.push(`${label}: ${derivative.path} differs from ${derivative.copyOf}; copy it again from the source.`);
      }
    }
  }

  for (const managed of [...managedRoots, ...(await mediaRoots(root))]) {
    for (const file of await filesUnder(root, managed)) if (!listed.has(file)) errors.push(`${file} is not listed in ${manifestPath}.`);
  }
  return errors;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const errors = await verifyAssets();
  for (const error of errors) console.error(`FAIL  ${error}`);
  if (errors.length) process.exit(1);
  console.log('Assets match the manifest.');
}
