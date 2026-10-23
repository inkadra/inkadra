import type { Asset } from '@inkadra/shared';
import { useEffect, useSyncExternalStore } from 'react';
import { api } from '../lib/api.ts';

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

async function load(id: string): Promise<void> {
  try {
    const asset = await api.get<Asset>(`/assets/${id}`);
    cache.set(id, asset);
  } catch {
    cache.set(id, 'missing');
  }
  notify(id);
}

function fetchOnce(id: string) {
  if (inflight.has(id)) return;
  const p = load(id).finally(() => inflight.delete(id));
  inflight.set(id, p);
}

export function primeAsset(asset: Asset) {
  cache.set(asset.id, asset);
  notify(asset.id);
}

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
      return () => set.delete(l);
    },
    () => (id ? cache.get(id) : undefined),
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: each new value restarts the poll
  useEffect(() => {
    if (!id) return;
    const current = cache.get(id);
    if (!current) fetchOnce(id);
    if (
      current &&
      current !== 'missing' &&
      (current.status === 'pending' || current.status === 'processing')
    ) {
      const timer = setTimeout(() => fetchOnce(id), POLL_MS);
      return () => clearTimeout(timer);
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
