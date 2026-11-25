import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { checkIgorPin, checkRuntimeMedia } from './checkout-prereqs.mjs';

function git(cwd, ...args) {
  return execFileSync('git', ['-c', 'user.name=STEX Test', '-c', 'user.email=stex-test@example.invalid',
    '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args], { cwd, encoding: 'utf8' }).trim();
}

function temporaryRepository(context) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'stex-checkout-'));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  git(directory, 'init', '--quiet');
  git(directory, 'commit', '--quiet', '--allow-empty', '-m', 'Fixture baseline');
  return directory;
}

test('the Igor preflight requires the exact committed pin', (context) => {
  const suite = temporaryRepository(context);
  const igor = path.join(suite, 'stex-igor');
  mkdirSync(igor);
  git(igor, 'init', '--quiet');
  git(igor, 'commit', '--quiet', '--allow-empty', '-m', 'Private fixture');
  const pin = git(igor, 'rev-parse', 'HEAD');
  git(suite, 'update-index', '--add', '--cacheinfo', `160000,${pin},stex-igor`);
  git(suite, 'commit', '--quiet', '-m', 'Pin private fixture');
  assert.deepEqual(checkIgorPin(suite), { ok: pin.slice(0, 12) });

  git(igor, 'commit', '--quiet', '--allow-empty', '-m', 'Unpinned private change');
  assert.match(checkIgorPin(suite).problem, /Expected .* found/);
  renameSync(igor, path.join(suite, 'uninitialized-fixture'));
  assert.match(checkIgorPin(suite).problem, /git submodule update --init stex-igor/);
});

test('runtime media preflight detects unresolved LFS pointers and missing media', (context) => {
  const directory = temporaryRepository(context);
  const relative = 'apps/pantheon/public/media/example.bin';
  const media = path.join(directory, relative);
  const payload = Buffer.from('Disposable media bytes for setup verification.');
  const digest = createHash('sha256').update(payload).digest('hex');
  mkdirSync(path.dirname(media), { recursive: true });
  writeFileSync(media, `version https://git-lfs.github.com/spec/v1\noid sha256:${digest}\nsize ${payload.length}\n`);
  git(directory, 'add', '--', relative);
  git(directory, 'commit', '--quiet', '-m', 'Track fixture pointer');
  assert.match(checkRuntimeMedia(directory, 'git lfs pull').problem, /example.bin.*LFS pointer/);

  writeFileSync(media, payload);
  assert.deepEqual(checkRuntimeMedia(directory, 'git lfs pull'), { ok: '1 available' });
  rmSync(media);
  assert.match(checkRuntimeMedia(directory, 'git lfs pull').problem, /example.bin.*missing/);
});
