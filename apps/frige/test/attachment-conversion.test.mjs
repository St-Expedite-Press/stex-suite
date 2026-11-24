/**
 * Attachment conversion: every upload goes through the MarkItDown converter
 * when one is configured, its failures are recorded honestly, stored files can
 * be converted later, and the converter service itself sends only `data:` URIs
 * to the stock MCP server and enforces its limits.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
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
  const book = await (await fetch(`${base}/api/stex/publishing/v1/books`, { method: 'POST', headers: json, body: JSON.stringify({ title: 'Conversion Fixture', author: 'A. Author' }) })).json();
  const api = (route) => `${base}/api/stex/publishing/v1/project/attachments${route}?book=${book.id}`;
  const upload = async (files) => fetch(api(''), { method: 'POST', headers: json, body: JSON.stringify({ attachments: files.map(([name, content]) => ({ name, contentBase64: Buffer.from(content).toString('base64') })) }) });
  return { api, upload };
}

test('with a converter, every upload is converted to reviewable Markdown and failures are recorded', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'stex-frige-convert-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const converter = await fakeConverter(root);
  context.after(converter.close);
  const { api, upload } = await startFrige(context, root, 4432, { STEX_FRIGE_CONVERTER_SOCKET: converter.where });

  const created = await upload([['notes.md', 'Plain notes.'], ['Three Melodramas.pdf', '%PDF-1.7 synthetic']]);
  assert.equal(created.status, 201);
  const [notes, pdf] = await created.json();
  assert.deepEqual(converter.seen, ['notes.md', 'Three Melodramas.pdf'], 'text files go through MarkItDown too');
  for (const record of [notes, pdf]) {
    assert.equal(record.contextState, 'pending-review');
    assert.equal(record.converter, 'markitdown-mcp');
  }
  const preview = await (await fetch(api(`/${pdf.id}/excerpt`))).json();
  assert.match(preview.excerpt, /^# Three Melodramas\.pdf\n\n%PDF-1\.7 synthetic/);
  const approved = await fetch(api(`/${pdf.id}/approve`), { method: 'POST', headers: json, body: JSON.stringify({ hash: preview.hash }) });
  assert.equal(approved.status, 200);
  assert.equal((await fetch(api(`/${pdf.id}/convert`), { method: 'POST' })).status, 409, 'converted text is never replaced behind the author');

  converter.control.mode = 'no-text';
  const [scan] = await (await upload([['scan.pdf', '%PDF image only']])).json();
  assert.deepEqual([scan.contextState, scan.conversionError, scan.extraction], ['no-text', 'NO_TEXT', undefined]);
  converter.control.mode = 'fail';
  const [broken] = await (await upload([['draft.docx', 'PK synthetic']])).json();
  assert.deepEqual([broken.contextState, broken.conversionError], ['conversion-failed', 'CONVERSION_FAILED']);
  assert.equal((await fetch(api(`/${broken.id}/excerpt`))).status, 404);

  converter.control.mode = 'ok';
  const retried = await fetch(api(`/${broken.id}/convert`), { method: 'POST' });
  assert.equal(retried.status, 200);
  const record = await retried.json();
  assert.deepEqual([record.contextState, record.converter, record.conversionError], ['pending-review', 'markitdown-mcp', undefined]);
  assert.match((await (await fetch(api(`/${broken.id}/excerpt`))).json()).excerpt, /^# draft\.docx/);
  assert.equal((await fetch(api('/0000000000000000/convert'), { method: 'POST' })).status, 404);
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
  await setMode('ok');
  assert.equal((await converter.convert({ name: 'after.txt', bytes: Buffer.from('still serving') })).markdown, '# Converted text/plain\n\nstill serving');
});

test('the converter client reports an unreachable converter', async () => {
  const converter = createDocumentConverter({ socketPath: socketPath(os.tmpdir(), 'missing'), timeoutMs: 2_000 });
  await assert.rejects(converter.convert({ name: 'a.pdf', bytes: Buffer.from('x') }), (error) => error instanceof ConversionError && error.code === 'CONVERTER_UNAVAILABLE');
  assert.equal(createDocumentConverter({}), null);
});
