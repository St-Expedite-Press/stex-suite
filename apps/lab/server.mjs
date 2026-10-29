import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const publicDirectory = path.join(directory, 'public');
const booksDirectory = path.resolve(process.env.STEX_BOOKS_DIR || path.join(directory, '..', 'texgraph', 'books'));
const port = Number(process.env.STEX_LAB_PORT || 4300);
const mime = { '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };

function idFor(title) { const stem = String(title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'book'; return `${stem}-${createHash('sha256').update(`${Date.now()}-${Math.random()}`).digest('hex').slice(0, 6)}`; }
function requireBookId(id) { if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(id)) throw new Error('Invalid book id.'); return id; }
function bookRoot(id) { const root = path.resolve(booksDirectory, requireBookId(id)); if (!root.startsWith(`${booksDirectory}${path.sep}`)) throw new Error('Invalid book path.'); return root; }
function setting(source, name, fallback, maximum = 4000) { return String(source[name] || fallback).trim().slice(0, maximum); }
async function atomic(file, content) { const temporary = `${file}.${process.pid}.tmp`; await writeFile(temporary, content, 'utf8'); await rename(temporary, file); }
async function exists(file) { try { await access(file); return true; } catch { return false; } }
async function textIfPresent(file) { try { return await readFile(file, 'utf8'); } catch { return ''; } }
function send(response, status, value) { response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); response.end(JSON.stringify(value)); }
async function body(request) { let raw = ''; for await (const part of request) { raw += part; if (raw.length > 100_000) throw new Error('Request too large.'); } try { return raw ? JSON.parse(raw) : {}; } catch { throw new Error('Request body must be JSON.'); } }

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

async function staticFile(response, file) { try { await access(file); response.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream' }); createReadStream(file).pipe(response); } catch { send(response, 404, { error: 'Not found.' }); } }

http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  try {
    if (url.pathname === '/api/books' && request.method === 'GET') return send(response, 200, await books());
    if (url.pathname === '/api/books' && request.method === 'POST') return send(response, 201, await createBook(await body(request)));
    const target = url.pathname === '/' ? '/suite.html' : url.pathname.endsWith('/') ? `${url.pathname}index.html` : url.pathname;
    const file = path.resolve(publicDirectory, `.${target}`);
    if (!file.startsWith(`${publicDirectory}${path.sep}`)) return send(response, 403, { error: 'Invalid path.' });
    await staticFile(response, file);
  } catch (error) { send(response, 400, { error: error.message || 'Request failed.' }); }
}).listen(port, '127.0.0.1', () => console.log(`STEX Lab is ready at http://127.0.0.1:${port}`));
