/**
 * Attachment conversion: every upload goes through the MarkItDown converter
 * when one is configured, its failures are recorded honestly, stored files can
 * be converted later, and the converter service itself sends only `data:` URIs
 * to the stock MCP server and enforces its limits.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { ConversionError, createDocumentConverter } from '../src/document-converter.mjs';

const appDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const json = { 'content-type': 'application/json' };
const socketPath = (directory, name) => (process.platform === 'win32' ? `\\\\.\\pipe\\stex-frige-${name}-${randomBytes(6).toString('hex')}` : path.join(directory, `${name}.sock`));

/** A stand-in converter on a local socket. `mode` decides each reply; every request is recorded. */
async function fakeConverter(directory) {
  const seen = []; const control = { mode: 'ok' };
  const server = http.createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      const upload = JSON.parse(body); seen.push(upload.name);
      const reply = (status, value) => { response.writeHead(status, json); response.end(JSON.stringify(value)); };
      if (control.mode === 'no-text') return reply(422, { error: { code: 'NO_TEXT' } });
      if (control.mode === 'fail') return reply(500, { error: { code: 'CONVERSION_FAILED' } });
      reply(200, { markdown: `# ${upload.name}\n\n${Buffer.from(upload.contentBase64, 'base64').toString('latin1').slice(0, 40)}`, converter: 'markitdown-mcp' });
    });
  });
  const where = socketPath(directory, 'fake-converter');
  await new Promise((resolve) => server.listen(where, resolve));
  return { where, seen, control, close: () => new Promise((resolve) => server.close(resolve)) };
}

/** Starts Frige on `port` with optional extra environment and resolves its base URL. */
async function startFrige(context, root, port, extra = {}) {
  const child = spawn(process.execPath, ['server.mjs'], { cwd: appDirectory, env: {
    ...process.env, STEX_FRIGE_PORT: String(port), STEX_FRIGE_PROJECT_DIR: root, STEX_FRIGE_BOOKS_DIR: path.join(root, 'books'),
    STEX_FRIGE_BASE_PATH: '/frige', STEX_FRIGE_SHELL_URL: '/', STEX_FRIGE_INFERENCE_MODE: 'fake', STEX_FRIGE_CONVERTER_SOCKET: '', ...extra,
  } });
  context.after(async () => { const exited = new Promise((resolve) => child.once('exit', resolve)); child.kill(); await exited; });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Frige server did not start.')), 5_000);
    child.stdout.on('data', (data) => { if (data.toString().includes('ready')) { clearTimeout(timeout); resolve(); } });
    child.on('error', reject);
  });
  const base = `http://127.0.0.1:${port}/frige`;
  const createBook = async (title) => {
    const response = await fetch(`${base}/api/stex/publishing/v1/books`, { method: 'POST', headers: json, body: JSON.stringify({ title, author: 'A. Author' }) });
    assert.equal(response.status, 201);
    return response.json();
  };
  const book = await createBook('Conversion Fixture');
  const api = (route) => `${base}/api/stex/publishing/v1/project/attachments${route}?book=${book.id}`;
  const upload = async (files) => fetch(api(''), { method: 'POST', headers: json, body: JSON.stringify({ attachments: files.map(([name, content]) => ({ name, contentBase64: Buffer.from(content).toString('base64') })) }) });
  return { api, upload, base, book, createBook };
}

