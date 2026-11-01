import type { Asset } from '@inkadra/shared';
import { useCallback, useSyncExternalStore } from 'react';
import { createPoller, type Poller, type PollOutcome } from '../guest/poller.ts';
import { api, RequestError } from '../lib/api.ts';

/**
 * Asset metadata shared by every card that shows the same file. Assets still being processed
 * by the worker are polled until they are ready or failed.
 */
const cache = new Map<string, Asset | 'missing'>();
const listeners = new Map<string, Set<() => void>>();
const inflight = new Map<string, Promise<PollOutcome>>();
const pollers = new Map<string, Poller>();
const POLL_MS = 2000;

function notify(id: string) {
  for (const l of listeners.get(id) ?? []) l();
}

type Loader = (id: string) => Promise<Asset | null>;
const accountLoader: Loader = (id) => api.get<Asset>(`/assets/${id}`);
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
  for (const poller of pollers.values()) poller.stop();
  pollers.clear();
  for (const id of listeners.keys()) notify(id);
  // A guest page resets during its cleanup, before its cards unsubscribe. Wait for those
  // cleanups so leaving a guest page cannot start account requests for its old asset IDs.
  const at = generation;
  queueMicrotask(() => {
    if (at !== generation) return;
    for (const id of listeners.keys()) startPolling(id);
  });
}

async function load(id: string): Promise<PollOutcome> {
  const at = generation;
  let result: Asset | null;
  try {
    result = await loader(id);
  } catch (err) {
    if (err instanceof RequestError && err.status === 404) {
      result = null;
    } else {
      return { kind: at === generation ? 'retry' : 'done' };
    }
  }
  if (at !== generation) return { kind: 'done' };
  const value = result ?? 'missing';
  cache.set(id, value);
  notify(id);
  return { kind: needsPolling(id) ? 'ok' : 'done' };
}

function fetchOnce(id: string): Promise<PollOutcome> {
  const existing = inflight.get(id);
  if (existing) return existing;
  const p = load(id).finally(() => {
    if (inflight.get(id) === p) inflight.delete(id);
  });
  inflight.set(id, p);
  return p;
}

function needsPolling(id: string): boolean {
  const value = cache.get(id);
  if (!value) return true;
  if (value === 'missing') return false;
  // A video is ready with its poster while its playable copy is still being made.
  const proxy = value.proxy?.status;
  return (
    value.status === 'pending' ||
    value.status === 'processing' ||
    proxy === 'queued' ||
    proxy === 'processing'
  );
}

function suspended(): boolean {
  return navigator.onLine === false || document.visibilityState === 'hidden';
}

/** One poller per observed asset, even when several cards show the same file. */
function startPolling(id: string) {
  if (pollers.has(id) || !needsPolling(id)) return;
  const poller = createPoller({
    run: () => (needsPolling(id) ? fetchOnce(id) : Promise.resolve({ kind: 'done' })),
    interval: POLL_MS,
    max: 60_000,
    hidden: suspended,
  });
  pollers.set(id, poller);
  // Unlike start(), poke also honours the offline/background gate on first mount.
  poller.poke();
}

export function refetchPendingOrUnknown() {
  for (const id of listeners.keys()) {
    if (needsPolling(id)) pollers.get(id)?.poke();
  }
}

function subscribe(id: string, listener: () => void) {
  if (listeners.size === 0) {
    window.addEventListener('online', refetchPendingOrUnknown);
    document.addEventListener('visibilitychange', refetchPendingOrUnknown);
  }
  let set = listeners.get(id);
  if (!set) {
    set = new Set();
    listeners.set(id, set);
  }
  set.add(listener);
  startPolling(id);
  return () => {
    set.delete(listener);
    if (set.size === 0) {
      listeners.delete(id);
      pollers.get(id)?.stop();
      pollers.delete(id);
    }
    if (listeners.size === 0) {
      window.removeEventListener('online', refetchPendingOrUnknown);
      document.removeEventListener('visibilitychange', refetchPendingOrUnknown);
    }
  };
}

export function primeAsset(asset: Asset) {
  cache.set(asset.id, asset);
  notify(asset.id);
  pollers.get(asset.id)?.stop();
  pollers.delete(asset.id);
  if (listeners.has(asset.id)) startPolling(asset.id);
}

export function getCachedAsset(id: string): Asset | 'missing' | undefined {
  return cache.get(id);
}

export { fetchOnce as fetchAsset, load as loadAsset };

export function useAsset(id: string | undefined): Asset | 'missing' | undefined {
  return useSyncExternalStore(
    useCallback((listener) => (id ? subscribe(id, listener) : () => {}), [id]),
    () => (id ? cache.get(id) : undefined),
  );
}

const BROWSER_IMAGES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
]);

const browserPlays = (mime: string) =>
  typeof document !== 'undefined' && document.createElement('audio').canPlayType(mime) !== '';

/**
 * What a media element plays: the playable copy the worker made of a format browsers do not
 * read (decision 0048), else the original. Audio (#327) keeps its original wherever this
 * browser plays it: the AAC copy is for the others (Ogg or WebM on Safari, AIFF on Chrome).
 */
export function playbackUrl(asset: Asset, canPlay = browserPlays): string {
  const copy = asset.proxy?.status === 'ready' ? asset.proxy.url : null;
  if (!copy || (asset.kind === 'audio' && canPlay(asset.mime))) return asset.url;
  return copy;
}

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
