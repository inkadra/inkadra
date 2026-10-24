import { useSyncExternalStore } from 'react';
import { isBusy, whenIdle } from './busy.ts';

/**
 * Registers /sw.js (production builds on secure contexts only) and tells the page when a new
 * version is ready. The new worker waits until the user chooses to update, and the reload
 * waits until the open board is saved and no upload is running (busy.ts).
 */

/** A new version is available; `deferred`: the user asked, and it waits for busy.ts. */
export interface Update {
  deferred: boolean;
}

let update: Update | null = null;
let action: (() => void) | null = null;
let cancel: (() => void) | null = null;
const listeners = new Set<() => void>();

function set(next: Update | null) {
  update = next;
  for (const listener of listeners) listener();
}

function offer(next: () => void) {
  cancel?.();
  cancel = null;
  action = next;
  set({ deferred: false });
}

/** The new version on offer, or null when there is none. */
export function useUpdate(): Update | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => update,
  );
}

/** Switches to the new version now, or once the board is saved and uploads are done. */
export function applyUpdate() {
  const run = action;
  if (!run || update?.deferred) return;
  if (isBusy()) set({ deferred: true });
  cancel = whenIdle(run);
}

export function dismissUpdate() {
  cancel?.();
  cancel = null;
  action = null;
  set(null);
}

const reload = () => {
  if (isBusy()) set({ deferred: true });
  whenIdle(() => window.location.reload());
};

/**
 * Whether `worker` precaches every build file this page loaded, that is whether the page
 * already runs that version (it was opened after the deploy). Script and style names change
 * with their content, and the entry script's name with the names of the chunks it loads.
 */
function runsVersionOf(worker: ServiceWorker): Promise<boolean> {
  const paths = [...document.querySelectorAll('script[src], link[rel="stylesheet"][href]')]
    .map((el) => new URL(el.getAttribute('src') ?? el.getAttribute('href') ?? '', location.href))
    .filter((url) => url.origin === location.origin && url.pathname.startsWith('/assets/'))
    .map((url) => url.pathname);
  if (paths.length === 0) return Promise.resolve(false);
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    // A worker that does not answer is treated as a different version: the prompt shows.
    const timer = setTimeout(() => resolve(false), 2000);
    channel.port1.onmessage = (event) => {
      clearTimeout(timer);
      resolve(event.data === true);
    };
    worker.postMessage({ type: 'has', paths }, [channel.port2]);
  });
}

const HOUR = 60 * 60 * 1000;

export function registerServiceWorker() {
  if (!import.meta.env.PROD || !window.isSecureContext || !('serviceWorker' in navigator)) return;
  const sw = navigator.serviceWorker;
  /** This tab activated the new worker: `requested` to switch to it, `silent` as it runs it. */
  let requested = false;
  let silent = false;

  sw.addEventListener('controllerchange', () => {
    if (silent) {
      silent = false;
      return;
    }
    if (requested) {
      reload();
      return;
    }
    // Another tab updated: this one still runs the old code, so offer a reload.
    offer(reload);
  });

  const offerWaiting = async (waiting: ServiceWorker) => {
    // Without a controller this is the first install, not an update.
    if (!sw.controller) return;
    if (await runsVersionOf(waiting)) {
      // Nothing to reload here; tabs on the old version get the prompt from controllerchange.
      silent = true;
      waiting.postMessage({ type: 'skip-waiting' });
      return;
    }
    offer(() => {
      requested = true;
      waiting.postMessage({ type: 'skip-waiting' });
    });
  };

  const followed = new WeakSet<ServiceWorker>();
  const follow = (installing: ServiceWorker) => {
    if (followed.has(installing)) return;
    followed.add(installing);
    installing.addEventListener('statechange', () => {
      if (installing.state === 'installed') void offerWaiting(installing);
    });
  };

  const start = async () => {
    const registration = await sw.register('/sw.js', { scope: '/' });
    if (registration.waiting) void offerWaiting(registration.waiting);
    // The navigation's own update check may already be installing a new version.
    if (registration.installing) follow(registration.installing);
    registration.addEventListener('updatefound', () => {
      if (registration.installing) follow(registration.installing);
    });
    // A board can stay open for days without a navigation, which is when browsers check.
    setInterval(() => void registration.update().catch(() => {}), HOUR);
  };

  const run = () => void start().catch(() => {});
  if (document.readyState === 'complete') run();
  else window.addEventListener('load', run, { once: true });
}