test('with a converter, every upload is converted to reviewable Markdown and failures are recorded', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'stex-frige-convert-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const converter = await fakeConverter(root);
  let open = true;
  context.after(() => open && converter.close());
  const { api, upload } = await startFrige(context, root, 4432, { STEX_FRIGE_CONVERTER_SOCKET: converter.where });
  const convert = async (id) => fetch(api(`/${id}/convert`), { method: 'POST' });
  const convertOk = async (id) => { const response = await convert(id); assert.equal(response.status, 200); return response.json(); };

  // The upload only stores the files; the client converts each one with its own request.
  const created = await upload([['notes.md', 'Plain notes.'], ['Three Melodramas.pdf', '%PDF-1.7 synthetic']]);
  assert.equal(created.status, 201);
  const [notes, pdf] = await created.json();
  assert.deepEqual([notes.contextState, pdf.contextState, converter.seen], ['awaiting-extraction', 'awaiting-extraction', []]);
  for (const record of [await convertOk(notes.id), await convertOk(pdf.id)]) {
    assert.deepEqual([record.contextState, record.converter], ['pending-review', 'markitdown-mcp']);
  }
  assert.deepEqual(converter.seen, ['notes.md', 'Three Melodramas.pdf'], 'text files go through MarkItDown too');
  const preview = await (await fetch(api(`/${pdf.id}/excerpt`))).json();
  assert.match(preview.excerpt, /^# Three Melodramas\.pdf\n\n%PDF-1\.7 synthetic/);
  const approved = await fetch(api(`/${pdf.id}/approve`), { method: 'POST', headers: json, body: JSON.stringify({ hash: preview.hash }) });
  assert.equal(approved.status, 200);
  const again = await convert(pdf.id);
  assert.deepEqual([again.status, (await again.json()).code], [409, 'ALREADY_CONVERTED'], 'converted text is never replaced behind the author');

  converter.control.mode = 'no-text';
  const [scan] = await (await upload([['scan.pdf', '%PDF image only']])).json();
  const scanned = await convertOk(scan.id);
  assert.deepEqual([scanned.contextState, scanned.conversionError, scanned.extraction], ['no-text', 'NO_TEXT', undefined]);
  converter.control.mode = 'fail';
  const [broken] = await (await upload([['draft.docx', 'PK synthetic']])).json();
  const failed = await convertOk(broken.id);
  assert.deepEqual([failed.contextState, failed.conversionError], ['conversion-failed', 'CONVERSION_FAILED']);
  assert.equal((await fetch(api(`/${broken.id}/excerpt`))).status, 404);
  converter.control.mode = 'ok';
  const retried = await convertOk(broken.id);
  assert.deepEqual([retried.contextState, retried.converter, retried.conversionError], ['pending-review', 'markitdown-mcp', undefined]);
  assert.match((await (await fetch(api(`/${broken.id}/excerpt`))).json()).excerpt, /^# draft\.docx/);
  assert.equal((await convert('0000000000000000')).status, 404);

  // A long name keeps its extension, which decides how the file is converted.
  const [long] = await (await upload([[`${'n'.repeat(200)}.pdf`, '%PDF long']])).json();
  assert.ok(long.name.endsWith('.pdf') && long.name.length <= 160, long.name);
  assert.equal((await convertOk(long.id)).contextState, 'pending-review');

  // A converter outage fails PDF and Word files honestly, but plain-text files are still read as UTF-8.
  const [text, word] = await (await upload([['outage.txt', 'Read while the converter is down.'], ['outage.docx', 'PK']])).json();
  await converter.close(); open = false;
  const plain = await convertOk(text.id);
  assert.deepEqual([plain.contextState, plain.converter], ['pending-review', 'utf8']);
  const down = await convertOk(word.id);
  assert.deepEqual([down.contextState, down.conversionError], ['conversion-failed', 'CONVERTER_UNAVAILABLE']);
});

test('without a converter, text files are decoded and PDF or Word files wait for one', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'stex-frige-noconvert-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const { api, upload } = await startFrige(context, root, 4433);
  const [notes, pdf] = await (await upload([['notes.md', 'Synthetic café.'], ['book.pdf', '%PDF-1.7']])).json();
  assert.deepEqual([notes.contextState, notes.converter], ['pending-review', 'utf8']);
  assert.equal((await (await fetch(api(`/${notes.id}/excerpt`))).json()).excerpt, 'Synthetic café.');
  assert.deepEqual([pdf.contextState, pdf.extraction], ['conversion-unavailable', undefined]);
  const refused = await fetch(api(`/${pdf.id}/convert`), { method: 'POST' });
  assert.deepEqual([refused.status, (await refused.json()).code], [503, 'CONVERTER_UNAVAILABLE']);
});

