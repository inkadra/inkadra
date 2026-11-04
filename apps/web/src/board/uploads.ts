import { isRawImageType } from '@inkadra/shared';
import { API_PREFIX } from '@inkadra/shared/constants';
import { useSyncExternalStore } from 'react';
import { Upload } from 'tus-js-client';
import { setBusy } from '../pwa/busy.ts';
import { isDesignFile } from './file-kinds.ts';

export interface UploadItem {
  key: string;
  name: string;
  size: number;
  sent: number;
  bytesPerSecond: number;
  remainingSeconds: number | null;
  /** `offline`: paused while the browser has no network, resumes by itself when it is back. */
  state: 'uploading' | 'offline' | 'done' | 'failed' | 'cancelled';
  /** A request failed and tus is retrying it, while the browser still reports a network. */
  reconnecting: boolean;
  /** Same file, same project: adding it again resumes this upload instead of starting another. */
  fingerprint: string;
  assetId: string | null;
  /** Object URL of the local file, shown by image cards until the server has a preview. */
  preview: string | null;
}

/** Chunks stay below the 100 MB request limit of Cloudflare and similar proxies. */
const CHUNK = 50 * 1024 * 1024;

let items: UploadItem[] = [];
/** Uploads that can still go on: running, paused offline or failed (for "Riprova"). */
const uploads = new Map<string, Upload>();
const listeners = new Set<() => void>();
let seq = 0;

const BUSY = 'uploads';

function changed() {
  // A reload for a new version waits for uploads that can still run (running, paused offline,
  // failed and retryable): their File is in memory only, and reloading would lose it.
  setBusy(
    BUSY,
    items.some((i) => i.state === 'uploading' || i.state === 'offline' || i.state === 'failed'),
  );
  for (const l of listeners) l();
}

function emit() {
  items = [...items];
  changed();
}

function patch(key: string, change: Partial<UploadItem>) {
  items = items.map((i) => (i.key === key ? { ...i, ...change } : i));
  changed();
}

export interface StartUpload {
  file: File;
  projectId: string;
  /** The board the file goes on: people with access to some boards only upload there. */
  boardId: string;
  /** Called once, as soon as the server has created the asset (before the bytes arrive). */
  onAsset: (assetId: string) => void;
  onFailed?: (assetId: string | null) => void;
  onComplete?: (assetId: string) => void;
}

/** Those who asked again for a file already on its way: they hear how it ends too. */
const followers = new Map<
  string,
  Array<{ onComplete: StartUpload['onComplete']; onFailed: StartUpload['onFailed'] }>
>();

const online = () => typeof navigator === 'undefined' || navigator.onLine !== false;

if (typeof window !== 'undefined') {
  // Offline: pause, rather than wait on requests that may hang or fail one by one.
  window.addEventListener('offline', () => {
    for (const item of items) {
      if (item.state !== 'uploading') continue;
      void uploads.get(item.key)?.abort();
      patch(item.key, { state: 'offline', reconnecting: false });
    }
  });
  // Back online: every paused upload goes on from where the server stopped.
  window.addEventListener('online', () => {
    for (const item of items) if (item.state === 'offline') retryUpload(item.key);
  });
}

/**
 * Resumable upload over tus; an interrupted upload resumes, also after a reload. Returns the
 * key of the upload in the panel. Adding a file that is already in the panel for the same
 * project resumes that upload (or leaves it running) instead of starting a second one, and
 * calls no `onAsset` again: its card already exists. `onComplete` and `onFailed` still follow it.
 */
