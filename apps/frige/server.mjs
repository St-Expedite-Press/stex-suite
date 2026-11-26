/** Frige HTTP entry point for publishing, compatibility routes, and engine-owned state. */
import { createReadStream, existsSync } from 'node:fs';
import { pipeline } from 'node:stream';
import { access, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { legacyBooksApi } from './src/legacy-books.mjs';
import { openProjectAccess } from './src/project-access.mjs';
import { editorialRoute, publishingRoute } from './src/publishing-contract.mjs';
import { projectContext, validateContextTree } from './src/project-context.mjs';
import { knowledgeEvent } from './src/knowledge-event.mjs';
import { BookStore, writeAtomic } from './src/project-store.mjs';
import { mutateAttachments, readAttachmentManifest, storeAttachmentOriginal } from './src/attachment-manifest.mjs';
import { ProjectStore } from './src/project-store-vault.mjs';
import { LOCAL_ACTOR, actorRefused, resolveActor } from './src/actor.mjs';
import { MAIN_CONVERSATION } from './src/editorial-sessions.mjs';
import { buildPage, TRIM_SIZES } from './src/lualatex.mjs';
import { buildBook, resolveHeadTitle } from './src/book-assembler.mjs';
import { designHash } from './src/design-settings.mjs';
import { PASSAGE_ACTIONS, resolvePassage } from './src/change-contract.mjs';
import { runPreflight } from './src/preflight.mjs';
import { createDocumentConverter } from './src/document-converter.mjs';
import { gatewaySettings, inferenceHealth, requestPageRevision, requestScopeTurn } from './src/inference-client.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const publicDirectory = path.join(directory, 'public');
const appEnvironment = new Set(['STEX_BOOKS_DIR', 'STEX_PANTHEON_URL', 'STEX_INFERENCE_URL', 'STEX_INFERENCE_SHARED_SECRET', 'STEX_FRIGE_INFERENCE_MODE', 'STEX_FRIGE_PORT', 'STEX_FRIGE_PROJECT_DIR', 'STEX_FRIGE_PROJECTS_DIR', 'STEX_FRIGE_BOOKS_DIR', 'STEX_FRIGE_BASE_PATH', 'STEX_FRIGE_SHELL_URL', 'STEX_FRIGE_ACCESS_FILE', 'STEX_FRIGE_CONVERTER_SOCKET', 'STEX_PLATFORM_ACTOR_SECRET', 'TEXGRAPH_INFERENCE_MODE', 'TEXGRAPH_PORT', 'TEXGRAPH_PROJECT_DIR', 'TEXGRAPH_PROJECTS_DIR', 'TEXGRAPH_BOOKS_DIR', 'TEXGRAPH_BASE_PATH', 'TEXGRAPH_SHELL_URL']);
try {
  const localEnv = await readFile(path.resolve(directory, '..', '..', '.env'), 'utf8');
  for (const line of localEnv.split(/\r?\n/)) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (match && appEnvironment.has(match[1]) && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
} catch { /* The host may provide application-safe configuration directly. */ }
/** Resolves a canonical setting, then its compatibility setting, then the default. */
function configuration(canonical, legacy, fallback) {
  const current = process.env[canonical]; const previous = process.env[legacy];
  if (current && previous && current !== previous) console.warn(`${canonical} takes precedence over ${legacy}.`);
  return current || previous || fallback;
}
/** Keeps an existing compatibility path when the canonical location is absent. */
function preservedDefault(current, legacy) { return existsSync(current) || !existsSync(legacy) ? current : legacy; }
const legacyDirectory = path.join(directory, '..', 'texgraph');
const projectDirectory = path.resolve(configuration('STEX_FRIGE_PROJECT_DIR', 'TEXGRAPH_PROJECT_DIR', preservedDefault(path.join(directory, '.local-book'), path.join(legacyDirectory, '.local-book'))));
const projectsDirectory = path.resolve(configuration('STEX_FRIGE_PROJECTS_DIR', 'TEXGRAPH_PROJECTS_DIR', path.join(directory, '..', 'pantheon', '.local-projects')));
const booksDirectory = path.resolve(configuration('STEX_FRIGE_BOOKS_DIR', 'TEXGRAPH_BOOKS_DIR', process.env.STEX_BOOKS_DIR || path.join(directory, 'books')));
const platformOrigin = new URL(process.env.STEX_PANTHEON_URL || 'http://127.0.0.1:4300');
if (platformOrigin.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(platformOrigin.hostname) || platformOrigin.username || platformOrigin.password || platformOrigin.pathname !== '/' || platformOrigin.search || platformOrigin.hash) throw new Error('STEX_PANTHEON_URL must be a loopback HTTP origin.');
const defaultStore = new BookStore(projectDirectory);
const projectStores = new Map();
const port = Number(configuration('STEX_FRIGE_PORT', 'TEXGRAPH_PORT', 4310));
// Container mode (deploy/compose): bind every interface and answer the fixed
// peer service names in STEX_INTERNAL_HOSTS on this port. Native runs keep
// 127.0.0.1 and loopback Host names only. Browser origins are unchanged.
if (![undefined, '', '0', '1'].includes(process.env.STEX_BIND_ALL)) throw new Error('STEX_BIND_ALL must be 1 or unset.');
const listenAddress = process.env.STEX_BIND_ALL === '1' ? '0.0.0.0' : '127.0.0.1';
const internalNames = String(process.env.STEX_INTERNAL_HOSTS || '').split(',').map((name) => name.trim()).filter(Boolean);
for (const name of internalNames) if (!/^[a-z][a-z0-9-]{0,62}$/.test(name) || name === 'localhost') throw new Error(`STEX_INTERNAL_HOSTS contains an invalid service name: ${name}`);
const acceptedHosts = new Set(internalNames.map((name) => `${name}:${port}`));
/** Accepts a loopback Host, or exactly `<internal name>:<this port>` in container mode. */
const acceptedHost = (value) => /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(value || '') || acceptedHosts.has(value || '');
/** Validates the normalized mount prefix for publishing routes. */
function basePath(value) {
  const normalized = String(value || '').trim().replace(/\/+$/, '');
  if (!normalized) return '';
  if (!/^\/[a-z0-9-]+(?:\/[a-z0-9-]+)*$/i.test(normalized)) throw new Error('STEX_FRIGE_BASE_PATH must be an absolute path without traversal.');
  return normalized;
}
const mountedAt = basePath(configuration('STEX_FRIGE_BASE_PATH', 'TEXGRAPH_BASE_PATH', ''));
// Optional per-project passwords (src/project-access.mjs); unset means no project is protected.
const projectAccess = openProjectAccess({ file: process.env.STEX_FRIGE_ACCESS_FILE || '' });
// With a converter configured, every upload is converted to Markdown by MarkItDown before review.
const converter = createDocumentConverter({ socketPath: process.env.STEX_FRIGE_CONVERTER_SOCKET || '' });
const unlockCookiePath = `${mountedAt}/`;
const shellUrl = String(configuration('STEX_FRIGE_SHELL_URL', 'TEXGRAPH_SHELL_URL', mountedAt ? '/home/' : '')).trim() || '/';

const mimeTypes = {
  '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.pdf': 'application/pdf',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.mp4': 'video/mp4', '.webm': 'video/webm', '.woff2': 'font/woff2',
};
// The shared design system (@stex/design-system) is served read-only from this
// origin under /design-system/; only its public folders are reachable.
const designSystemDirectory = path.dirname(createRequire(import.meta.url).resolve('@stex/design-system/package.json'));
const designSystemFolders = new Set(['src', 'fonts', 'brand', 'icons']);
/** Resolves a permitted public design-system resource. */
function designSystemFile(pathname) {
  // No ':' anywhere: on Windows it would reach NTFS stream aliases such as `::$DATA`.
  if (pathname.includes(':')) return null;
  const file = path.resolve(designSystemDirectory, pathname.slice('/design-system/'.length));
  const folder = path.relative(designSystemDirectory, file).split(path.sep)[0];
  return file.startsWith(`${designSystemDirectory}${path.sep}`) && designSystemFolders.has(folder) ? file : null;
}
// The proof viewer's PDF.js browser build; only these two files are exposed.
const pdfjsFiles = new Set(['pdf.min.mjs', 'pdf.worker.min.mjs']);
/** Maps an allowed PDF.js resource name to its installed path. */
function pdfjsFile(name) {
  try { return path.join(path.dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json')), 'build', name); } catch { return null; }
}

/** Sends an uncached JSON response with the selected HTTP status. */
function json(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(value));
}

/** Reads and validates a bounded JSON request body. */
async function body(request) {
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  const decode = (chunk, stream) => {
    try { return decoder.decode(chunk, { stream }); }
    catch { throw new Error('Request body must be valid UTF-8.'); }
  };
  let raw = '';
  for await (const chunk of request) {
    raw += decode(chunk, true);
    if (raw.length > 12_000_000) throw new Error('Request is too large.');
  }
  raw += decode(undefined, false);
  try { return raw ? JSON.parse(raw) : {}; } catch { throw new Error('Request body must be JSON.'); }
}

// Interface files (pages, scripts, styles, design system, masthead media).
// They revalidate by ETag and honour a single byte range, which browsers
// (Safari in particular) require before they will play <video>.
/** Streams a static file with the server's content and cache headers. */
async function staticFile(request, response, file) {
  let info;
  try { info = await stat(file); } catch { return json(response, 404, { error: 'Not found.' }); }
  if (!info.isFile()) return json(response, 404, { error: 'Not found.' });
  const etag = `W/"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`;
  const headers = { 'content-type': mimeTypes[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache', etag, 'accept-ranges': 'bytes', 'x-content-type-options': 'nosniff' };
  if (request.headers['if-none-match'] === etag) { response.writeHead(304, headers); response.end(); return; }
  let start = 0; let end = info.size - 1; let status = 200;
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range || '');
  // An invalid range (last before first) is ignored and the whole file is sent.
  if (range && (range[1] || range[2]) && !(range[1] && range[2] && Number(range[2]) < Number(range[1]))) {
    if (range[1]) { start = Number(range[1]); end = range[2] ? Math.min(Number(range[2]), info.size - 1) : info.size - 1; }
    else { start = Math.max(0, info.size - Number(range[2])); }
    if (start >= info.size || start > end) { response.writeHead(416, { ...headers, 'content-range': `bytes */${info.size}` }); response.end(); return; }
    status = 206; headers['content-range'] = `bytes ${start}-${end}/${info.size}`;
  }
  response.writeHead(status, { ...headers, 'content-length': info.size ? end - start + 1 : 0 });
  if (request.method === 'HEAD' || !info.size) { response.end(); return; }
  // pipeline closes the file when a browser aborts a range request.
  pipeline(createReadStream(file, { start, end }), response, () => {});
}

/** Extracts the requested publishing page identifier from the URL. */
function pageId(url) {
  const match = url.pathname.match(/^\/api\/pages\/([a-z0-9-]+)(?:\/|$)/);
  return match?.[1] || null;
}

/** Streams an approved artifact with its corresponding media type. */
async function serveFile(response, file) {
  try {
    await access(file);
    response.writeHead(200, { 'content-type': mimeTypes[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    createReadStream(file).pipe(response);
  } catch {
    json(response, 404, { error: 'Not found.' });
  }
}

/** Resolves the selected engine store for a project context request. */
async function contextStoreFor(id, url) {
  const candidate = new ProjectStore(path.join(booksDirectory, id));
  try { await validateContextTree(candidate); }
  catch (error) { if (error.status) throw error; throw Object.assign(new Error('The selected publishing project is unavailable.'), { status: error.code === 'ENOENT' ? 404 : 503, code: error.code === 'ENOENT' ? 'NOT_FOUND' : 'UNAVAILABLE' }); }
  const selected = new URL(url); selected.searchParams.set('book', id);
  return storeFor(selected);
}
/** Selects the engine-owned store for the requested book or project. */
async function storeFor(url) {
  const bookId = url.searchParams.get('book');
  if (bookId) {
    if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(bookId)) throw new Error('Invalid book id.');
    const bookRoot = path.resolve(booksDirectory, bookId);
    if (!bookRoot.startsWith(`${booksDirectory}${path.sep}`)) throw new Error('Invalid book path.');
    try { await access(path.join(bookRoot, 'manuscript', 'Programme.md')); } catch { throw new Error('Book project not found.'); }
    // Map the vault once per server start so diagnostics reflect the current manuscript and parser.
    if (!projectStores.has(`book:${bookId}`)) {
      const created = new ProjectStore(bookRoot);
      projectStores.set(`book:${bookId}`, created.initialize().then(() => created.refreshGraph()).then(() => created).catch((error) => { projectStores.delete(`book:${bookId}`); throw error; }));
    }
    const store = await projectStores.get(`book:${bookId}`); await store.initialize(); return store;
  }
  const projectId = url.searchParams.get('project');
  if (!projectId) return defaultStore;
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(projectId)) throw new Error('Invalid project id.');
  const projectRoot = path.resolve(projectsDirectory, projectId);
  if (!projectRoot.startsWith(`${projectsDirectory}${path.sep}`)) throw new Error('Invalid project path.');
  try { await access(path.join(projectRoot, 'project.json')); } catch { throw new Error('Project not found.'); }
  if (!projectStores.has(projectId)) projectStores.set(projectId, new BookStore(path.join(projectRoot, 'texgraph')));
  const store = projectStores.get(projectId);
  await store.initialize();
  return store;
}

// The Frige root is a chooser, not an implicit mutation of any manuscript.
// A selected project remains explicit in the `book` query parameter.
/** Lists authorized local book workspaces with their labels. */
async function availableBooks() {
  const entries = await readdir(booksDirectory, { withFileTypes: true }).catch(() => []);
  const records = await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
    if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(entry.name)) return null;
    const root = path.join(booksDirectory, entry.name);
    try { await access(path.join(root, 'manuscript', 'Programme.md')); } catch { return null; }
    const readme = await readFile(path.join(root, 'README.md'), 'utf8').catch(() => '');
    const title = /^#\s+(.+)$/m.exec(readme)?.[1]?.trim() || entry.name.replaceAll('-', ' ');
    return { id: entry.name, title, reference: `stex://frige/project/${entry.name}`, locked: await projectAccess.isProtected('book', entry.name) };
  }));
  return records.filter(Boolean).sort((left, right) => left.title.localeCompare(right.title));
}

// Newest modification time in a book, from file metadata only (manuscripts are
// never opened). Hidden folders (.git, .texgraph, .obsidian) and node_modules
// are tooling, not author changes. Symlinks are not followed (Dirent uses
// lstat). At most 5,000 entries per book are visited; files in a folder are
// stat-ed together.
/** Finds the newest modification under a bounded directory traversal. */
async function newestChange(root, budget = { entries: 5000 }) {
  const entries = (await readdir(root, { withFileTypes: true }).catch(() => []))
    .filter((entry) => !entry.name.startsWith('.') && entry.name !== 'node_modules')
    .slice(0, Math.max(0, budget.entries));
  budget.entries -= entries.length;
  const files = await Promise.all(entries.filter((entry) => entry.isFile()).map((entry) => stat(path.join(root, entry.name)).then((info) => info.mtimeMs, () => 0)));
  let newest = Math.max(0, ...files);
  for (const entry of entries) if (entry.isDirectory() && budget.entries > 0) newest = Math.max(newest, await newestChange(path.join(root, entry.name), budget));
  return newest;
}

// stex.projects.summary.v1 (protocol/projects): read-only summaries for Pantheon.
/** Converts engine-owned projects to the read-only summary contract. */
async function projectSummaries() {
  const books = await availableBooks();
  const projects = await Promise.all(books.map(async (book) => {
    const changed = await newestChange(path.join(booksDirectory, book.id));
    return { reference: book.reference, id: book.id, title: book.title, kind: 'book', updatedAt: changed ? new Date(changed).toISOString() : null, status: { state: 'ready', label: book.locked ? 'Password protected' : 'Manuscript' }, openPath: `/?book=${encodeURIComponent(book.id)}` };
  }));
  return { schemaVersion: 'stex.projects.summary.v1', application: 'frige', projects };
}

/** Creates a publishing project scaffold after validating its inputs. */
async function createBookProject(payload) {
  const title = String(payload?.title || '').trim().replace(/\s+/g, ' ').slice(0, 140);
  const author = String(payload?.author || '').trim().replace(/\s+/g, ' ').slice(0, 160);
  if (!title) throw new Error('A book title is required.');
  const stem = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'book';
  const id = `${stem}-${createHash('sha256').update(`${title}:${Date.now()}:${Math.random()}`).digest('hex').slice(0, 6)}`;
  const root = path.resolve(booksDirectory, id);
  if (!root.startsWith(`${booksDirectory}${path.sep}`)) throw new Error('Invalid book path.');
  await Promise.all([
    mkdir(path.join(root, 'manuscript', '00_Front_Matter'), { recursive: true }),
    mkdir(path.join(root, 'notes'), { recursive: true }),
    mkdir(path.join(root, '.texgraph'), { recursive: true }),
  ]);
  const programme = ['---', `title: "${title.replaceAll('"', '\\"')}"`, '---', '', '# Programme', '', '- [[00_Front_Matter/Title Page|Title Page]]', '', '> [!todo] Add pieces to the reading order deliberately.', ''].join('\n');
  const titlePage = ['# ' + title, '', author, ''].filter(Boolean).join('\n');
  await Promise.all([
    writeFile(path.join(root, 'README.md'), `# ${title}\n\nA local Frige book project.\n`, { flag: 'wx' }),
    writeFile(path.join(root, 'manuscript', 'Programme.md'), programme, { flag: 'wx' }),
    writeFile(path.join(root, 'manuscript', '00_Front_Matter', 'Title Page.md'), titlePage, { flag: 'wx' }),
  ]);
  return { id, title, reference: `stex://frige/project/${id}` };
}

/** Extracts a syntactically valid publishing node identifier from the URL. */
function nodeId(url) { return url.pathname.match(/^\/api\/nodes\/([a-z0-9-]+)(?:\/|$)/)?.[1] || null; }

const attachmentExtensions = new Set(['.md', '.txt', '.tex', '.csv', '.json', '.pdf', '.docx']);
const readableAttachmentExtensions = new Set(['.md', '.txt', '.tex', '.csv', '.json']);
/** States in which an attachment has no text yet and may be converted again. */
const convertibleStates = new Set(['awaiting-extraction', 'conversion-unavailable', 'conversion-failed', 'no-text', 'unreadable']);
const attachmentError = (status, code, message) => Object.assign(new Error(message), { status, code });
/** Stored text stays below the excerpt reader's 600,000-byte limit. */
const MAX_EXTRACTION_BYTES = 590_000;

/** Bounds text to 200,000 characters and MAX_EXTRACTION_BYTES, ending on a whole character. */
function boundedText(text) {
  let bounded = text.slice(0, 200_000);
  while (Buffer.byteLength(bounded, 'utf8') > MAX_EXTRACTION_BYTES) bounded = bounded.slice(0, Math.floor(bounded.length * 0.9));
  return bounded.isWellFormed() ? bounded : bounded.slice(0, -1);
}

/**
 * Produces an upload's reviewable text without touching stored state:
 * `{ text, converter }`, or `{ state, error }` when there is none. With the
 * MarkItDown converter configured, every file goes through it. A converter
 * outage does not break plain-text files, which are then decoded as UTF-8.
 */
async function convertUpload(name, bytes) {
  const readable = readableAttachmentExtensions.has(path.extname(name).toLowerCase());
  const decode = () => {
    try { return { text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes), converter: 'utf8' }; }
    catch { return { state: 'unreadable' }; }
  };
  if (!converter) return readable ? decode() : { state: 'conversion-unavailable' };
  try { return { text: (await converter.convert({ name, bytes })).markdown, converter: 'markitdown-mcp' }; }
  catch (error) {
    const code = typeof error.code === 'string' ? error.code : 'CONVERSION_FAILED';
    if (code === 'CONVERTER_UNAVAILABLE' && readable) return decode();
    return { state: code === 'NO_TEXT' ? 'no-text' : 'conversion-failed', error: code };
  }
}

