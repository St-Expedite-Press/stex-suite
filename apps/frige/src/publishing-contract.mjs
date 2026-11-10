// stex.frige.publishing.v1: an additive HTTP facade over the owning engine.
// The payloads and store validators remain the existing publishing operations.
const fixed = {
  '/books': ['GET', 'POST'], '/health': ['GET'], '/book': ['GET'], '/pages': ['POST'],
  '/project/graph': ['GET'], '/project/refresh': ['POST'], '/project/preview': ['GET'],
  '/project/build': ['GET', 'POST'], '/project/preflight': ['GET'], '/project/design': ['GET', 'PUT'],
  '/project/artifacts': ['GET'], '/project/reference-map': ['GET'], '/project/live-build': ['GET', 'POST'],
  '/project/page-map': ['GET'], '/project/attachments': ['GET', 'POST'], '/inference/health': ['GET'],
  '/settings/models': ['GET', 'PUT'], '/settings/model-catalog': ['GET'],
};
export function publishingRoute(pathname) {
  if (fixed[pathname]) return fixed[pathname];
  if (/^\/nodes\/[a-z0-9-]+$/.test(pathname)) return ['GET', 'PUT'];
  if (/^\/project\/attachments\/[a-f0-9]{16}\/approve$/.test(pathname)) return ['POST'];
  if (/^\/artifacts\/art-[a-f0-9]{16}(?:\/content)?$/.test(pathname)) return ['GET'];
  const scope = /^\/scopes\/(book|[a-z][a-z0-9-]{5,80})\/(turns|turn|changes|changes\/decide)$/.exec(pathname);
  if (scope) return ['turn', 'changes/decide'].includes(scope[2]) ? ['POST'] : ['GET'];
  const page = /^\/pages\/[a-z0-9-]+(?:\/(preview|turns|proposal|build|turn|proposal\/accept|proposal\/reject))?$/.exec(pathname);
  if (page) return !page[1] ? ['GET', 'PUT'] : page[1] === 'build' ? ['GET', 'POST'] : ['turn', 'proposal/accept', 'proposal/reject'].includes(page[1]) ? ['POST'] : ['GET'];
  return null;
}