test('both upload APIs identify identical available source bytes without sharing approval or crossing book boundaries', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'stex-frige-source-identity-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const { api, upload, base, book, createBook } = await startFrige(context, root, 4546);
  const bookRoot = path.join(root, 'books', book.id);
  const manifestPath = path.join(bookRoot, '.texgraph', 'documents.json');
  const legacyUrl = `${base}/api/stex/legacy-books/v1/${book.id}/documents`;
  const file = (name, content) => ({ name, contentBase64: Buffer.from(content).toString('base64') });
  const legacy = (name, content) => fetch(legacyUrl, { method: 'POST', headers: json, body: JSON.stringify({ documents: [file(name, content)] }) });
  const created = async (response) => {
    const result = await response;
    assert.equal(result.status, 201);
    return result.json();
  };
  const onDisk = async () => JSON.parse(await readFile(manifestPath, 'utf8'));

  const original = Buffer.from('Synthetic café\r\n');
  const originalHash = createHash('sha256').update(original).digest('hex');
  const [older] = await created(legacy('old.md', original));
  assert.equal(older.sourceSha256, originalHash);
  const earlier = await onDisk();
  delete earlier[0].sourceSha256; // Model a manifest from before source hashes were recorded.
  await writeFile(manifestPath, JSON.stringify(earlier), 'utf8');
  const preview = await (await fetch(api(`/${older.id}/excerpt`))).json();
  const approved = await fetch(api(`/${older.id}/approve`), { method: 'POST', headers: json, body: JSON.stringify({ hash: preview.hash }) });
  assert.equal(approved.status, 200);

  const different = Buffer.from(original);
  different[0] = 0x73;
  const [same, sameLength] = await created(upload([['copy.txt', original], ['different.txt', different]]));
  assert.equal(same.sourceSha256, originalHash);
  assert.equal(same.duplicateOf, older.id);
  assert.notEqual(same.id, older.id);
  assert.notEqual(same.storedAs, older.storedAs);
  assert.equal(same.contextState, 'pending-review');
  assert.equal(same.approvalHash, undefined);
  assert.equal(sameLength.duplicateOf, undefined);
  assert.notEqual(sameLength.sourceSha256, originalHash);
  const manifest = await onDisk();
  assert.equal(manifest[0].contextState, 'approved');
  assert.equal(manifest[0].sourceSha256, undefined);
  assert.ok(manifest.every((entry) => !Object.hasOwn(entry, 'duplicateOf')));
  assert.deepEqual(await readFile(path.join(bookRoot, 'sources', same.storedAs)), original);

  const [first, repeated] = await created(upload([['repeat.md', 'A batch match'], ['repeat.md', 'A batch match']]));
  assert.notEqual(first.id, repeated.id);
  assert.notEqual(first.storedAs, repeated.storedAs);
  assert.equal(repeated.duplicateOf, first.id);
  const [fromPublishing] = await created(legacy('from-publishing.txt', 'A batch match'));
  assert.equal(fromPublishing.duplicateOf, first.id);
  assert.equal(fromPublishing.sourceSha256, first.sourceSha256);

  const concurrent = await Promise.all([
    created(legacy('first-simultaneous.txt', 'Concurrent original')),
    created(upload([['second-simultaneous.md', 'Concurrent original']])),
  ]);
  const [winner, follower] = concurrent.flat().sort((a, b) => Number(Boolean(a.duplicateOf)) - Number(Boolean(b.duplicateOf)));
  assert.equal(winner.duplicateOf, undefined);
  assert.equal(follower.duplicateOf, winner.id);

  // A stored hash is only a hint. An unavailable, changed or outside original cannot match.
  await rm(path.join(bookRoot, 'sources', sameLength.storedAs));
  const [replacement] = await created(upload([['replacement.txt', different]]));
  assert.equal(replacement.duplicateOf, undefined);
  const edited = Buffer.from(different);
  edited[1] = 0x59;
  await writeFile(path.join(bookRoot, 'sources', replacement.storedAs), edited);
  const [fresh] = await created(legacy('fresh.txt', different));
  assert.equal(fresh.duplicateOf, undefined);

  const outside = 'Outside the sources directory';
  await writeFile(path.join(bookRoot, 'outside.txt'), outside);
  const withOutside = await onDisk();
  withOutside.push({ id: '1111111111111111', storedAs: '../outside.txt', bytes: Buffer.byteLength(outside) });
  await writeFile(manifestPath, JSON.stringify(withOutside), 'utf8');
  const [contained] = await created(legacy('contained.txt', outside));
  assert.equal(contained.duplicateOf, undefined);

  const other = await createBook('Another Conversion Fixture');
  const [isolated] = await created(fetch(`${base}/api/stex/publishing/v1/project/attachments?book=${other.id}`, {
    method: 'POST', headers: json, body: JSON.stringify({ attachments: [file('isolated.md', original)] }),
  }));
  assert.equal(isolated.sourceSha256, originalHash);
  assert.equal(isolated.duplicateOf, undefined);
});

test('attachments refuse a linked sources directory before writing originals', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'stex-frige-linked-sources-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const { upload, book } = await startFrige(context, root, 4547);
  const outside = path.join(root, 'outside');
  await mkdir(outside);
  const bookRoot = path.join(root, 'books', book.id);
  await symlink(outside, path.join(bookRoot, 'sources'), process.platform === 'win32' ? 'junction' : 'dir');

  const response = await upload([['linked-upload.txt', 'Synthetic original']]);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, 'ATTACHMENTS_UNAVAILABLE');
  assert.deepEqual(await readdir(outside), []);
  await assert.rejects(readFile(path.join(bookRoot, '.texgraph', 'documents.json'), 'utf8'), { code: 'ENOENT' });
});

