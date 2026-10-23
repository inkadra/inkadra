import { API_PREFIX } from '@inkadra/shared/constants';
import { useSyncExternalStore } from 'react';
import { Upload } from 'tus-js-client';

export interface UploadItem {
  key: string;
  name: string;
  size: number;
  sent: number;
  state: 'uploading' | 'done' | 'failed' | 'cancelled';
  assetId: string | null;
  /** Object URL of the local file, shown by image cards until the server has a preview. */
  preview: string | null;
}

/** Chunks stay below the 100 MB request limit of Cloudflare and similar proxies. */
const CHUNK = 50 * 1024 * 1024;

let items: UploadItem[] = [];
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
  /** Called once, as soon as the server has created the asset (before the bytes arrive). */
  onAsset: (assetId: string) => void;
  onFailed?: (assetId: string | null) => void;
}

/** Resumable upload over tus; an interrupted upload resumes, also after a reload. */
export function startUpload({ file, projectId, onAsset, onFailed }: StartUpload): string {
  seq += 1;
  const key = `u${seq}`;
  const isImage = file.type.startsWith('image/');
  items.push({
    key,
    name: file.name,
    size: file.size,
    sent: 0,
    state: 'uploading',
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
    retryDelays: [0, 1000, 3000, 5000, 10000, 20000],
    storeFingerprintForResuming: true,
    removeFingerprintOnSuccess: true,
    metadata: { projectId, filename: file.name, filetype: file.type || 'application/octet-stream' },
    onAfterResponse: (_req, res) => announce(res.getHeader('Inkadra-Asset-Id') ?? null),
    onProgress: (sent) => patch(key, { sent }),
    onSuccess: () => {
      patch(key, { state: 'done', sent: file.size });
      uploads.delete(key);
      setTimeout(() => dismiss(key), 4000);
    },
    onError: () => {
      patch(key, { state: 'failed' });
      uploads.delete(key);
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
    if (item?.state !== 'uploading') return null;
    return item.size ? item.sent / item.size : 0;
  });
}