export function startUpload({
  file,
  projectId,
  boardId,
  onAsset,
  onFailed,
  onComplete,
}: StartUpload): string {
  const fingerprint = [projectId, file.name, file.size, file.lastModified].join('|');
  const existing = items.find(
    (i) => i.fingerprint === fingerprint && i.state !== 'done' && i.state !== 'cancelled',
  );
  if (existing) {
    if (onComplete || onFailed)
      followers.set(existing.key, [
        ...(followers.get(existing.key) ?? []),
        { onComplete, onFailed },
      ]);
    if (existing.state !== 'uploading') retryUpload(existing.key);
    return existing.key;
  }
  seq += 1;
  const key = `u${seq}`;
  const isImage =
    file.type.startsWith('image/') && !isDesignFile(file.name) && !isRawImageType(file.type);
  items.push({
    key,
    name: file.name,
    size: file.size,
    sent: 0,
    bytesPerSecond: 0,
    remainingSeconds: null,
    state: 'uploading',
    reconnecting: false,
    fingerprint,
    assetId: null,
    preview: isImage ? URL.createObjectURL(file) : null,
  });
  emit();
  let sampledAt = performance.now();
  let sampledBytes = 0;
  let announced = false;
  const announce = (assetId: string | null) => {
    if (!uploads.has(key) || !assetId || announced) return;
    announced = true;
    patch(key, { assetId });
    onAsset(assetId);
  };
  const upload = new Upload(file, {
    endpoint: `${API_PREFIX}/uploads`,
    chunkSize: CHUNK,
    retryDelays: [0, 1000, 3000, 5000, 10000, 20000, 30000, 60000],
    // Offline, retrying only burns attempts: the upload pauses and resumes on "online".
    onShouldRetry: (err) => {
      if (!uploads.has(key) || !online()) return false;
      const status = err.originalResponse?.getStatus() ?? 0;
      const retry = status < 400 || status >= 500 || status === 409 || status === 423;
      if (retry) patch(key, { reconnecting: true });
      return retry;
    },
    storeFingerprintForResuming: true,
    removeFingerprintOnSuccess: true,
    metadata: {
      projectId,
      boardId,
      filename: file.name,
      filetype: file.type || 'application/octet-stream',
    },
    // tus can finish opening the File after abort() and reset its internal aborted flag.
    // Guard the request boundary as well, so that delayed work cannot restart a cancelled upload.
    onBeforeRequest: (req) => {
      if (!uploads.has(key) && req.getMethod() !== 'DELETE') throw new Error('Upload cancelled');
    },
    onAfterResponse: (_req, res) => announce(res.getHeader('Inkadra-Asset-Id') ?? null),
    onProgress: (sent) => {
      if (!uploads.has(key)) return;
      const now = performance.now();
      const elapsed = (now - sampledAt) / 1000;
      if (elapsed < 0.5 || sent < sampledBytes) {
        if (sent < sampledBytes) {
          sampledAt = now;
          sampledBytes = sent;
        }
        patch(key, { sent, reconnecting: false });
        return;
      }
      const bytesPerSecond = (sent - sampledBytes) / elapsed;
      sampledAt = now;
      sampledBytes = sent;
      patch(key, {
        sent,
        bytesPerSecond,
        remainingSeconds:
          bytesPerSecond > 0 ? Math.ceil((file.size - sent) / bytesPerSecond) : null,
        reconnecting: false,
      });
    },
    onSuccess: () => {
      if (!uploads.has(key)) return;
      patch(key, { state: 'done', sent: file.size, reconnecting: false });
      uploads.delete(key);
      const assetId = items.find((i) => i.key === key)?.assetId;
      if (assetId) {
        onComplete?.(assetId);
        for (const follower of followers.get(key) ?? []) follower.onComplete?.(assetId);
      }
      followers.delete(key);
      setTimeout(() => dismiss(key), 4000);
    },
    onError: () => {
      if (!uploads.has(key)) return;
      if (!online()) {
        patch(key, { state: 'offline', reconnecting: false });
        return;
      }
      patch(key, { state: 'failed', reconnecting: false });
      const assetId = items.find((i) => i.key === key)?.assetId ?? null;
      onFailed?.(assetId);
      for (const follower of followers.get(key) ?? []) follower.onFailed?.(assetId);
    },
  });
  uploads.set(key, upload);
  void upload
    .findPreviousUploads()
    .then((previous) => {
      if (!uploads.has(key)) return;
      const last = previous[0];
      if (last) upload.resumeFromPreviousUpload(last);
      upload.start();
    })
    .catch(() => {
      if (uploads.has(key)) upload.start();
    });
  return key;
}

/** Starts a paused or failed upload again; tus asks the server how much it already has. */
export function retryUpload(key: string) {
  const upload = uploads.get(key);
  if (!upload) return;
  patch(key, { state: 'uploading' });
  upload.start();
}

export function cancelUpload(key: string) {
  const upload = uploads.get(key);
  if (!upload) return;
  uploads.delete(key);
  followers.delete(key);
  void upload.abort(true).catch(() => {});
  patch(key, { state: 'cancelled' });
  setTimeout(() => dismiss(key), 1500);
}

function dismiss(key: string) {
  const item = items.find((i) => i.key === key);
  // Keep the preview while cards may still show it; the browser frees it with the page.
  if (item && item.state !== 'done' && item.preview) URL.revokeObjectURL(item.preview);
  items = items.filter((i) => i.key !== key);
  changed();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useUploads(): UploadItem[] {
  return useSyncExternalStore(subscribe, () => items);
}

const previews = new Map<string, string>();

/** Local preview of an asset uploaded from this tab, if any. */
export function localPreview(assetId: string): string | null {
  const cached = previews.get(assetId);
  if (cached) return cached;
  const item = items.find((i) => i.assetId === assetId && i.preview);
  if (item?.preview) previews.set(assetId, item.preview);
  return item?.preview ?? null;
}

/** Upload progress of an asset sent from this tab, 0 to 1, or null when not uploading here. */
export function useUploadProgress(assetId: string | undefined): number | null {
  return useSyncExternalStore(subscribe, () => {
    const item = assetId ? items.find((i) => i.assetId === assetId) : undefined;
    if (item?.state !== 'uploading' && item?.state !== 'offline') return null;
    return item.size ? item.sent / item.size : 0;
  });
}