/** Records a conversion outcome, writing the extraction file when there is text. The author still reviews it. */
async function applyConversion(store, record, outcome) {
  for (const field of ['extraction', 'extractedAt', 'converter', 'conversionError', 'approvalHash']) delete record[field];
  if (outcome.text === undefined) {
    record.contextState = outcome.state;
    if (outcome.error) record.conversionError = outcome.error;
    return record;
  }
  const text = boundedText(outcome.text);
  if (!text.trim()) { record.contextState = 'no-text'; return record; }
  const extraction = `extractions/${record.id}.txt`;
  await mkdir(path.join(store.stateDirectory, 'extractions'), { recursive: true });
  await writeFile(path.join(store.stateDirectory, extraction), text, 'utf8');
  Object.assign(record, { extraction, converter: outcome.converter, contextState: 'pending-review', extractedAt: new Date().toISOString() });
  return record;
}

/**
 * Writes validated upload bytes and records them. With a converter, records
 * wait in `awaiting-extraction` and the client converts them one by one
 * (`/convert`), so no request holds the book's lock for several
 * conversions. Without one, text files are decoded here.
 */
async function saveAttachments(store, payload) {
  const uploads = Array.isArray(payload.attachments) ? payload.attachments : [];
  if (!uploads.length || uploads.length > 10) throw new Error('Attach between one and ten files.');
  const manifest = await readAttachmentManifest(store.root); const created = [];
  for (const upload of uploads) {
    const name = path.basename(String(upload?.name || '')); const extension = path.extname(name).toLowerCase();
    if (!name || name !== upload.name || !attachmentExtensions.has(extension)) throw new Error('Unsupported attachment type or filename.');
    if (typeof upload.contentBase64 !== 'string' || upload.contentBase64.length > 11_200_000) throw new Error('Attachment is missing or too large.');
    const bytes = Buffer.from(upload.contentBase64, 'base64'); if (!bytes.length || bytes.length > 8_000_000) throw new Error('Each attachment must be between 1 byte and 8 MB.');
    // A long name keeps its extension, which decides how the file is converted.
    const safeName = `${name.slice(0, name.length - extension.length).replace(/[^A-Za-z0-9._ -]/g, '_').slice(0, 160 - extension.length)}${extension}`;
    const { record, duplicateOf } = await storeAttachmentOriginal(store.root, manifest, safeName, bytes);
    if (!converter) await applyConversion(store, record, await convertUpload(safeName, bytes));
    manifest.push(record); created.push(duplicateOf ? { ...record, duplicateOf } : record);
  }
  await writeAtomic(path.join(store.stateDirectory, 'documents.json'), `${JSON.stringify(manifest, null, 2)}\n`); return created;
}

