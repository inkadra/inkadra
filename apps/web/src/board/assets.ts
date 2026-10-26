import type { Asset } from '@inkadra/shared';
import { useEffect, useSyncExternalStore } from 'react';
import { api, RequestError } from '../lib/api.ts';

/**
 * Asset metadata shared by every card that shows the same file. Assets still being processed
 * by the worker are polled until they are ready or failed.
 */
const cache = new Map<string, Asset | 'missing'>();
const listeners = new Map<string, Set<() => void>>();
const inflight = new Map<string, Promise<void>>();
const POLL_MS = 2000;

function notify(id: string) {
  for (const l of listeners.get(id) ?? []) l();
}

type Loader = (id: string) => Promise<Asset | null>;
const accountLoader: Loader = async (id) => {
  try {
    return await api.get<Asset>(`/assets/${id}`);
  } catch (err) {
    if (err instanceof RequestError && err.status === 404) return null;
    throw err;
  }
};
let loader = accountLoader;

/**
 * Where metadata of files not primed yet comes from. The guest page of a share link primes
 * its files from the snapshot and must never call the account API, so it sets its own.
 */
export function setAssetLoader(next: Loader | null) {
  loader = next ?? accountLoader;
}

// Bumped by resetAssetCache, so answers of a loader set before do not land in the new cache.
let generation = 0;

/**
 * Forgets every file known so far, with the loader that fetched them. The guest page calls it
 * when it closes: its files have guest URLs and must not show up in the team's app.
 */
export function resetAssetCache() {
  generation += 1;
  cache.clear();
  inflight.clear();
}

async function load(id: string): Promise<void> {
  const at = generation;
  let result: Asset | null;
  try {
    result = await loader(id);
  } catch (err) {
    if (err instanceof RequestError && err.status === 404) {
      result = null;
    } else {
      return;
    }
  }
  if (at !== generation) return;
  const value = result ?? 'missing';
  cache.set(id, value);
  notify(id);
}

function fetchOnce(id: string): Promise<void> {
  const existing = inflight.get(id);
  if (existing) return existing;
  const p = load(id).finally(() => {
    if (inflight.get(id) === p) inflight.delete(id);
  });
  inflight.set(id, p);
  return p;
}

export function refetchPendingOrUnknown() {
  for (const [id, val] of cache.entries()) {
    if (val !== 'missing' && (val.status === 'pending' || val.status === 'processing')) {
      fetchOnce(id);
    }
  }
  for (const [id, set] of listeners.entries()) {
    if (set.size > 0 && !cache.has(id)) {
      fetchOnce(id);
    }
  }
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('online', refetchPendingOrUnknown);
}

export function primeAsset(asset: Asset) {
  cache.set(asset.id, asset);
  notify(asset.id);
}

export function getCachedAsset(id: string): Asset | 'missing' | undefined {
  return cache.get(id);
}

export { fetchOnce as fetchAsset, load as loadAsset };

export function useAsset(id: string | undefined): Asset | 'missing' | undefined {
  const value = useSyncExternalStore(
    (l) => {
      if (!id) return () => {};
      let set = listeners.get(id);
      if (!set) {
        set = new Set();
        listeners.set(id, set);
      }
      set.add(l);
      return () => {
        set.delete(l);
        if (set.size === 0) listeners.delete(id);
      };
    },
    () => (id ? cache.get(id) : undefined),
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: each new value restarts the poll
  useEffect(() => {
    if (!id) return;
    const current = cache.get(id);
    if (!current) fetchOnce(id);
    const shouldPoll =
      !current ||
      (current !== 'missing' && (current.status === 'pending' || current.status === 'processing'));
    if (shouldPoll) {
      const timer = setInterval(() => fetchOnce(id), POLL_MS);
      return () => clearInterval(timer);
    }
  }, [id, value]);

  return value;
}

const BROWSER_IMAGES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
]);

/**
 * Smallest variant at least `pixels` wide, else the largest there is. Before the worker has
 * made variants, the original when the browser can show it, else an empty string.
 */
export function pickVariant(asset: Asset, pixels: number): string {
  const variants = [...asset.variants].sort((a, b) => a.width - b.width);
  const fit = variants.find((v) => v.width >= pixels) ?? variants.at(-1);
  if (fit) return fit.url;
  return BROWSER_IMAGES.has(asset.mime) ? asset.url : '';
}
