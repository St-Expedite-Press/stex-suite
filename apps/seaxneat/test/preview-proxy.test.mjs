import assert from 'node:assert/strict';
import test from 'node:test';
import { previewPath, previewTarget } from '../src/preview-proxy.mjs';

test('accepts only explicit IPv4 loopback HTTP preview targets', () => {
  assert.equal(previewTarget('http://127.0.0.1:4545').href, 'http://127.0.0.1:4545/');
  for (const value of ['https://127.0.0.1:4545', 'http://localhost:4545', 'http://10.0.0.1:4545', 'http://127.0.0.1', 'http://user@127.0.0.1:4545']) assert.throws(() => previewTarget(value), /allowed loopback|invalid/);
});

test('keeps preview paths relative and rejects traversal encodings', () => {
  assert.equal(previewPath('assets/app.js'), '/assets/app.js'); assert.equal(previewPath(''), '/');
  for (const value of ['../secret', '%2e%2e/secret', 'assets\\secret']) assert.throws(() => previewPath(value), /Invalid preview path/);
});
