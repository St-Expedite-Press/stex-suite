/**
 * Seeds the staging books volume with one synthetic book, once.
 *
 * Purpose: give the local staging slice a Frige project without real
 * manuscripts. Ownership: staging only; never run against a real books
 * directory. Failure behaviour: an existing non-empty books directory is left
 * untouched (so a recreated Frige keeps its data), and anything other than a
 * plain directory at the target stops the seed with a non-zero exit.
 */
import { lstat, mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const books = process.argv[2] || '/data/frige/books';
await mkdir(books, { recursive: true });
const info = await lstat(books);
if (!info.isDirectory() || info.isSymbolicLink()) { console.error('The books target is not a plain directory.'); process.exit(1); }
if ((await readdir(books)).length) { console.log('Books volume already populated; nothing seeded.'); process.exit(0); }

const book = path.join(books, 'staging-fixture');
await mkdir(path.join(book, 'manuscript', '01_Cycle'), { recursive: true });
await writeFile(path.join(book, 'README.md'), '# Staging Fixture (synthetic)\n\nSynthetic text for local container verification only.\n');
await writeFile(path.join(book, 'manuscript', 'Programme.md'), '# Programme\n\n- [Morning](01_Cycle/Morning.md)\n- [Evening](01_Cycle/Evening.md)\n');
await writeFile(path.join(book, 'manuscript', '01_Cycle', 'Morning.md'), '# Morning\n\nThe kettle sings before the light,\nand frost writes slowly on the pane.\n\nA synthetic line for proofs.\n');
await writeFile(path.join(book, 'manuscript', '01_Cycle', 'Evening.md'), '# Evening\n\nThe lamp is lit, the ledger closed,\nthe orchard keeps its counted rows.\n');
console.log('Seeded one synthetic book.');
