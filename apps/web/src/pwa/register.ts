import { useSyncExternalStore } from 'react';

/**
 * Registers /sw.js (production builds on secure contexts only) and tells the page when a new
 * version is ready. The new worker waits until the user chooses to update.
 */

type Update = (() => void) | null;

let update: Update = null;
const listeners = new Set<() => void>();

function setUpdate(next: Update) {
  update = next;
  for (const listener of listeners) listener();
}

/** The action that switches to the new version, or null when there is none. */
export function useUpdate(): Update {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => update,
  );
}

export function dismissUpdate() {
  setUpdate(null);
}

const HOUR = 60 * 60 * 1000;

export function registerServiceWorker() {
  if (!import.meta.env.PROD || !window.isSecureContext || !('serviceWorker' in navigator)) return;
  const sw = navigator.serviceWorker;
  let requested = false;

  sw.addEventListener('controllerchange', () => {
    if (requested) {
      window.location.reload();
      return;
    }
    // Another tab updated: this one still runs the old code, so offer a reload.
    setUpdate(() => window.location.reload());
  });

  const offer = (waiting: ServiceWorker) => {
    // Without a controller this is the first install, not an update.
    if (!sw.controller) return;
    setUpdate(() => {
      requested = true;
      waiting.postMessage({ type: 'skip-waiting' });
    });
  };

  const start = async () => {
    const registration = await sw.register('/sw.js', { scope: '/' });
    if (registration.waiting) offer(registration.waiting);
    registration.addEventListener('updatefound', () => {
      const installing = registration.installing;
      installing?.addEventListener('statechange', () => {
        if (installing.state === 'installed') offer(installing);
      });
    });
    // A board can stay open for days without a navigation, which is when browsers check.
    setInterval(() => void registration.update().catch(() => {}), HOUR);
  };

  const run = () => void start().catch(() => {});
  if (document.readyState === 'complete') run();
  else window.addEventListener('load', run, { once: true });
}
