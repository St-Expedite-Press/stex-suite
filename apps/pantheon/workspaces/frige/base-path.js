/** Pantheon publishing workspace source that resolves publishing API and asset URLs within the current mount. */
// Presentation stays at Pantheon's stable /frige/ mount. API requests use the
// additive publishing boundary; static PDF.js resources keep their own paths.
/** Derives the path prefix from the current publishing mount. */
export function appBase(url = globalThis.document?.baseURI || 'http://stex.invalid/') {
  const pathname = new URL('.', url).pathname;
  return pathname === '/' ? '' : pathname.replace(/\/$/, '');
}

/** Builds a scoped API or resource URL for that prefix. */
export function appUrl(pathname, url) {
  if (typeof pathname !== 'string' || !pathname.startsWith('/')) throw new Error('Application paths must start with /.');
  const route = pathname.startsWith('/api/') ? '/api/stex/publishing/v1' + pathname.slice(4) : pathname;
  return `${appBase(url)}${route}`;
}
