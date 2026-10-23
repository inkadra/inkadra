import { API_PREFIX } from '@inkadra/shared/constants';
import { useSyncExternalStore } from 'react';
import { Upload } from 'tus-js-client';

export interface UploadItem {
  key: string;
  name: string;
  size: number;
  sent: number;
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

function emit() {
  items = [...items];
  for (const l of listeners) l();
}

function patch(key: string, change: Partial<UploadItem>) {
  items = items.map((i) => (i.key === key ? { ...i, ...change } : i));
  for (const l of listeners) l();
}

export interface StartUpload {
  file: File;
  projectId: string;
  /** The board the file goes on: people with access to some boards only upload there. */
  boardId: string;
  /** Called once, as soon as the server has created the asset (before the bytes arrive). */
  onAsset: (assetId: string) => void;
  onFailed?: (assetId: string | null) => void;
}

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
 * calls no `onAsset` again: its card already exists.
 */
export function startUpload({ file, projectId, boardId, onAsset, onFailed }: StartUpload): string {
  const fingerprint = [projectId, file.name, file.size, file.lastModified].join('|');
  const existing = items.find(
    (i) => i.fingerprint === fingerprint && i.state !== 'done' && i.state !== 'cancelled',
  );
  if (existing) {
    if (existing.state !== 'uploading') retryUpload(existing.key);
    return existing.key;
  }
  seq += 1;
  const key = `u${seq}`;
  const isImage = file.type.startsWith('image/');
  items.push({
    key,
    name: file.name,
    size: file.size,
    sent: 0,
    state: 'uploading',
    reconnecting: false,
    fingerprint,
    assetId: null,
    preview: isImage ? URL.createObjectURL(file) : null,
  });
  emit();
  let announced = false;
  const announce = (assetId: string | null) => {
    if (!assetId || announced) return;
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
      if (!online()) return false;
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
    onAfterResponse: (_req, res) => announce(res.getHeader('Inkadra-Asset-Id') ?? null),
    onProgress: (sent) => patch(key, { sent, reconnecting: false }),
    onSuccess: () => {
      patch(key, { state: 'done', sent: file.size, reconnecting: false });
      uploads.delete(key);
      setTimeout(() => dismiss(key), 4000);
    },
    onError: () => {
      if (!online()) {
        patch(key, { state: 'offline', reconnecting: false });
        return;
      }
      patch(key, { state: 'failed', reconnecting: false });
      onFailed?.(items.find((i) => i.key === key)?.assetId ?? null);
    },
  });
  uploads.set(key, upload);
  void upload
    .findPreviousUploads()
    .then((previous) => {
      const last = previous[0];
      if (last) upload.resumeFromPreviousUpload(last);
      upload.start();
    })
    .catch(() => upload.start());
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
  void upload.abort(true);
  patch(key, { state: 'cancelled' });
  setTimeout(() => dismiss(key), 1500);
}

function dismiss(key: string) {
  const item = items.find((i) => i.key === key);
  // Keep the preview while cards may still show it; the browser frees it with the page.
  if (item && item.state !== 'done' && item.preview) URL.revokeObjectURL(item.preview);
  items = items.filter((i) => i.key !== key);
  for (const l of listeners) l();
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