test('duplicate detection accepts an exact digestless legacy original whose stored name ends in a space', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'stex-frige-legacy-source-name-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const { upload, base, book } = await startFrige(context, root, 4548);
  const data = Buffer.from('Synthetic content for an exact legacy original');
  const legacyUrl = `${base}/api/stex/legacy-books/v1/${book.id}/documents`;
  // The legacy API truncated the whole sanitized name at 160 characters.
  const legacy = await fetch(legacyUrl, {
    method: 'POST', headers: json,
    body: JSON.stringify({ documents: [{ name: `${'a'.repeat(159)} notes.md`, contentBase64: data.toString('base64') }] }),
  });
  assert.equal(legacy.status, 201);
  const [earlier] = await legacy.json();
  assert.ok(earlier.storedAs.endsWith(' '));
  const bookRoot = path.join(root, 'books', book.id);
  assert.ok((await readdir(path.join(bookRoot, 'sources'))).includes(earlier.storedAs));
  const manifest = path.join(bookRoot, '.texgraph', 'documents.json');
  delete earlier.sourceSha256;
  await writeFile(manifest, JSON.stringify([earlier]), 'utf8');

  const repeated = await upload([['new-name.md', data]]);
  assert.equal(repeated.status, 201);
  const [record] = await repeated.json();
  assert.equal(record.duplicateOf, earlier.id);
});

test('deferred conversion rejects a changed upload receipt and accepts digestless legacy originals', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'stex-frige-convert-receipt-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const converter = await fakeConverter(root);
  context.after(() => converter.close());
  const { api, upload, book } = await startFrige(context, root, 4549, { STEX_FRIGE_CONVERTER_SOCKET: converter.where });
  const [modern, legacy] = await (await upload([['modern.pdf', '%PDF original'], ['legacy.pdf', '%PDF historical']])).json();
  const bookRoot = path.join(root, 'books', book.id);
  const manifest = path.join(bookRoot, '.texgraph', 'documents.json');
  const accepted = await readFile(manifest, 'utf8');
  await writeFile(path.join(bookRoot, 'sources', modern.storedAs), '%PDF adjusted');

  const convert = (id) => fetch(api(`/${id}/convert`), { method: 'POST' });
  const denied = await convert(modern.id);
  assert.deepEqual([denied.status, (await denied.json()).code], [409, 'ATTACHMENT_CHANGED']);
  assert.deepEqual(converter.seen, []);
  assert.equal(await readFile(manifest, 'utf8'), accepted);
  await assert.rejects(readFile(path.join(bookRoot, '.texgraph', 'extractions', `${modern.id}.txt`)), { code: 'ENOENT' });

  const records = JSON.parse(accepted);
  delete records.find((entry) => entry.id === legacy.id).sourceSha256;
  await writeFile(manifest, JSON.stringify(records), 'utf8');
  const converted = await convert(legacy.id);
  assert.equal(converted.status, 200);
  assert.equal((await converted.json()).contextState, 'pending-review');
  assert.deepEqual(converter.seen, ['legacy.pdf']);
});

// The service itself needs Python's Unix sockets, so it runs on Linux and macOS (CI), not on Windows.
const posix = process.platform !== 'win32';

const FAKE_MCP = String.raw`
import base64, json, sys, time
from pathlib import Path
mode = Path(__file__).with_name("mode").read_text().strip()
for line in sys.stdin:
    message = json.loads(line)
    if "id" not in message:
        continue
    method = message["method"]
    if method == "initialize":
        result = {"protocolVersion": message["params"]["protocolVersion"], "capabilities": {"tools": {}}, "serverInfo": {"name": "fake", "version": "1"}}
    elif method == "tools/list":
        tools = [{"name": "convert_to_markdown", "inputSchema": {"type": "object"}}]
        result = {"tools": tools + ([{"name": "read_file", "inputSchema": {"type": "object"}}] if mode == "extra-tool" else [])}
    else:
        uri = message["params"]["arguments"]["uri"]
        if not uri.startswith("data:"):
            result = {"isError": True, "content": [{"type": "text", "text": "not a data URI"}]}
        else:
            media, data = uri[5:].split(";base64,", 1)
            if mode == "hang":
                Path(__file__).with_name("hung.pid").write_text(str(__import__("os").getpid()))
                time.sleep(30)
            text = "   " if mode == "empty" else "# Converted " + media + "\n\n" + base64.b64decode(data).decode("utf-8", "replace")
            result = {"content": [{"type": "text", "text": text}]}
    print(json.dumps({"jsonrpc": "2.0", "id": message["id"], "result": result}), flush=True)
`;

