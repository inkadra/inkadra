/**
 * What the service worker does with each request. Kept apart from the worker so it can be
 * tested: anything not listed here goes to the network as if there were no worker.
 */

/** The page shown when a navigation cannot reach the server. */
export const OFFLINE_PAGE = '/offline.html';

/** Build files worth keeping: scripts, styles and fonts, all fingerprinted by Vite. */
export function isPrecached(fileName: string): boolean {
  return /^assets\/[^/]+\.(js|css|woff2)$/.test(fileName);
}

export type Route =
  /** Answer from the precache; it holds exactly this build's files. */
  | 'precache'
  /** Network first; the offline page if the network fails. Never cached. */
  | 'navigate'
  /** Not handled: the browser fetches it as usual. */
  | 'network';

export interface RequestLike {
  method: string;
  url: string;
  mode: string;
  headers: { has(name: string): boolean };
}

/** Paths the worker never touches: the API (and sign-in), files and real-time collaboration. */
function isServerPath(path: string): boolean {
  return (
    path === '/api' || path.startsWith('/api/') || path === '/collab' || path.startsWith('/collab/')
  );
}

export function route(request: RequestLike, origin: string, precached: ReadonlySet<string>): Route {
  if (request.method !== 'GET') return 'network';
  const url = new URL(request.url);
  if (url.origin !== origin || isServerPath(url.pathname)) return 'network';
  // Byte ranges (media seeks) cannot be answered from a whole cached file, and a request that
  // carries its own credentials is never one of the build's public files.
  if (request.headers.has('range') || request.headers.has('authorization')) return 'network';
  if (request.mode === 'navigate')
    return url.pathname.startsWith('/assets/') ? 'network' : 'navigate';
  if (url.search === '' && precached.has(url.pathname)) return 'precache';
  return 'network';
}
