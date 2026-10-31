import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { access, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const publicDirectory = path.join(directory, 'public');
const booksDirectory = path.resolve(process.env.STEX_BOOKS_DIR || path.join(directory, '..', 'texgraph', 'books'));
const port = Number(process.env.STEX_LAB_PORT || 4300);
const mime = { '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const obsidianConfig = process.env.STEX_OBSIDIAN_CONFIG || path.join(process.env.APPDATA || '', 'obsidian', 'obsidian.json');

function idFor(title) { const stem = String(title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'book'; return `${stem}-${createHash('sha256').update(`${Date.now()}-${Math.random()}`).digest('hex').slice(0, 6)}`; }
function requireBookId(id) { if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(id)) throw new Error('Invalid book id.'); return id; }
function bookRoot(id) { const root = path.resolve(booksDirectory, requireBookId(id)); if (!root.startsWith(`${booksDirectory}${path.sep}`)) throw new Error('Invalid book path.'); return root; }
function setting(source, name, fallback, maximum = 4000) { return String(source[name] || fallback).trim().slice(0, maximum); }
async function atomic(file, content) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(temporary, content, 'utf8');
  try {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try { await rename(temporary, file); return; }
      catch (error) {
        if (!['EACCES', 'EBUSY', 'EPERM'].includes(error?.code) || attempt === 7) throw error;
        await new Promise((resolve) => setTimeout(resolve, Math.min(500, 25 * (2 ** attempt))));
      }
    }
  } finally { await rm(temporary, { force: true }).catch(() => {}); }
}
async function exists(file) { try { await access(file); return true; } catch { return false; } }
async function textIfPresent(file) { try { return await readFile(file, 'utf8'); } catch { return ''; } }
function send(response, status, value) { response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); response.end(JSON.stringify(value)); }
async function body(request) { let raw = ''; for await (const part of request) { raw += part; if (raw.length > 12_000_000) throw new Error('Request too large.'); } try { return raw ? JSON.parse(raw) : {}; } catch { throw new Error('Request body must be JSON.'); } }

async function markdownCount(root) {
  let total = 0;
  async function visit(current) {
    const entries = await readdir(current, { withFileTypes: true });
    await Promise.all(entries.map(async (entry) => { if (entry.isDirectory()) await visit(path.join(current, entry.name)); else if (entry.isFile() && entry.name.endsWith('.md')) total += 1; }));
  }
  try { await visit(root); } catch { return 0; }
  return total;
}

async function bookSummary(id) {
  const root = bookRoot(id);
  const readme = await textIfPresent(path.join(root, 'README.md'));
  let settings = null;
  try { settings = JSON.parse(await readFile(path.join(root, 'texgraph', 'settings.json'), 'utf8')); } catch { /* Existing manuscripts may not have TexGraph metadata yet. */ }
  const manuscript = path.join(root, 'manuscript');
  const programme = await exists(path.join(manuscript, 'Programme.md'));
  const fallbackTitle = /^#\s+(.+)$/m.exec(readme)?.[1]?.trim() || id.replace(/-/g, ' ');
  const fallbackDescription = readme.split(/\r?\n/).find((line) => line.trim() && !line.startsWith('#') && !line.startsWith('-'))?.trim().replaceAll('*', '') || 'Manuscript project';
  return { id, title: settings?.identity?.title || fallbackTitle, author: settings?.identity?.author || '', description: settings?.editorial?.intent || fallbackDescription, state: settings ? 'configured' : programme ? 'manuscript-detected' : 'folder-detected', manuscriptNodes: await markdownCount(manuscript), programme, settingsTicket: Boolean(settings) };
}

async function books() {
  await mkdir(booksDirectory, { recursive: true });
  const entries = await readdir(booksDirectory, { withFileTypes: true });
  const records = await Promise.all(entries.filter((entry) => entry.isDirectory()).map((entry) => bookSummary(entry.name).catch(() => null)));
  return records.filter(Boolean).sort((left, right) => left.title.localeCompare(right.title));
}

