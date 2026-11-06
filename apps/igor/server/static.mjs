// Igor's built interface (Vite dist) and the shared design system's public
// folders, so the application also works without Pantheon in front of it.
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pipeline } from 'node:stream';

const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp',
  '.avif': 'image/avif', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};
const designSystemDirectory = path.dirname(createRequire(import.meta.url).resolve('@stex/design-system/package.json'));
const designSystemFolders = new Set(['src', 'fonts', 'brand', 'icons']);

async function fileInfo(file) { try { const info = await stat(file); return info.isFile() ? info : null; } catch { return null; } }
async function isDirectory(directory) { try { return (await stat(directory)).isDirectory(); } catch { return false; } }

function sendText(response, status, text) {
  response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  response.end(text);
}

// Pages may load images only from Igor itself, so Markdown in a reply cannot
// make the browser contact another host.
const pagePolicy = "img-src 'self' data:; object-src 'none'; base-uri 'self'";

async function sendFile(request, response, file, info, cacheControl = 'no-cache') {
  const page = path.extname(file).toLowerCase() === '.html';
  response.writeHead(200, { 'content-type': mime[path.extname(file).toLowerCase()] || 'application/octet-stream', 'content-length': info.size, 'cache-control': cacheControl, 'x-content-type-options': 'nosniff', ...(page ? { 'content-security-policy': pagePolicy } : {}) });
  if (request.method === 'HEAD' || !info.size) { response.end(); return; }
  pipeline(createReadStream(file), response, () => {});
}

// Decoded path segments under a root; null for anything that could escape it.
function safeFile(root, relative) {
  let decoded;
  try { decoded = decodeURIComponent(relative); } catch { return null; }
  if (/[\\\0]/.test(decoded) || decoded.split('/').some((part) => part === '.' || part === '..')) return null;
  const file = path.resolve(root, decoded);
  return file.startsWith(`${root}${path.sep}`) ? { file, decoded } : null;
}

/** Serves /igor/<file>; any other path (a deep link such as /igor/c/<id>) gets index.html. */
export async function serveInterface(request, response, pathname, distDirectory) {
  if (!(await isDirectory(distDirectory))) return sendText(response, 503, "Igor's interface is not built: run corepack pnpm build:igor");
  const target = safeFile(distDirectory, pathname.slice('/igor/'.length) || 'index.html');
  if (!target) return sendText(response, 404, 'Not found.');
  const info = await fileInfo(target.file);
  if (info) return sendFile(request, response, target.file, info, target.decoded.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
  // A missing asset is a 404, not the application page.
  if (path.extname(target.decoded)) return sendText(response, 404, 'Not found.');
  const index = path.join(distDirectory, 'index.html');
  const indexInfo = await fileInfo(index);
  if (!indexInfo) return sendText(response, 503, "Igor's interface is not built: run corepack pnpm build:igor");
  return sendFile(request, response, index, indexInfo);
}

/** Serves /design-system/<folder>/<file> from the package's public folders only. */
export async function serveDesignSystem(request, response, pathname) {
  const target = safeFile(designSystemDirectory, pathname.slice('/design-system/'.length));
  const folder = target && path.relative(designSystemDirectory, target.file).split(path.sep)[0];
  const info = target && designSystemFolders.has(folder) ? await fileInfo(target.file) : null;
  if (!info) return sendText(response, 404, 'Not found.');
  return sendFile(request, response, target.file, info);
}
