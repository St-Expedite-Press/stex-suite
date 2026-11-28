/**
 * Parity driver for backend/tests/test_knowledge_parity.py.
 *
 * Runs a JSON list of operations against the Node knowledge library
 * (services/knowledge/src/projections.mjs) in the given directory and prints
 * each result ({ok, value} or {error: {status, code}}) plus the final journal.
 * With "--replay" it only opens the directory and prints its view, proving the
 * Node library can read a journal the Python port wrote.
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const { openKnowledge } = await import(pathToFileURL(path.join(root, 'services', 'knowledge', 'src', 'projections.mjs')).href);

const [directory, mode] = process.argv.slice(2);
const knowledge = await openKnowledge({ directory });
try {
  if (mode === '--replay') {
    process.stdout.write(JSON.stringify({ view: knowledge.view() }));
  } else {
    let input = ''; for await (const chunk of process.stdin) input += chunk;
    const operations = JSON.parse(input);
    const results = [];
    for (const { op, body } of operations) {
      // Version placeholders are resolved against the live journal so both runtimes see the same sequence.
      const resolved = JSON.parse(JSON.stringify(body).replaceAll('"@version"', JSON.stringify(knowledge.view().version)));
      try { results.push({ ok: await knowledge[op](resolved) }); }
      catch (error) { results.push({ error: { status: error.status, code: error.code } }); }
    }
    process.stdout.write(JSON.stringify({ results, export: knowledge.export() }));
  }
} finally { await knowledge.close(); }
