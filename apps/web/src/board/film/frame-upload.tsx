// SPDX-License-Identifier: AGPL-3.0-only
import { updateElement } from '@inkadra/canvas-core';
import { useTranslation } from 'react-i18next';
import { type BoardStore, LOCAL } from '../store.ts';
import { retryUpload, startUpload, useUploads } from '../uploads.ts';

/** The upload each frame waits for. */
const waiting = new Map<string, string>();

/**
 * Uploads a picture for a frame. The frame changes only when all the bytes have arrived, as a
 * single undo step, so a failed upload never costs it the picture it has.
 */
export function uploadToFrame(input: {
  store: BoardStore;
  frameId: string;
  file: File;
  projectId: string;
  boardId: string;
  onInserted?: (() => void) | undefined;
}) {
  const { store, frameId } = input;
  const key = startUpload({
    file: input.file,
    projectId: input.projectId,
    boardId: input.boardId,
    onAsset: () => {},
    onComplete: (assetId) => {
      if (waiting.get(frameId) === key) waiting.delete(frameId);
      const frame = store.getSnapshot().byId.get(frameId);
      if (frame?.type !== 'frame' || frame.locked) return;
      store.undo.stopCapturing();
      updateElement(store.doc, frameId, { assetId, source: undefined }, LOCAL);
      store.undo.stopCapturing();
      input.onInserted?.();
    },
  });
  waiting.set(frameId, key);
}

/** Progress of the picture on its way to a frame or, if it failed, the error and Retry. */
export function FrameUploadState({ frameId }: { frameId: string }) {
  const { t } = useTranslation();
  const uploads = useUploads();
  const key = waiting.get(frameId);
  const item = key ? uploads.find((i) => i.key === key) : undefined;
  if (!key || !item || item.state === 'done' || item.state === 'cancelled') return null;
  if (item.state === 'failed')
    return (
      <div className="frame-upload" role="alert">
        <span className="frame-upload__label">{t('film.frame.uploadFailed')}</span>
        <button
          type="button"
          className="ink-btn ink-btn--secondary frame-upload__retry"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            retryUpload(key);
          }}
        >
          {t('film.frame.retry')}
        </button>
      </div>
    );
  const percent = item.size ? (item.sent / item.size) * 100 : 0;
  return (
    <span className="card__progress" role="progressbar" aria-valuenow={Math.round(percent)}>
      <span style={{ width: `${percent}%` }} />
    </span>
  );
}
