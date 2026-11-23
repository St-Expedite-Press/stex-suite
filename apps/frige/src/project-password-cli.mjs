#!/usr/bin/env node
/**
 * Operator tool for Frige project passwords (src/project-access.mjs).
 *
 *   STEX_FRIGE_ACCESS_FILE=<file> node src/project-password-cli.mjs set <book|project> <id>    (password on stdin)
 *   STEX_FRIGE_ACCESS_FILE=<file> node src/project-password-cli.mjs clear <book|project> <id>
 *   STEX_FRIGE_ACCESS_FILE=<file> node src/project-password-cli.mjs list
 *   STEX_FRIGE_ACCESS_FILE=<file> node src/project-password-cli.mjs init    (empty record; Frige refuses all projects while a configured file is missing)
 *
 * Run it as the user Frige runs as, so the file stays readable by Frige and
 * nobody else (mode 600). Passwords are read from stdin, never from arguments,
 * and are never printed. A changed password signs every browser out of that
 * project; Frige picks up the change without a restart.
 */
import { openProjectAccess } from './project-access.mjs';

const [command, kind, id] = process.argv.slice(2);
const file = process.env.STEX_FRIGE_ACCESS_FILE || '';
/** Prints a message and exits with a failure status. */
const fail = (message) => { console.error(message); process.exit(1); };
if (!file) fail('Set STEX_FRIGE_ACCESS_FILE to the project access file.');
// A root-owned mode-600 record would be unreadable to Frige and refuse every project.
if (process.getuid?.() === 0) fail('Run this as the user Frige runs as (for example with setpriv or sudo -u), not as root.');
const access = openProjectAccess({ file });

try {
  if (command === 'init') {
    const result = await access.initialize();
    console.log(result.created ? 'created an empty project access record' : 'the project access record already exists; unchanged');
  } else if (command === 'set') {
    if (process.stdin.isTTY) fail('Pipe the password in, for example: read -rs P && printf %s "$P" | node src/project-password-cli.mjs set book <id>');
    let password = '';
    for await (const chunk of process.stdin) password += chunk;
    const result = await access.setPassword(kind, id, password.replace(/\r?\n$/, ''));
    console.log(`password set for ${result.key} (version ${result.version}); earlier unlocks no longer work`);
  } else if (command === 'clear') {
    const result = await access.clearPassword(kind, id);
    console.log(result.removed ? `password removed from ${result.key}` : `${result.key} had no password`);
  } else if (command === 'list') {
    for (const entry of await access.list()) console.log(`${entry.key}\t${entry.protected ? 'protected' : 'cleared'}\tversion ${entry.version}\t${entry.updatedAt || ''}`);
  } else {
    fail('usage: project-password-cli.mjs set|clear <book|project> <id>, list, or init');
  }
} catch (error) {
  fail(error.message);
}