test('the converter service sends only data URIs to the stock server and enforces its limits', { skip: !posix && 'needs Unix sockets in Python' }, async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'stex-frige-markitdown-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const fake = path.join(root, 'fake', 'markitdown_mcp');
  await mkdir(fake, { recursive: true });
  await writeFile(path.join(fake, '__init__.py'), '');
  await writeFile(path.join(fake, '__main__.py'), FAKE_MCP);
  const setMode = (mode) => writeFile(path.join(fake, 'mode'), mode);
  await setMode('ok');
  const where = path.join(root, 'convert.sock');
  const source = path.join(appDirectory, 'src');
  const service = spawn('python3', ['-c', `import sys; sys.path.insert(0, ${JSON.stringify(source)}); import document_convert as d; d.serve(${JSON.stringify(where)}, seconds=2)`],
    { env: { PATH: process.env.PATH, PYTHONPATH: path.join(root, 'fake') } });
  context.after(async () => { const exited = new Promise((resolve) => service.once('exit', resolve)); service.kill(); await exited; });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('The converter did not start.')), 10_000);
    service.stderr.on('data', (data) => { if (data.toString().includes('is ready')) { clearTimeout(timeout); resolve(); } });
    service.on('exit', (code) => reject(new Error(`The converter exited with ${code}.`)));
  });
  assert.equal((await stat(where)).mode & 0o777, 0o660);
  const converter = createDocumentConverter({ socketPath: where, timeoutMs: 20_000 });
  const code = (promise) => promise.then(() => 'converted', (error) => (error instanceof ConversionError ? error.code : String(error)));

  const pdf = await converter.convert({ name: 'Three Melodramas.pdf', bytes: Buffer.from('synthetic pdf text') });
  assert.equal(pdf.markdown, '# Converted application/pdf\n\nsynthetic pdf text');
  const docx = await converter.convert({ name: 'draft.docx', bytes: Buffer.from('word text') });
  assert.match(docx.markdown, /^# Converted application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document/);
  assert.equal((await converter.convert({ name: 'notes.md', bytes: Buffer.from('# Notes') })).markdown, '# Converted text/markdown\n\n# Notes');

  assert.equal(await code(converter.convert({ name: 'payload.exe', bytes: Buffer.from('x') })), 'UNSUPPORTED_TYPE');
  assert.equal(await code(converter.convert({ name: '../escape.pdf', bytes: Buffer.from('x') })), 'INVALID_NAME');
  await setMode('extra-tool');
  assert.equal(await code(converter.convert({ name: 'a.pdf', bytes: Buffer.from('x') })), 'UNEXPECTED_SERVER');
  await setMode('empty');
  assert.equal(await code(converter.convert({ name: 'a.pdf', bytes: Buffer.from('x') })), 'NO_TEXT');
  await setMode('hang');
  const started = Date.now();
  assert.equal(await code(converter.convert({ name: 'a.pdf', bytes: Buffer.from('x') })), 'CONVERSION_TIMEOUT');
  assert.ok(Date.now() - started < 10_000, 'the time limit stops a hung conversion');
  const hung = Number((await readFile(path.join(fake, 'hung.pid'), 'utf8')).trim());
  const alive = async () => readFile(`/proc/${hung}/stat`, 'utf8').then((line) => line.split(') ')[1]?.[0] !== 'Z', () => false);
  for (let tries = 0; tries < 50 && await alive(); tries += 1) await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(await alive(), false, 'the hung MarkItDown process was killed');
  await setMode('ok');
  assert.equal((await converter.convert({ name: 'after.txt', bytes: Buffer.from('still serving') })).markdown, '# Converted text/plain\n\nstill serving');
});

test('the converter client reports an unreachable converter', async () => {
  const converter = createDocumentConverter({ socketPath: socketPath(os.tmpdir(), 'missing'), timeoutMs: 2_000 });
  await assert.rejects(converter.convert({ name: 'a.pdf', bytes: Buffer.from('x') }), (error) => error instanceof ConversionError && error.code === 'CONVERTER_UNAVAILABLE');
  assert.equal(createDocumentConverter({}), null);
});
