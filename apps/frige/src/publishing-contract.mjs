/** Frige publishing engine source that maps versioned publishing routes to their supported methods. */
// stex.frige.publishing.v1: an additive HTTP facade over the owning engine.
// The payloads and store validators remain the existing publishing operations.
const fixed = {
  '/books': ['GET', 'POST'], '/health': ['GET'], '/book': ['GET'], '/pages': ['POST'],
  '/project/graph': ['GET'], '/project/refresh': ['POST'], '/project/preview': ['GET'],
  '/project/build': ['GET', 'POST'], '/project/preflight': ['GET'], '/project/design': ['GET', 'PUT'],
  '/project/artifacts': ['GET'], '/project/reference-map': ['GET'], '/project/live-build': ['GET', 'POST'],
  '/project/page-map': ['GET'], '/project/attachments': ['GET', 'POST'], '/inference/health': ['GET'],
  '/settings/models': ['GET', 'PUT'], '/settings/model-catalog': ['GET'],
  // Change contracts (stex.frige.change-contract.v1): history without manuscript text.
  '/project/contracts': ['GET'],
};
const CONTRACT_ROUTE = /^\/contracts\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}(\/revert)?$/;
export const editorialRoute = /^\/nodes\/(node-[a-f0-9]{20})\/(decisions|revisions)(?:\/([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})(\/restore)?)?$/;

/**
 * Methods the publishing facade allows for a route.
 *
 * @param {string} pathname  Path after the `/api/stex/publishing/v1` prefix.
 * @returns {string[] | null}  Allowed HTTP methods, or `null` for an unknown route.
 */
export function publishingRoute(pathname) {
  if (fixed[pathname]) return fixed[pathname];
  // One contract in full, or the rollback of its accepted changes.
  const contract = CONTRACT_ROUTE.exec(pathname);
  if (contract) return contract[1] ? ['POST'] : ['GET'];
  const editorial = editorialRoute.exec(pathname);
  if (editorial) {
    if (editorial[2] === 'decisions') return editorial[3] ? null : ['GET', 'POST'];
    return editorial[4] ? ['POST'] : ['GET'];
  }
  if (/^\/nodes\/[a-z0-9-]+$/.test(pathname)) return ['GET', 'PUT'];
  if (/^\/project\/attachments\/[a-f0-9]{16}\/approve$/.test(pathname)) return ['POST'];
  if (/^\/project\/attachments\/[a-f0-9]{16}\/excerpt$/.test(pathname)) return ['GET'];
  if (/^\/artifacts\/art-[a-f0-9]{16}(?:\/content)?$/.test(pathname)) return ['GET'];
  const scope = /^\/scopes\/(book|[a-z][a-z0-9-]{5,80})\/(turns|turn|changes|changes\/decide)$/.exec(pathname);
  if (scope) return ['turn', 'changes/decide'].includes(scope[2]) ? ['POST'] : ['GET'];
  const page = /^\/pages\/[a-z0-9-]+(?:\/(preview|turns|proposal|build|turn|proposal\/accept|proposal\/reject))?$/.exec(pathname);
  if (page) return !page[1] ? ['GET', 'PUT'] : page[1] === 'build' ? ['GET', 'POST'] : ['turn', 'proposal/accept', 'proposal/reject'].includes(page[1]) ? ['POST'] : ['GET'];
  return null;
}
