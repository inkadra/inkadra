/**
 * The service worker, built by pwa/plugin.ts into /sw.js with this build's file list.
 * It keeps the build's scripts, styles and fonts, and an offline page for navigations; the
 * API, sign-in, uploads, user files and the collaboration socket never pass through it.
 * Rules in routing.ts; why it is written by hand in docs/decisions/0015-installable-web-app.md.
 */
import { OFFLINE_PAGE, route } from './routing.ts';

declare const __PRECACHE__: string[];
declare const __CACHE_VERSION__: string;

// The DOM library has no service worker types; these are the few this file uses.
interface ExtendableEvent extends Event {
  waitUntil(promise: Promise<unknown>): void;
}
interface FetchEvent extends ExtendableEvent {
  request: Request;
  respondWith(response: Promise<Response>): void;
}
interface Worker {
  location: Location;
  skipWaiting(): Promise<void>;
  addEventListener(type: 'install' | 'activate', listener: (event: ExtendableEvent) => void): void;
  addEventListener(type: 'fetch', listener: (event: FetchEvent) => void): void;
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
}

const worker = self as unknown as Worker;
const PREFIX = 'inkadra-';
const CACHE = `${PREFIX}${__CACHE_VERSION__}`;
const precached = new Set(__PRECACHE__);

worker.addEventListener('install', (event) => {
  // A new version waits until the page asks for it (the "new version" prompt), so an open
  // board never switches code under the user's hands.
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll([...precached])));
});

worker.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k)),
        ),
      ),
  );
});

worker.addEventListener('message', (event) => {
  if (event.data?.type === 'skip-waiting') void worker.skipWaiting();
});

worker.addEventListener('fetch', (event) => {
  const request = event.request;
  const how = route(request, worker.location.origin, precached);
  if (how === 'precache') {
    event.respondWith(
      caches
        .open(CACHE)
        .then((cache) => cache.match(request))
        .then((hit) => hit ?? fetch(request)),
    );
  } else if (how === 'navigate') {
    event.respondWith(
      fetch(request).catch(async () => {
        const page = await caches.open(CACHE).then((cache) => cache.match(OFFLINE_PAGE));
        return page ?? Response.error();
      }),
    );
  }
  // Anything else: no respondWith, so the browser fetches it as if there were no worker.
});
