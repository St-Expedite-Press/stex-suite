/** Validates the preview destination before a proxy request. */
/** Seaxneat website engine source that constrains preview destinations and mounted paths. */
export function previewTarget(value) {
  if (typeof value !== 'string') throw new Error('Preview is not started.');
  let target;
  try { target = new URL(value); } catch { throw new Error('Stored preview target is invalid.'); }
  if (target.protocol !== 'http:' || target.hostname !== '127.0.0.1' || !target.port || target.username || target.password) throw new Error('Stored preview target is not an allowed loopback HTTP address.');
  return target;
}

/** Resolves a mounted preview path without allowing traversal. */
export function previewPath(value) {
  const supplied = String(value || '');
  if (supplied.includes('\\')) throw new Error('Invalid preview path.');
  const segments = supplied.split('/').filter(Boolean);
  if (segments.some((segment) => { try { const decoded = decodeURIComponent(segment); return decoded === '.' || decoded === '..' || decoded.includes('\\'); } catch { return true; } })) throw new Error('Invalid preview path.');
  return `/${segments.map(encodeURIComponent).join('/')}`;
}

/**
 * Content-Security-Policy attached to every proxied preview response.
 *
 * WHY each directive: generated code is untrusted, so the document runs in an
 * opaque-origin sandbox (no `allow-same-origin`, no forms, popups or top
 * navigation) and may only load resources from the preview's own mount.
 * `script-src 'unsafe-inline'` is required because the Next.js app router
 * bootstraps with inline `self.__next_f.push(...)` scripts; there is no nonce
 * channel through this proxy. `connect-src 'self'` keeps Next's runtime
 * working while refusing fetch/XHR/WebSocket/EventSource to any other host.
 *
 * What remains possible (documented in protocol/seaxneat/README.md): script
 * and style inline, same-mount subresources and `data:`/`blob:` images, and
 * requests to the preview's own origin (the engine still refuses opaque-origin
 * non-preview routes). Navigation of the frame itself (`<a href>`, location)
 * is not governed by CSP; the sandbox blocks top navigation only.
 */
export const PREVIEW_CONTENT_SECURITY_POLICY = [
  'sandbox allow-scripts',
  "frame-ancestors 'self'",
  "default-src 'self'",
  "connect-src 'self'",
  "img-src 'self' data: blob:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "form-action 'none'",
  "base-uri 'none'",
  "object-src 'none'",
].join('; ');
