# 0015 · An installable web app with a hand-written service worker

Accepted, 2026-10.

**Context.** People want Inkadra in its own window and on their phone's home screen before the
mobile app exists. Browsers install a site that has a web app manifest and, for the full
experience, a service worker. A service worker sits in front of every request of the page, so
a careless one breaks exactly what Inkadra depends on: sign-in redirects, the collaboration
WebSocket, resumable uploads, private files, and data that must never outlive a session on a
shared computer. Libraries such as Workbox (through vite-plugin-pwa) are capable, but most of
what they offer is caching strategies we do not want, and their generated workers are harder
to read in a review.

**Decision.**
- The worker is about seventy lines of our own code (`apps/web/src/pwa/sw.ts`); which requests
  it answers is one pure function (`routing.ts`) with its own tests. A small Vite plugin
  (`apps/web/pwa/plugin.ts`) builds it into `/sw.js` with the list of the build's files, and
  writes the manifest, the offline page and the icons. No new dependency.
- It answers only two kinds of request. Scripts, styles and woff2 fonts of the current build
  (`/assets/…`, all fingerprinted) come from a precache named after the build. Page navigations
  go to the network first and, only when the network fails, get a static offline page in
  Italian and English. Navigation responses are never stored.
- Everything else goes to the network as if there were no worker: `/api/*` (including
  `/api/auth/*` and its OAuth callbacks, user files under `/api/v1/assets` and tus uploads),
  `/collab`, any other origin, anything other than `GET`, range requests and requests with an
  `Authorization` header. Navigation preload stays off, so an OAuth callback is requested
  exactly once.
- A new version installs in the background and waits. The page shows _New version available —
  Update_; pressing it activates the new worker and reloads. Activation deletes the caches of
  older versions. Until then an open board keeps the code and the lazily loaded chunks of the
  version it started with, even after the server has been upgraded.
- The worker is registered only by production builds and only in secure contexts (HTTPS or
  `localhost`). The manifest's colours come from the design tokens; the window colour follows
  the theme in use. The icons are drawn at build time from the shapes of `favicon.svg`.

**Consequences.** Inkadra is not an offline app: without the server the installed app shows the
offline page. Working offline on a board needs a local copy of documents and files, which is
a separate decision. Instances served over plain HTTP do not get the worker or the install
option. A reverse proxy or a future Content-Security-Policy must allow `worker-src 'self'` and
`manifest-src 'self'`; the server sets none today.