/**
 * Converts a stored attachment that has no text yet. The record is checked
 * under the book's attachment lock, including its original-byte receipt when
 * present. Conversion runs outside the lock and updates only the same
 * unconverted record, preserving converted and approved text.
 */
async function convertAttachment(store, id) {
  if (!converter) throw attachmentError(503, 'CONVERTER_UNAVAILABLE', 'The document converter is not configured.');
  const { record, bytes } = await mutateAttachments(store.root, async () => {
    const found = (await readAttachmentManifest(store.root)).find((entry) => entry.id === id);
    if (!found) throw attachmentError(404, 'NOT_FOUND', 'Attachment not found.');
    if (found.extraction || !convertibleStates.has(found.contextState)) throw attachmentError(409, 'ALREADY_CONVERTED', 'This attachment already has text to review.');
    const stored = path.basename(String(found.storedAs || ''));
    if (!stored || stored !== found.storedAs) throw attachmentError(404, 'NOT_FOUND', 'The stored attachment is unavailable.');
    const content = await readFile(path.join(store.root, 'sources', stored)).catch(() => { throw attachmentError(404, 'NOT_FOUND', 'The stored attachment is unavailable.'); });
    if (Object.hasOwn(found, 'sourceSha256') && createHash('sha256').update(content).digest('hex') !== found.sourceSha256) {
      throw attachmentError(409, 'ATTACHMENT_CHANGED', 'The stored attachment no longer matches its uploaded bytes.');
    }
    return { record: { ...found }, bytes: content };
  });
  const outcome = await convertUpload(record.name, bytes);
  return mutateAttachments(store.root, async () => {
    const manifest = await readAttachmentManifest(store.root);
    const current = manifest.find((entry) => entry.id === id);
    if (!current || current.extraction || current.storedAs !== record.storedAs || current.sourceSha256 !== record.sourceSha256 || !convertibleStates.has(current.contextState)) {
      throw attachmentError(409, 'ATTACHMENT_CHANGED', 'This attachment changed while it was converting.');
    }
    await applyConversion(store, current, outcome);
    await writeAtomic(path.join(store.stateDirectory, 'documents.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    return current;
  });
}

async function attachmentPreview(store, id) {
  const record = (await readAttachmentManifest(store.root)).find((entry) => entry.id === id);
  const preview = await store.attachmentExcerpt(record);
  if (!preview) throw Object.assign(new Error('This attachment has no readable excerpt.'), { status: 404, code: 'EXCERPT_UNAVAILABLE' });
  return preview;
}

/** Pins the reviewed excerpt. Earlier callers can still record a legacy approval. */
async function reviewAttachment(store, id, hash) {
  const manifest = await readAttachmentManifest(store.root);
  const record = manifest.find((entry) => entry.id === id);
  if (!record?.extraction || !['pending-review', 'approved', 'rejected'].includes(record.contextState)) throw new Error('This attachment is not ready for review.');
  if (hash !== undefined) {
    const preview = await store.attachmentExcerpt(record);
    if (!preview || preview.hash !== hash) throw Object.assign(new Error('The excerpt changed. Preview it again.'), { code: 'STALE_SOURCE' });
    record.approvalHash = preview.hash;
  } else if (record.contextState !== 'pending-review') throw new Error('Preview the excerpt before approving it again.');
  record.contextState = 'approved';
  record.reviewedAt = new Date().toISOString();
  await writeAtomic(path.join(store.stateDirectory, 'documents.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return record;
}

/**
 * Checks a selected passage against the piece as this turn offers it, before
 * anything is recorded. The browser's selection is not trusted: the piece must
 * be offered by this conversation, unchanged since the passage was selected,
 * and hold exactly the selected text at that place.
 *
 * @param {{ sources: Array<{ nodeId: string, relativePath: string, title: string, hash: string, source: string }> }} context  This turn's scope context.
 * @param {unknown} selection  Untrusted request field.
 * @returns {{ nodeId: string, relativePath: string, title: string, baseHash: string, action: string, start: number, end: number, startLine: number, endLine: number, text: string }}
 *   `start` and `end` are offsets into the canonical source; `text` is its exact bytes there.
 */
function resolveTurnPassage(context, selection) {
  /** Constructs the failure returned for rejected inputs at this boundary. */
  const invalid = (message) => Object.assign(new Error(message), { code: 'INVALID_PASSAGE' });
  if (!selection || typeof selection !== 'object' || Array.isArray(selection)) throw invalid('The selected passage is malformed.');
  if (!PASSAGE_ACTIONS.includes(selection.action)) throw invalid(`A passage action is one of: ${PASSAGE_ACTIONS.join(', ')}.`);
  const offered = context.sources.find((entry) => entry.nodeId === selection.nodeId && entry.kind !== 'programme');
  if (!offered) throw invalid('The selected passage is not in a piece this conversation offers to Igor.');
  if (selection.baseHash !== offered.hash) throw Object.assign(new Error('The piece changed after the passage was selected. Select the passage again.'), { code: 'PASSAGE_STALE' });
  const resolved = resolvePassage(offered.source, selection);
  if ('reason' in resolved) throw invalid(resolved.reason);
  return { nodeId: offered.nodeId, relativePath: offered.relativePath, title: offered.title, baseHash: offered.hash, action: selection.action, ...resolved };
}

// One conversation turn with a book, section or page. Hermes may propose changes;
// the store keeps only those for nodes whose text this turn offered.
/**
 * Resolves approval context and submits a scoped publishing turn.
 *
 * @param {ProjectStore} store
 * @param {string} scopeId
 * @param {Record<string, any>} payload  The request body.
 * @param {{ conversationId?: string, actor?: import('./src/actor.mjs').Actor }} [options]
 *   The conversation of the scope the turn belongs to (the first one by default) and who sent it.
 *   The model is offered only this conversation's recent turns, plus up to three saved summaries
 *   of other sessions of the scope as labelled context (`sessionSummaries`).
 */
async function scopeTurn(store, scopeId, payload, { conversationId = MAIN_CONVERSATION, actor = LOCAL_ACTOR } = {}) {
  // The scope's offered sources come first: a selected passage is checked against them before
  // anything is recorded, so a stale or invalid selection leaves the conversation untouched.
  const context = await store.scopeContext(scopeId);
  const passage = payload.selection === undefined || payload.selection === null ? null : resolveTurnPassage(context, payload.selection);
  // A turn is either a message or an answer to one of Hermes's choices or forms.
  // An answer is reserved, not recorded, until Hermes replies to it.
  let userTurn = null; let reservation = null;
  if (payload.answer && typeof payload.answer === 'object') {
    if (passage) throw Object.assign(new Error('An answer to Igor’s question cannot carry a selected passage.'), { code: 'INVALID_PASSAGE' });
    reservation = await store.reserveAnswer(scopeId, String(payload.answer.promptId || ''), payload.answer.values, conversationId);
    // A closed conversation refuses the answer; the reserved question stays open to answer again.
    try { await store.beginTurn(scopeId, conversationId, actor); } catch (error) { store.releaseAnswer(reservation); throw error; }
  } else {
    if (typeof payload.message !== 'string' || !payload.message.trim() || payload.message.length > 12_000) throw new Error('A concise message is required.');
    // Refuses a completed or abandoned session, resumes a paused or awaiting-review one (recorded), and only then
    // stores the message, all under one store lock so a concurrent close cannot land in between.
    // The passage is kept with the author's message, so the thread and the contract's
    // `origin.userTurnId` show exactly which text, at which revision, the turn was about.
    ({ turn: userTurn } = await store.beginTurn(scopeId, conversationId, actor, { role: 'user', message: payload.message.trim(), ...(passage ? { passage } : {}) }));
  }
  try {
    const [priorTurns, approvedSourceExcerpts, settings, sessionSummaries] = await Promise.all([store.turns(scopeId, 12, conversationId), store.approvedSourceExcerpts(), store.settingsTicket(), store.sessionSummariesFor(scopeId, conversationId)]);
    // Context from the levels around the scope (outline, settings in force, approved contracts), labelled by category.
    const hierarchy = await store.hierarchy(context.scope, context.graph);
    const graph = { readingOrder: context.graph.readingOrder, sections: context.graph.book.sections.map(({ id, kind, title, nodeIds }) => ({ id, kind, title, nodeIds })), nodes: context.graph.nodes.map(({ id, title, kind, relativePath }) => ({ id, title, kind, relativePath })), diagnostics: context.graph.diagnostics.slice(0, 40) };
    const result = await requestScopeTurn({ book: { id: path.basename(store.root), title: context.graph.book.title, settings }, scope: context.scope, sources: context.sources, withheld: context.withheld, graph, hierarchy, approvedSourceExcerpts, turns: reservation ? priorTurns : priorTurns.slice(0, -1), message: (reservation || userTurn).message, answer: reservation ? { promptId: reservation.partId, values: reservation.values } : null, passage, sessionSummaries });
    if (reservation) {
      // Hermes did not receive the answer: leave the question open and say why.
      if (result.availability !== 'available') throw Object.assign(new Error(result.commentary.replace(/\s*Your message was saved.*$/s, '')), { code: 'HERMES_UNAVAILABLE' });
      userTurn = await store.commitAnswer(reservation);
    }
    // What the contract records about this turn: who asked, which model answered, and
    // what it was shown beyond the offered sources. Categories stay separate in the record.
    const provenance = {
      request: (reservation || userTurn).message, userTurnId: userTurn?.id || null, conversationId,
      // Saved summaries of other sessions offered with this turn: what Frige sent (the gateway does not report them yet).
      sessionSummaries: sessionSummaries.map(({ conversationId: id, summaryRevision }) => ({ conversationId: id, summaryRevision })),
      model: result.meta?.model || null, transport: result.meta?.usage?.transport || null,
      withheld: context.withheld, references: approvedSourceExcerpts
        .filter(({ id, hash }) => result.meta?.forwardedContext?.approvedSourceExcerpts?.some((entry) => entry.id === id && entry.hash === hash))
        .map(({ id, name }) => ({ id, name })),
      designHash: designHash(await store.design()),
      // What the director was given: the gateway's report after trimming when it sends one, else what Frige sent, marked unconfirmed.
      hierarchy: result.meta?.forwardedContext
        ? { outline: result.meta.forwardedContext.outline?.count ?? 0, outlineTruncated: result.meta.forwardedContext.outline?.truncated === true, settingsHash: result.meta.forwardedContext.documentSettings ? hierarchy.settings.designHash : null, contracts: result.meta.forwardedContext.approvedContracts ?? [], confirmed: true }
        : { outline: hierarchy.outline.entries.length, outlineTruncated: hierarchy.outline.truncated, settingsHash: hierarchy.settings.designHash, contracts: hierarchy.contracts.entries.map((entry) => entry.contractId), confirmed: false },
    };
    // A reply (the director's or the simulator's) proposes text changes, or one layout change.
    const proposes = result.changes.length || result.layout;
    // Any action on a passage except a plain question may change only that passage.
    const bounds = passage && passage.action !== 'ask' ? { nodeId: passage.nodeId, start: passage.start, end: passage.end } : null;
    const { changeSet, dropped } = proposes ? await store.createChangeSet(scopeId, { commentary: result.commentary, changes: result.changes, layout: result.layout, bounds }, context.sources, provenance) : { changeSet: null, dropped: [] };
    const stored = await store.storeParts(scopeId, result.parts, result.meta);
    const assistantTurn = await store.appendTurn(scopeId, { role: 'assistant', commentary: result.commentary, availability: result.availability, parts: stored.parts, droppedParts: [...result.droppedParts, ...stored.dropped], meta: result.meta, failure: result.failure || null, graphSuggestions: result.graphSuggestions || [], changeSetId: changeSet?.id || null, droppedChanges: dropped, ...(sessionSummaries.length ? { offered: { sessionSummaries: provenance.sessionSummaries.map((entry) => ({ ...entry, category: 'session-summary' })) } } : {}) }, conversationId);
    return { userTurn, assistantTurn, changeSet, availability: result.availability };
  } finally { if (reservation) store.releaseAnswer(reservation); }
}

// Artifact content is served as inert data: images by their checked type, text as
// plain text, never as HTML or script, with a sandboxing policy and no sniffing.
/** Serves artifact metadata or content according to the request. */
async function artifactResponse(response, store, id, content, download) {
  if (!content) { const record = await store.artifact(id); return record ? json(response, 200, record) : json(response, 404, { error: 'Artifact not found.' }); }
  const found = await store.artifactContent(id);
  if (!found) return json(response, 404, { error: 'Artifact not found.' });
  const { record } = found;
  const type = record.kind === 'image' ? record.mediaType : 'text/plain; charset=utf-8';
  const textExtensions = new Set(['txt', 'md', 'json', 'csv', 'tsv', 'tex', 'yaml', 'yml', 'toml', 'css', 'sql', 'log']);
  const declared = String(record.language || '').toLowerCase();
  const extension = record.kind === 'image' ? record.mediaType.split('/')[1].replace('jpeg', 'jpg') : record.kind === 'document' ? 'md' : textExtensions.has(declared) ? declared : 'txt';
  const base = record.title.replace(/[^A-Za-z0-9 ._-]/g, '').trim().slice(0, 80) || record.id; const suffix = String(extension).replace(/[^a-z0-9]/gi, '').slice(0, 10) || 'txt';
  // A title that already ends with its extension keeps a single one.
  const name = base.toLowerCase().endsWith(`.${suffix.toLowerCase()}`) ? base : `${base}.${suffix}`;
  response.writeHead(200, { 'content-type': type, 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; sandbox", 'cache-control': 'private, max-age=31536000, immutable', ...(download ? { 'content-disposition': `attachment; filename="${name}"` } : {}) });
  response.end(found.content);
}

/** Handles graph, source and proof routes for the selected manuscript store. */
async function vaultApi(request, response, url, store) {
  const id = nodeId(url);
  const attachment = url.pathname.match(/^\/api\/project\/attachments\/([a-f0-9]{16})\/(approve|excerpt|convert)$/);
  if (request.method === 'GET' && url.pathname === '/api/project/attachments') return json(response, 200, await readAttachmentManifest(store.root));
  if (request.method === 'POST' && url.pathname === '/api/project/attachments') {
    const payload = await body(request);
    return json(response, 201, await mutateAttachments(store.root, () => saveAttachments(store, payload)));
  }
  if (request.method === 'GET' && attachment?.[2] === 'excerpt') return json(response, 200, await attachmentPreview(store, attachment[1]));
  if (request.method === 'POST' && attachment?.[2] === 'convert') return json(response, 200, await convertAttachment(store, attachment[1]));
  if (request.method === 'POST' && attachment?.[2] === 'approve') {
    const payload = await body(request);
    return json(response, 200, await mutateAttachments(store.root, () => reviewAttachment(store, attachment[1], payload?.hash)));
  }
  if (request.method === 'GET' && url.pathname === '/api/project/graph') return json(response, 200, await store.graph());
  if (request.method === 'POST' && url.pathname === '/api/project/refresh') return json(response, 200, await store.refreshGraph());
  if (request.method === 'GET' && url.pathname === '/api/project/preview') return serveFile(response, store.previewPath());
  if (request.method === 'GET' && url.pathname === '/api/project/build') return json(response, 200, await store.buildStatus());
  if (request.method === 'GET' && url.pathname === '/api/project/preflight') {
    const report = await store.exclusive(async () => {
      const pdfPath = store.previewPath();
      const manifest = await readFile(path.join(store.buildDirectory(), 'page-map.json'), 'utf8').then(JSON.parse).catch(() => null);
      const pdfData = await readFile(pdfPath).catch(() => new Uint8Array());
      const [graph, design] = await Promise.all([store.graph(), store.design()]);
      return runPreflight({ manifest, pdfPath, pdfData, graph, currentDesign: design, currentHeadTitle: await resolveHeadTitle(store, graph, design) });
    });
    return json(response, 200, report);
  }
  if (request.method === 'GET' && url.pathname === '/api/project/design') { const design = await store.design(); return json(response, 200, { design, hash: designHash(design), defaultHash: designHash({}), trimSizes: [...TRIM_SIZES.keys()] }); }
  if (request.method === 'PUT' && url.pathname === '/api/project/design') { const design = await store.saveDesign(await body(request)); return json(response, 200, { design, hash: designHash(design) }); }
  if (request.method === 'GET' && url.pathname === '/api/inference/health') return json(response, 200, await inferenceHealth());
  if (request.method === 'GET' && url.pathname === '/api/project/artifacts') return json(response, 200, await store.artifacts());
  const artifactRoute = url.pathname.match(/^\/api\/artifacts\/(art-[a-f0-9]{16})(\/content)?$/);
  if (request.method === 'GET' && artifactRoute) return artifactResponse(response, store, artifactRoute[1], Boolean(artifactRoute[2]), url.searchParams.get('download') === '1');
  if (request.method === 'GET' && url.pathname === '/api/project/reference-map') return json(response, 200, await store.referenceMap());
  if (request.method === 'GET' && url.pathname === '/api/project/live-build') return json(response, 200, await store.liveBuildStatus());
  if (request.method === 'GET' && url.pathname === '/api/project/page-map') {
    try { return json(response, 200, JSON.parse(await readFile(path.join(store.buildDirectory(), 'page-map.json'), 'utf8'))); } catch { return json(response, 200, null); }
  }
  if (request.method === 'POST' && url.pathname === '/api/project/build') {
    const payload = await body(request);
    const result = await buildBook(store, { scopeId: payload.scopeId || 'book', mode: payload.mode === 'isolated' ? 'isolated' : 'prefix' }); return json(response, result.ok ? 200 : 422, await store.recordBuild(result));
  }
  if (request.method === 'POST' && url.pathname === '/api/project/live-build') {
    const payload = await body(request);
    return json(response, 201, await store.queueLiveBuild(payload.scopeId || 'book'));
  }
  // Change contracts: the history of proposals for this book, one contract in
  // full, and the rollback of a contract's accepted changes.
  if (request.method === 'GET' && url.pathname === '/api/project/contracts') return json(response, 200, await store.contracts({ scopeId: url.searchParams.get('scope'), nodeId: url.searchParams.get('node') }));
  const contractRoute = url.pathname.match(/^\/api\/contracts\/([0-9a-f-]{36})(\/revert)?$/);
  if (contractRoute && request.method === 'GET' && !contractRoute[2]) {
    const record = await store.contract(contractRoute[1]);
    return record ? json(response, 200, record) : json(response, 404, { error: 'Change contract not found.', code: 'CONTRACT_NOT_FOUND' });
  }
  if (contractRoute && request.method === 'POST' && contractRoute[2]) { const payload = await body(request); return json(response, 200, await store.revertChanges(contractRoute[1], { nodeId: payload?.nodeId || null })); }
  // Editorial sessions: a scope's named conversations (D-027), under the same scope ids as the routes below.
  // The pattern admits only `main` (the scope's original journal) or a generated `c-` id of 16 hex digits,
  // so a conversation id can never name a path outside the scope's session folder. The actor has already
  // been checked for state-changing methods at the top of the handler (D-028); project passwords apply
  // here as on every scope route. Closing a conversation never decides a proposal.
  const session =url.pathname.match(/^\/api\/scopes\/(book|[a-z][a-z0-9-]{5,80})\/conversations(?:\/(main|c-[a-f0-9]{16})(?:\/(turns|turn|summary|summary\/draft|continue))?)?$/);
  if (session) {
    const [, scopeId, conversationId, action] = session;
    const actor = request.actor ?? LOCAL_ACTOR;
    if (!conversationId) {
      if (request.method === 'GET') return json(response, 200, await store.conversations(scopeId));
      if (request.method === 'POST') return json(response, 201, await store.createConversation(scopeId, await body(request), actor));
    } else if (!action) {
      if (request.method === 'GET') return json(response, 200, await store.conversation(scopeId, conversationId));
      if (request.method === 'PATCH') return json(response, 200, await store.updateConversation(scopeId, conversationId, await body(request), actor));
    } else if (action === 'turns' && request.method === 'GET') {
      await store.conversation(scopeId, conversationId);
      return json(response, 200, await store.turns(scopeId, 40, conversationId));
    } else if (action === 'turn' && request.method === 'POST') {
      await store.conversation(scopeId, conversationId);
      return json(response, 200, await scopeTurn(store, scopeId, await body(request), { conversationId, actor }));
    } else if (action === 'summary') {
      if (request.method === 'GET') return json(response, 200, await store.summary(scopeId, conversationId));
      if (request.method === 'PUT') return json(response, 200, await store.saveSummary(scopeId, conversationId, await body(request), actor));
    } else if (action === 'summary/draft' && request.method === 'GET') return json(response, 200, await store.summaryDraft(scopeId, conversationId));
    else if (action === 'continue' && request.method === 'POST') {
      // 201 for a new conversation; 200 when the same summary revision was already continued (a replay).
      const continued = await store.continueConversation(scopeId, conversationId, await body(request), actor);
      return json(response, continued.replayed ? 200 : 201, continued);
    }
    return json(response, 405, { error: 'Method not allowed.' });
  }
  const scoped = url.pathname.match(/^\/api\/scopes\/(book|[a-z][a-z0-9-]{5,80})\/(turns|turn|changes|changes\/decide)$/);
  if (scoped) {
    const [, scopeId, action] = scoped;
    if (request.method === 'GET' && action === 'turns') return json(response, 200, await store.turns(scopeId));
    if (request.method === 'GET' && action === 'changes') return json(response, 200, await store.changeSet(scopeId));
    if (request.method === 'POST' && action === 'changes/decide') { const payload = await body(request); return json(response, 200, await store.decideChanges(scopeId, payload.changeSetId, { nodeId: payload.nodeId || null, decision: payload.decision })); }
    if (request.method === 'POST' && action === 'turn') return json(response, 200, await scopeTurn(store, scopeId, await body(request), { actor: request.actor ?? LOCAL_ACTOR }));
  }
  const editorial = response.getHeader('x-stex-contract') && editorialRoute.exec(url.pathname.slice('/api'.length));
  if (editorial) {
    const [, node, resource, revision, restore] = editorial;
    const before = url.searchParams.get('before');
    if (resource === 'decisions') {
      if (request.method === 'POST') return json(response, 201, await store.recordEditorialDecision(node, await body(request)));
      return json(response, 200, await store.listEditorialDecisions(node, before));
    }
    if (restore) return json(response, 200, await store.restoreRevision(node, revision, await body(request)));
    if (revision) return json(response, 200, await store.readRevision(node, revision));
    return json(response, 200, await store.listRevisions(node, before));
  }
  if (!id) return false;
  if (request.method === 'GET' && url.pathname === `/api/nodes/${id}`) return json(response, 200, await store.node(id));
  if (request.method === 'PUT' && url.pathname === `/api/nodes/${id}`) { const payload = await body(request); return json(response, 200, await store.updateNode(id, payload.source, payload.baseHash)); }
  return false;
}

/** Dispatches legacy page publishing operations for the selected store. */
async function api(request, response, url, store) {
  if (store instanceof ProjectStore) return vaultApi(request, response, url, store);
  const id = pageId(url);
  if (request.method === 'GET' && url.pathname === '/api/health') return json(response, 200, { ok: true, projectDirectory });
  if (request.method === 'GET' && url.pathname === '/api/book') return json(response, 200, await store.book());
  if (request.method === 'POST' && url.pathname === '/api/pages') {
    const payload = await body(request);
    return json(response, 201, await store.createPage(payload.title));
  }
  if (!id) return false;
  if (request.method === 'GET' && url.pathname.endsWith('/preview')) return serveFile(response, store.previewPath(id));
  if (request.method === 'GET' && url.pathname.endsWith('/turns')) return json(response, 200, await store.turns(id));
  if (request.method === 'GET' && url.pathname.endsWith('/proposal')) return json(response, 200, await store.proposal(id));
  if (request.method === 'GET' && url.pathname.endsWith('/build')) return json(response, 200, await store.buildStatus(id));
  if (request.method === 'GET' && url.pathname === `/api/pages/${id}`) return json(response, 200, await store.page(id));
  if (request.method === 'PUT' && url.pathname === `/api/pages/${id}`) {
    const payload = await body(request);
    return json(response, 200, await store.updatePage(id, payload.source, payload.baseHash));
  }
  if (request.method === 'POST' && url.pathname.endsWith('/turn')) {
    const payload = await body(request);
    if (typeof payload.message !== 'string' || !payload.message.trim() || payload.message.length > 12_000) throw new Error('A concise message is required.');
    const userTurn = await store.appendTurn(id, { role: 'user', message: payload.message.trim() });
    const [book, page, priorTurns] = await Promise.all([store.book(), store.page(id), store.turns(id)]);
    const result = await requestPageRevision({ book, page, turns: priorTurns, message: userTurn.message });
    const assistantTurn = await store.appendTurn(id, { role: 'assistant', commentary: result.commentary, availability: result.availability });
    const proposal = result.proposal ? await store.createProposal(id, result.proposal) : null;
    return json(response, 200, { userTurn, assistantTurn, proposal, availability: result.availability });
  }
  if (request.method === 'POST' && url.pathname.endsWith('/proposal/accept')) {
    const payload = await body(request);
    return json(response, 200, await store.acceptProposal(id, payload.proposalId));
  }
  if (request.method === 'POST' && url.pathname.endsWith('/proposal/reject')) {
    const payload = await body(request);
    return json(response, 200, await store.rejectProposal(id, payload.proposalId));
  }
  if (request.method === 'POST' && url.pathname.endsWith('/build')) {
    const [page, book] = await Promise.all([store.page(id), store.book()]);
    const result = await buildPage(store, page, book);
    return json(response, result.ok ? 200 : 422, await store.recordBuild(id, result, page.hash));
  }
  return false;
}

/**
 * HTTP status for an error the engine classified by `code`. Anything
 * unclassified is a 400. A conflict (409) means the request was well formed
 * but the manuscript or conversation has moved on since the caller last read it.
 *
 * @type {Record<string, number>}
 */
const STATUS_BY_CODE = {
  STALE_SOURCE: 409, STALE_DESIGN: 409, STALE_PROPOSAL: 409, ALREADY_ANSWERED: 409, NOTHING_TO_REVERT: 409, PASSAGE_STALE: 409,
  INVALID_PASSAGE: 400,
  CONTRACT_NOT_FOUND: 404, HERMES_UNAVAILABLE: 503,
  // Editorial sessions (D-027) and the platform actor (D-028).
  SESSION_CLOSED: 409, INVALID_TRANSITION: 409, STALE_SUMMARY: 409, SUMMARY_REQUIRED: 409, SESSION_HISTORY_FULL: 409,
  CONVERSATION_NOT_FOUND: 404, SESSIONS_UNAVAILABLE: 503, INVALID_SESSION_REQUEST: 400, INVALID_SUMMARY: 400, ACTOR_REQUIRED: 401,
};

const legacyBooks = legacyBooksApi(booksDirectory, { isProtected: (id) => projectAccess.isProtected('book', id) });
await defaultStore.initialize();
http.createServer(async (request, response) => {
  try {
    if (!acceptedHost(request.headers.host)) return json(response, 403, { error: 'Frige answers only on its local address.' });
    const url = new URL(request.url, `http://${request.headers.host}`);
    const origin = request.headers.origin;
    if (request.headers['sec-fetch-site'] === 'cross-site' || (origin && origin !== `http://${request.headers.host}` && origin !== platformOrigin.origin)) return json(response, 403, { error: 'Foreign browser origin refused.' });
    if (mountedAt && url.pathname === mountedAt) {
      response.writeHead(308, { location: `${mountedAt}/${url.search}` }); response.end(); return;
    }
    if (mountedAt) {
      if (!url.pathname.startsWith(`${mountedAt}/`)) { json(response, 404, { error: 'Not found.' }); return; }
      url.pathname = url.pathname.slice(mountedAt.length) || '/';
    }
    // The platform actor (D-028, stex.platform.actor.v1). Local mode (no secret) ignores actor headers and acts as `local`.
    // With the secret set, every state-changing request needs a verified actor, with no exceptions. Pantheon's knowledge API
    // forwards the signed-in actor on its server-to-server observation POST (D-028), so that checkpoint is covered too.
    const actor = resolveActor(request.headers);
    request.actor = actor;
    if (actorRefused(request.method, actor)) return json(response, 401, { error: 'A signed-in person is required to change this.', code: 'ACTOR_REQUIRED' });
    if (url.pathname.startsWith('/api/stex/context/v1/')) {
      // Server-to-server readers carry no unlock cookie, so a protected project is unavailable to them.
      const contextId = /^\/api\/stex\/context\/v1\/projects\/([a-z0-9][a-z0-9-]{0,62})(?:\/|$)/.exec(url.pathname)?.[1];
      if (contextId) await projectAccess.assertUnlocked('book', contextId, request.headers);
      const observation = /^\/api\/stex\/context\/v1\/projects\/([a-z0-9][a-z0-9-]{0,62})\/observation$/.exec(url.pathname);
      if (observation && request.method === 'POST') return json(response, 200, await knowledgeEvent(await contextStoreFor(observation[1], url), observation[1], await body(request)));
      const match = /^\/api\/stex\/context\/v1\/projects\/([a-z0-9][a-z0-9-]{0,62})(?:\/sources\/([a-z][a-z0-9-]{5,80}))?$/.exec(url.pathname);
      if (!match) return json(response, 404, { code: 'NOT_FOUND', error: 'Unknown project context route.' });
      if (request.method !== 'GET') { response.setHeader('allow', 'GET'); return json(response, 405, { error: 'Method not allowed.' }); }
      return json(response, 200, await projectContext(await contextStoreFor(match[1], url), match[1], { sourceId: match[2], revision: url.searchParams.get('revision'), offset: url.searchParams.get('offset') || '0' }));
    }
    // Unlock and lock a password-protected project for this browser.
    const accessRoute = /^\/api\/stex\/access\/v1\/(unlock|lock)$/.exec(url.pathname)?.[1];
    if (accessRoute) {
      if (request.method !== 'POST') { response.setHeader('allow', 'POST'); return json(response, 405, { error: 'Method not allowed.' }); }
      if (!/^application\/json\s*(;|$)/i.test(String(request.headers['content-type'] || ''))) return json(response, 415, { error: 'Requests must be JSON.', code: 'INVALID_REQUEST' });
      const payload = await body(request);
      const kind = payload.kind === 'project' ? 'project' : 'book';
      const cookie = accessRoute === 'unlock'
        ? await projectAccess.unlock({ kind, id: payload.id, password: payload.password, cookiePath: unlockCookiePath, secure: request.headers['x-forwarded-proto'] === 'https' })
        : projectAccess.lockCookie(kind, payload.id, unlockCookiePath);
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'set-cookie': cookie });
      response.end(JSON.stringify({ ok: true, unlocked: accessRoute === 'unlock' })); return;
    }
    if (url.pathname === '/api/stex/publishing/v1' || url.pathname.startsWith('/api/stex/publishing/v1/')) {
      const suffix = url.pathname.slice('/api/stex/publishing/v1'.length);
      const methods = publishingRoute(suffix);
      if (!methods) return json(response, 404, { error: 'Unknown publishing v1 route.' });
      if (!methods.includes(request.method)) { response.setHeader('allow', methods.join(', ')); return json(response, 405, { error: 'Method not allowed.' }); }
      response.setHeader('x-stex-contract', 'stex.frige.publishing.v1');
      url.pathname = `/api${suffix}`;
    }
    if (/^\/api\/stex\/legacy-books\/v1(?:\/|$)/.test(url.pathname)) {
      const legacyId = /^\/api\/stex\/legacy-books\/v1\/([a-z0-9][a-z0-9-]{0,62})\//.exec(url.pathname)?.[1];
      if (legacyId) await projectAccess.assertUnlocked('book', legacyId, request.headers);
      return await legacyBooks(request, response, url);
    }
    // Suite settings belong to the gateway, not to a book.
    const relay = { 'GET /api/settings/models': ['GET', '/v1/settings/models'], 'PUT /api/settings/models': ['PUT', '/v1/settings/models'], 'GET /api/settings/model-catalog': ['GET', '/v1/models/catalog'] }[`${request.method} ${url.pathname}`];
    if (relay) { const result = await gatewaySettings(relay[0], relay[1], relay[0] === 'PUT' ? await body(request) : undefined); return json(response, result.status, result.body); }
    if (request.method === 'GET' && url.pathname === '/api/books') return json(response, 200, await availableBooks());
    if (request.method === 'GET' && url.pathname === '/api/stex/projects') return json(response, 200, await projectSummaries());
    if (request.method === 'POST' && url.pathname === '/api/books') return json(response, 201, await createBookProject(await body(request)));
    if (url.pathname.startsWith('/api/')) {
      // A selected book or project opens only once this browser has unlocked it (when it has a password).
      const selectedBook = url.searchParams.get('book'); const selectedProject = url.searchParams.get('project');
      if (selectedBook) await projectAccess.assertUnlocked('book', selectedBook, request.headers);
      else if (selectedProject) await projectAccess.assertUnlocked('project', selectedProject, request.headers);
      const activeStore = await storeFor(url);
      const handled = await api(request, response, url, activeStore);
      if (handled === false) json(response, 404, { error: 'Unknown API route.' });
      return;
    }
    if (url.pathname === '/runtime-config.js') {
      response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
      response.end(`globalThis.STEX_SHELL_URL=${JSON.stringify(shellUrl)};`); return;
    }
    if (url.pathname.startsWith('/design-system/')) {
      const file = designSystemFile(url.pathname);
      return file ? staticFile(request, response, file) : json(response, 404, { error: 'Not found.' });
    }
    const vendored = url.pathname.match(/^\/vendor\/pdfjs\/([a-z.]+)$/)?.[1];
    if (vendored) { const file = pdfjsFiles.has(vendored) && pdfjsFile(vendored); return file ? serveFile(response, file) : json(response, 404, { error: 'Not found.' }); }
    if (url.pathname === '/' || url.pathname === '/index.html' || url.pathname === '/lobby.html') {
      // Through Pantheon's proxy the browser is already on Pantheon's origin (which
      // may be a public one), so the redirect stays relative; direct visits go to Pantheon.
      const target = new URL('/frige/', platformOrigin); target.search = url.search;
      response.writeHead(308, { location: request.headers['x-forwarded-prefix'] === '/frige' ? `/frige/${url.search}` : target.href }); response.end(); return;
    }
    const requested = url.pathname;
    const file = path.resolve(publicDirectory, `.${requested}`);
    if (!file.startsWith(`${publicDirectory}${path.sep}`)) return json(response, 403, { error: 'Invalid path.' });
    await staticFile(request, response, file);
  } catch (error) {
    json(response, error.status || STATUS_BY_CODE[error.code] || 400, { error: error.message || 'Unexpected server error.', ...(error.code ? { code: error.code } : {}) });
  }
}).listen(port, listenAddress, () => {
  console.log(`Frige Studio is ready at http://127.0.0.1:${port}${mountedAt || '/'}`);
  console.log(`Book project: ${projectDirectory}`);
});
