// Mechanical instruction checks. Engineering authority remains in AGENTS.md.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = [...new Set(execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' }).trim().split('\n'))];
const charters = files.filter((file) => /(^|\/)AGENTS\.md$/.test(file));
const shims = files.filter((file) => /(^|\/)CLAUDE\.md$/.test(file));
let links = 0;
for (const file of charters) {
  const shim = file.replace(/AGENTS\.md$/, 'CLAUDE.md');
  assert.ok(shims.includes(shim), `${file}: missing sibling Claude shim`);
  const text = readFileSync(path.join(root, shim), 'utf8').replace(/^\uFEFF/, '').trim();
  assert.equal(text, '@AGENTS.md', `${shim}: keep the shim a single authoritative import`);
  const charter = readFileSync(path.join(root, file), 'utf8');
  for (const match of charter.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const ref = match[1].replace(/^<|>$/g, '').split('#')[0];
    if (!ref || /^[a-z]+:/i.test(ref)) continue;
    assert.ok(existsSync(path.resolve(root, path.dirname(file), decodeURIComponent(ref))), `${file}: unresolved ${ref}`);
    links++;
  }
}
for (const shim of shims) assert.ok(charters.includes(shim.replace(/CLAUDE\.md$/, 'AGENTS.md')), `${shim}: missing authority`);
const authority = readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
for (const target of ['Pantheon', 'Python', 'FastAPI', 'Obsidian']) assert.ok(authority.includes(target), `root charter omits ${target}`);
const roles = files.filter((file) => /^\.codex\/agents\/[^/]+\.toml$/.test(file));
for (const file of roles) {
  const source = readFileSync(path.join(root, file), 'utf8');
  for (const field of ['name', 'description', 'developer_instructions']) assert.match(source, new RegExp(`^${field}\\s*=`, 'm'), `${file}: missing ${field}`);
  assert.ok(source.includes('AGENTS.md'), `${file}: role must consult engineering authority`);
  assert.doesNotMatch(source, /^(model|model_provider|approval_policy|sandbox_mode|mcp_servers)\s*=/m, `${file}: inherit session model and permissions`);
}
console.log(JSON.stringify({ repository: path.basename(root), charters: charters.length, shims: shims.length, localLinks: links, developmentRoles: roles.length, result: 'PASS', claudeExecution: 'unverified when Claude CLI is absent' }));