function comparablePath(value) { return path.resolve(value).replace(/[\\/]+$/, '').toLowerCase(); }
function vaultContaining(vaults, target) {
  const targetPath = comparablePath(target);
  return Object.entries(vaults || {})
    .map(([id, vault]) => ({ id, ...vault, root: comparablePath(vault?.path || '') }))
    .filter((vault) => vault.root && (targetPath === vault.root || targetPath.startsWith(`${vault.root}${path.sep.toLowerCase()}`)))
    .sort((left, right) => right.root.length - left.root.length)[0] || null;
}
async function obsidianVaultForBook(id) {
  const root = bookRoot(id);
  const programme = path.join(root, 'manuscript', 'Programme.md');
  let configuration = { vaults: {} };
  try { configuration = JSON.parse(await readFile(obsidianConfig, 'utf8')); } catch { /* Obsidian writes this after its first launch. */ }
  configuration.vaults ||= {};
  const existing = vaultContaining(configuration.vaults, programme);
  if (existing) return { vault: existing, programme, registered: false };
  const vaultId = randomBytes(8).toString('hex');
  configuration.vaults[vaultId] = { path: root, ts: Date.now() };
  await atomic(obsidianConfig, `${JSON.stringify(configuration, null, 2)}\n`);
  return { vault: { id: vaultId, path: root, root: comparablePath(root) }, programme, registered: true };
}
async function launchObsidian(uri) {
  if (process.env.STEX_OBSIDIAN_NO_LAUNCH === '1') return;
  // Obsidian is a URI-protocol application. Passing its URI to Obsidian.exe
  // does not reliably forward an open request to an already running instance;
  // invoke the registered protocol handler instead.
  const command = process.platform === 'win32' ? 'rundll32.exe' : 'xdg-open';
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', uri] : [uri];
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}
async function openInObsidian(id) {
  const { vault, programme, registered } = await obsidianVaultForBook(id);
  const file = path.relative(vault.path, programme).replaceAll('\\', '/');
  const uri = `obsidian://open?vault=${encodeURIComponent(vault.id)}&file=${encodeURIComponent(file)}`;
  await launchObsidian(uri);
  return { opened: true, registered, vaultId: vault.id, programme: file, uri };
}

function acceptedTicket(payload, id) {
  const input = payload.ticket || {};
  const title = setting(input, 'title', '', 140);
  if (!title) throw new Error('The interview needs a working title before the project vault can be created.');
  return {
    schemaVersion: 1, id, acceptedAt: new Date().toISOString(),
    identity: { title, author: setting(input, 'author', 'Author', 160), subtitle: setting(input, 'subtitle', '', 180) },
    editorial: { kind: setting(input, 'bookType', 'poetry-collection', 80), intent: setting(input, 'editorialIntent', '', 4000), sourceMode: setting(input, 'sourceMode', 'start-blank', 80) },
    production: { podProfile: setting(input, 'podProfile', 'cross-pod', 60), format: 'paperback', trimSize: setting(input, 'trimSize', '6 × 9 in', 40), binding: 'perfect-bound', interiorInk: setting(input, 'interiorInk', 'black-white', 60), paperStock: setting(input, 'paperStock', 'white', 60), bleed: setting(input, 'bleed', 'no-bleed', 60), margins: setting(input, 'margins', '0.5 in', 30), isbnPlan: setting(input, 'isbnPlan', 'unassigned', 60), proofPlan: setting(input, 'proofPlan', 'order-proof', 60), coverFinish: setting(input, 'coverFinish', 'matte', 60) },
    structure: { manuscriptRoot: 'manuscript', programme: 'manuscript/Programme.md', notesRoot: 'notes', compiledRoot: 'compiled', assemblyStatus: 'not-mapped' },
  };
}

