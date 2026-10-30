// SPDX-License-Identifier: AGPL-3.0-only
import { createElement, frameLabels, storyboardOf, updateElement } from '@inkadra/canvas-core';
import { hiddenFromGuests, roots, type VideoFrameSource } from '@inkadra/doc-schema';
import { type BoardStore, LOCAL } from './store.ts';

/** Presentation time for people; source metadata keeps the unrounded seconds. */
export function formatSourceTime(seconds: number, locale: string): string {
  const hundredths = Math.round(Math.max(0, Number.isFinite(seconds) ? seconds : 0) * 100);
  const minutes = new Intl.NumberFormat(locale, { useGrouping: false }).format(
    Math.floor(hundredths / 6000),
  );
  const remainder = new Intl.NumberFormat(locale, {
    useGrouping: false,
    minimumIntegerDigits: 2,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format((hundredths % 6000) / 100);
  return `${minutes}:${remainder}`;
}

/** Freeze and present a decoded frame before reading its time or copying its pixels. */
export async function captureVideoFrame(
  video: HTMLVideoElement,
  signal?: AbortSignal,
): Promise<{ file: File; timeSeconds: number }> {
  if (new URL(video.currentSrc || video.src, location.href).origin !== location.origin)
    throw new Error('cross-origin');
  if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) throw new Error('not-ready');
  video.pause();
  const presented = await new Promise<number | null>((resolve, reject) => {
    let callback: number | undefined;
    let raf: number | undefined;
    const finish = (time: number | null, error?: Error) => {
      clearTimeout(timeout);
      video.removeEventListener('seeked', seeked);
      signal?.removeEventListener('abort', aborted);
      if (callback !== undefined) video.cancelVideoFrameCallback(callback);
      if (raf !== undefined) cancelAnimationFrame(raf);
      if (error) reject(error);
      else resolve(time);
    };
    const aborted = () => finish(null, new Error('cancelled'));
    const seeked = () => {
      if (video.requestVideoFrameCallback)
        callback = video.requestVideoFrameCallback((_now, meta) => finish(meta.mediaTime));
      // Some browsers do not send a new rVFC for a same-time seek. Wait for paint there.
      raf = requestAnimationFrame(() => {
        raf = requestAnimationFrame(() => finish(null));
      });
    };
    const timeout = setTimeout(() => finish(null, new Error('frame-timeout')), 3000);
    video.addEventListener('seeked', seeked, { once: true });
    signal?.addEventListener('abort', aborted, { once: true });
    if (signal?.aborted) {
      aborted();
      return;
    }
    // Force a paused presentation even when capture was requested during playback.
    // biome-ignore lint/correctness/noSelfAssign: a same-time seek refreshes paused video presentation
    video.currentTime = video.currentTime;
  });
  if (signal?.aborted || video.seeking || !video.paused) throw new Error('not-ready');
  const timeSeconds = presented ?? video.currentTime;
  const canvas = document.createElement('canvas');
  try {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas-unavailable');
    ctx.drawImage(video, 0, 0);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('encode-failed'))),
        'image/png',
      );
    });
    return {
      file: new File([blob], `frame-${timeSeconds.toFixed(3)}.png`, { type: 'image/png' }),
      timeSeconds,
    };
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

export function frameChoices(store: BoardStore) {
  const groups = storyboardOf([...store.getSnapshot().byId.values()]);
  const labels = frameLabels(groups);
  return groups
    .flatMap((g) => g.frames)
    .map((frame) => ({ id: frame.id, label: labels.get(frame.id) || frame.id }));
}

/** Use the live document at commit time: collaborators may delete a destination during upload. */
export function placeVideoStill(
  store: BoardStore,
  input: {
    sourceId: string;
    targetId: string | null;
    assetId: string;
    source: VideoFrameSource;
    userId: string;
    caption: string;
    reference?: string;
  },
): boolean {
  const byId = store.getSnapshot().byId;
  const original = byId.get(input.sourceId);
  const target = input.targetId ? byId.get(input.targetId) : null;
  if (!original || (input.targetId && target?.type !== 'frame')) return false;
  const guestHidden = hiddenFromGuests(original.id, (id) => byId.get(id));
  store.undo.stopCapturing();
  if (target?.type === 'frame') {
    const notes = [target.notes, input.reference].filter(Boolean).join('\n');
    // Never truncate director's notes to make room for a reference.
    if (notes.length > 4000) return false;
    updateElement(
      store.doc,
      target.id,
      {
        assetId: input.assetId,
        source: input.source,
        ...(input.reference ? { notes } : {}),
        ...(guestHidden ? { guestHidden: true } : {}),
      },
      LOCAL,
    );
  } else {
    createElement(
      store.doc,
      'image',
      { x: original.x + original.w + 24, y: original.y },
      {
        assetId: input.assetId,
        source: input.source,
        caption: input.caption.slice(0, 2000),
        guestHidden,
        parent: original.parent,
      },
      { userId: input.userId, origin: LOCAL },
    );
  }
  return true;
}

export function uploadBoardId(store: BoardStore): string | null {
  const id = roots(store.doc).meta.get('boardId');
  return typeof id === 'string' ? id : null;
}

/** Observed adjacent presentation timestamps are exact; an unobserved seek is approximate. */
export class VideoFrameStepper {
  private callback: number | null = null;
  private last: { time: number; frame: number } | null = null;
  private adjacent = new Map<number, number>();
  get mediaTime(): number | null {
    return this.last?.time ?? null;
  }
  start(video: HTMLVideoElement) {
    if (!video.requestVideoFrameCallback) return () => {};
    const tick: VideoFrameRequestCallback = (_now, meta) => {
      if (
        this.last &&
        meta.presentedFrames === this.last.frame + 1 &&
        meta.mediaTime > this.last.time &&
        !video.seeking
      )
        this.adjacent.set(this.last.time, meta.mediaTime);
      this.last = { time: meta.mediaTime, frame: meta.presentedFrames };
      const oldest = this.adjacent.keys().next().value;
      if (this.adjacent.size > 10000 && oldest !== undefined) this.adjacent.delete(oldest);
      this.callback = video.requestVideoFrameCallback(tick);
    };
    const seeking = () => {
      this.last = null;
    };
    video.addEventListener('seeking', seeking);
    this.callback = video.requestVideoFrameCallback(tick);
    return () => {
      video.removeEventListener('seeking', seeking);
      if (this.callback !== null) video.cancelVideoFrameCallback(this.callback);
    };
  }
  step(video: HTMLVideoElement, direction: -1 | 1): boolean {
    if (!video.paused || video.seeking) return false;
    const current = this.last?.time ?? video.currentTime;
    const next =
      direction === 1
        ? this.adjacent.get(current)
        : [...this.adjacent].find(([, end]) => end === current)?.[0];
    video.currentTime = Math.max(
      0,
      Math.min(video.duration || 0, next ?? video.currentTime + direction / 30),
    );
    return next !== undefined;
  }
}
