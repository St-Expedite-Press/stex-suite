// URLs are relative to the application mount, so Frige can run at /frige/
// behind the STEX shell and TexGraph can still run directly at /.
export function appBase(url = globalThis.document?.baseURI || 'http://stex.invalid/') {
  const pathname = new URL('.', url).pathname;
  return pathname === '/' ? '' : pathname.replace(/\/$/, '');
}

export function appUrl(pathname, url) {
  if (typeof pathname !== 'string' || !pathname.startsWith('/')) throw new Error('Application paths must start with /.');
  return `${appBase(url)}${pathname}`;
}