function markdownTicket(settings) {
  const { identity, editorial, production, structure } = settings;
  return ['---', `title: "${identity.title.replaceAll('"', '\\"')}"`, `author: "${identity.author.replaceAll('"', '\\"')}"`, 'tags:', '  - texgraph', '  - settings-ticket', 'status: accepted', `accepted: ${settings.acceptedAt}`, '---', '', '# Global Settings Ticket', '', '> [!success] Accepted project brief', '> This ticket came from the TexGraph interview. It is the readable, editable brief for this book.', '', '## Identity', '', `- **Title:** ${identity.title}`, `- **Author:** ${identity.author}`, `- **Kind:** ${editorial.kind}`, '', '## Editorial intent', '', editorial.intent || '_To be developed in the manuscript conversation._', '', '## Production brief', '', `- **Route:** ${production.podProfile}`, `- **Format:** ${production.format}; ${production.binding}`, `- **Trim:** ${production.trimSize}`, `- **Interior:** ${production.interiorInk}, ${production.paperStock}, ${production.bleed}`, `- **Safe margin:** ${production.margins}`, `- **ISBN:** ${production.isbnPlan}`, `- **Proof:** ${production.proofPlan}`, `- **Cover finish:** ${production.coverFinish}`, '', '## Manuscript graph', '', `- **Source mode:** ${editorial.sourceMode}`, `- **Programme:** [[../${structure.programme.replace('.md', '')}|Programme]]`, `- **Notes:** [[../${structure.notesRoot}|Project notes]]`, `- **Compiled deliverables:** \`${structure.compiledRoot}/\``, '', '> [!note] Assembly boundary', '> Reading order belongs to the Programme, not folder order. Manuscript, notes, and compiled deliverables are reconciled deliberately.', ''].join('\n');
}

async function createBook(payload) {
  const id = idFor(setting(payload.ticket || {}, 'title', 'book', 140));
  const root = bookRoot(id); const settings = acceptedTicket(payload, id);
  const transcript = Array.isArray(payload.transcript) ? payload.transcript.slice(-40).map((turn) => ({ role: setting(turn, 'role', 'user', 20), message: setting(turn, 'message', '', 4000), at: setting(turn, 'at', new Date().toISOString(), 50) })) : [];
  await Promise.all(['manuscript/00_Front_Matter', 'notes', 'compiled', 'texgraph', '.texgraph'].map((relative) => mkdir(path.join(root, relative), { recursive: true })));
  const titlePage = ['# ' + settings.identity.title, '', settings.identity.subtitle, settings.identity.author, ''].filter(Boolean).join('\n');
  const programme = ['---', `title: "${settings.identity.title.replaceAll('"', '\\"')}"`, 'tags:', '  - texgraph', '  - programme', '---', '', '# Programme', '', '- [[00_Front_Matter/Title Page|Title Page]]', '', '> [!todo] Map the reading order', '> Add movements, cycles, poems, and apparatus here. This programme, rather than folder order, will be the canonical reading sequence.', ''].join('\n');
  await Promise.all([
    atomic(path.join(root, 'README.md'), `# ${settings.identity.title}\n\n${settings.editorial.intent || 'A TexGraph book project.'}\n`),
    atomic(path.join(root, 'manuscript', 'Programme.md'), programme),
    atomic(path.join(root, 'manuscript', '00_Front_Matter', 'Title Page.md'), titlePage),
    atomic(path.join(root, 'texgraph', 'settings.json'), `${JSON.stringify(settings, null, 2)}\n`),
    atomic(path.join(root, 'texgraph', 'Global Settings Ticket.md'), markdownTicket(settings)),
    atomic(path.join(root, '.texgraph', 'interview.jsonl'), `${transcript.map((turn) => JSON.stringify(turn)).join('\n')}${transcript.length ? '\n' : ''}`),
  ]);
  return bookSummary(id);
}

const documentExtensions = new Set(['.md', '.txt', '.tex', '.csv', '.json', '.pdf', '.docx']);
const directlyReadableExtensions = new Set(['.md', '.txt', '.tex', '.csv', '.json']);

function documentPath(id, name) {
  const supplied = String(name || '');
  const base = path.basename(supplied);
  const extension = path.extname(base).toLowerCase();
  if (!base || base !== supplied || !documentExtensions.has(extension)) throw new Error('Unsupported document name or type.');
  const safeName = base.replace(/[^A-Za-z0-9._ -]/g, '_').slice(0, 160);
  return { extension, safeName };
}

async function documentManifest(root) {
  try {
    const value = JSON.parse(await readFile(path.join(root, '.texgraph', 'documents.json'), 'utf8'));
    return Array.isArray(value) ? value : [];
  } catch { return []; }
}

