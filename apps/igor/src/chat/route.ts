// History API routing under the /igor/ mount. No router library.

export type Route =
  | { kind: 'home' }
  | { kind: 'new' }
  | { kind: 'conversation'; id: string };

export const HOME_PATH = '/igor/';
export const NEW_PATH = '/igor/new';
export const conversationPath = (id: string) => `/igor/c/${encodeURIComponent(id)}`;

export function parseRoute(pathname: string): Route {
  const path = pathname.replace(/\/+$/, '');
  if (path === '/igor/new') return { kind: 'new' };
  const match = /^\/igor\/c\/([^/]+)$/.exec(path);
  if (match) {
    let id = match[1];
    try {
      id = decodeURIComponent(id);
    } catch {
      // keep the raw segment; the server answers 404 for an unknown id
    }
    return { kind: 'conversation', id };
  }
  return { kind: 'home' };
}

export const routeKey = (route: Route) => (route.kind === 'conversation' ? `c:${route.id}` : route.kind);

/** True for a plain primary click that the SPA should handle itself. */
export const isPlainClick = (event: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; defaultPrevented: boolean }) =>
  event.button === 0 && !event.defaultPrevented && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