async function addDocuments(id, payload) {
  const root = bookRoot(id);
  if (!(await exists(root))) throw new Error('Book not found.');
  const uploads = Array.isArray(payload.documents) ? payload.documents : [];
  if (!uploads.length || uploads.length > 10) throw new Error('Choose between one and ten documents.');
  const manifest = await documentManifest(root);
  const created = [];
  for (const upload of uploads) {
    const { extension, safeName } = documentPath(id, upload?.name);
    if (typeof upload?.contentBase64 !== 'string' || upload.contentBase64.length > 11_200_000) throw new Error('Document content is missing or too large.');
    const bytes = Buffer.from(upload.contentBase64, 'base64');
    if (!bytes.length || bytes.length > 8_000_000) throw new Error('Each document must be between 1 byte and 8 MB.');
    const storedAs = `${Date.now()}-${createHash('sha256').update(bytes).digest('hex').slice(0, 10)}-${safeName}`;
    const destination = path.join(root, 'sources', storedAs);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, bytes, { flag: 'wx' });
    const documentId = createHash('sha256').update(`${storedAs}-${Date.now()}`).digest('hex').slice(0, 16);
    const record = { id: documentId, name: safeName, storedAs, mimeType: setting(upload, 'mimeType', 'application/octet-stream', 160), bytes: bytes.length, uploadedAt: new Date().toISOString(), contextState: 'awaiting-extraction' };
    if (directlyReadableExtensions.has(extension)) {
      const extraction = `extractions/${documentId}.txt`;
      await mkdir(path.join(root, '.texgraph', 'extractions'), { recursive: true });
      await atomic(path.join(root, '.texgraph', extraction), bytes.toString('utf8').slice(0, 200_000));
      record.extraction = extraction; record.contextState = 'pending-review'; record.extractedAt = new Date().toISOString();
    }
    manifest.push(record); created.push(record);
  }
  await mkdir(path.join(root, '.texgraph'), { recursive: true });
  await atomic(path.join(root, '.texgraph', 'documents.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return created;
}

async function reviewDocument(id, documentId, payload) {
  const root = bookRoot(id); const manifest = await documentManifest(root); const document = manifest.find((entry) => entry.id === documentId);
  if (!document) throw new Error('Document not found.');
  if (payload.approved !== true) { document.contextState = 'rejected'; document.reviewedAt = new Date().toISOString(); }
  else if (document.contextState === 'pending-review' && document.extraction) { document.contextState = 'approved'; document.reviewedAt = new Date().toISOString(); }
  else throw new Error('This document has no reviewed extraction to approve.');
  await atomic(path.join(root, '.texgraph', 'documents.json'), `${JSON.stringify(manifest, null, 2)}\n`); return document;
}

async function staticFile(response, file) { try { await access(file); response.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream' }); createReadStream(file).pipe(response); } catch { send(response, 404, { error: 'Not found.' }); } }

http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  try {
    if (url.pathname === '/api/books' && request.method === 'GET') return send(response, 200, await books());
    if (url.pathname === '/api/books' && request.method === 'POST') return send(response, 201, await createBook(await body(request)));
    const openMatch = /^\/api\/books\/([a-z0-9][a-z0-9-]{0,62})\/open-in-obsidian$/.exec(url.pathname);
    if (openMatch && request.method === 'POST') return send(response, 200, await openInObsidian(openMatch[1]));
    const documentMatch = /^\/api\/books\/([a-z0-9][a-z0-9-]{0,62})\/documents$/.exec(url.pathname);
    if (documentMatch && request.method === 'GET') return send(response, 200, await documentManifest(bookRoot(documentMatch[1])));
    if (documentMatch && request.method === 'POST') return send(response, 201, await addDocuments(documentMatch[1], await body(request)));
    const reviewMatch = /^\/api\/books\/([a-z0-9][a-z0-9-]{0,62})\/documents\/([a-f0-9]{16})\/review$/.exec(url.pathname);
    if (reviewMatch && request.method === 'POST') return send(response, 200, await reviewDocument(reviewMatch[1], reviewMatch[2], await body(request)));
    const target = url.pathname === '/' ? '/suite.html' : url.pathname.endsWith('/') ? `${url.pathname}index.html` : url.pathname;
    const file = path.resolve(publicDirectory, `.${target}`);
    if (!file.startsWith(`${publicDirectory}${path.sep}`)) return send(response, 403, { error: 'Invalid path.' });
    await staticFile(response, file);
  } catch (error) { send(response, 400, { error: error.message || 'Request failed.' }); }
}).listen(port, '127.0.0.1', () => console.log(`STEX Lab is ready at http://127.0.0.1:${port}`));
