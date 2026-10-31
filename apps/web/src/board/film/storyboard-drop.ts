import { addFrame, addScene, updateElement } from '@inkadra/canvas-core';
import type * as Y from 'yjs';
import type { BoardStore } from '../store.ts';
import { LOCAL } from '../store.ts';

/**
 * Where image files dropped on the storyboard go (#299): onto a frame's picture, into a scene
 * before the frame at `index`, or, with no scene at all, into a new one.
 */
export type PlacedTarget =
  | { kind: 'replace'; frameId: string; sceneId: string | null; index: number }
  | { kind: 'insert'; sceneId: string | null; index: number };
export type DropTarget = PlacedTarget | { kind: 'new-scene' };

/** One image, one change to the document. `index` counts among the frames of the scene. */
export type DropStep =
  | { op: 'replace'; frameId: string; file: File }
  | { op: 'add'; sceneId: string | null; index: number; file: File };

/** Whether a drag carries files from the desktop, not a frame being moved. */
export const isFileDrag = (types: readonly string[]) => types.includes('Files');

/** Images are the files a frame can show; anything else is left out with a toast. */
export function splitDropped(files: readonly File[]): { images: File[]; skipped: File[] } {
  const images: File[] = [];
  const skipped: File[] = [];
  for (const file of files) (file.type.startsWith('image/') ? images : skipped).push(file);
  return { images, skipped };
}

/**
 * The drop as changes to the storyboard, in the order the files were dropped. On a frame the
 * first image takes its picture and the others become frames right after it; elsewhere each
 * image is a new frame, one after the other from the drop position.
 */
export function planDrop(target: PlacedTarget, images: readonly File[]): DropStep[] {
  if (target.kind === 'replace') {
    return images.map((file, i) =>
      i === 0
        ? { op: 'replace', frameId: target.frameId, file }
        : { op: 'add', sceneId: target.sceneId, index: target.index + i, file },
    );
  }
  const { sceneId, index } = target;
  return images.map((file, i) => ({ op: 'add', sceneId, index: index + i, file }));
}

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Index a drop at (x, y) inserts at among the frames of a grid, given their boxes in reading
 * order: before the first frame that is below the pointer, or on its row and half way past it.
 * A pointer after the last frame, or in the "New frame" tile, appends.
 */
export function insertIndexAt(boxes: readonly Box[], x: number, y: number): number {
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    if (!b) continue;
    if (y < b.top) return i;
    if (y <= b.bottom && x < (b.left + b.right) / 2) return i;
  }
  return boxes.length;
}

export interface DropHooks {
  /** Starts the upload of a file; `onAsset` fires once the server has created its asset. */
  upload: (
    file: File,
    hooks: { onAsset: (assetId: string) => void; onFailed: (assetId: string | null) => void },
  ) => void;
  userId: string;
  /** An upload failed before the server knew the file. */
  onFailed: (file: File) => void;
}

/**
 * Puts the images on the storyboard at once, frames and all, and fills each picture in as its
 * asset is created, so the layout does not move while the files are on their way. The new
 * frames are one undo step; so is each picture.
 */
export function applyDrop(
  store: BoardStore,
  target: DropTarget,
  images: readonly File[],
  { upload, userId, onFailed }: DropHooks,
): string[] {
  if (images.length === 0) return [];
  const opts = { userId, origin: LOCAL };
  const doc: Y.Doc = store.doc;
  const ids: string[] = [];
  const jobs: Array<{ frameId: string; file: File }> = [];
  store.undo.stopCapturing();
  doc.transact(() => {
    const resolved: PlacedTarget =
      target.kind === 'new-scene'
        ? { kind: 'insert', sceneId: addScene(doc, {}, opts).id, index: 0 }
        : target;
    for (const step of planDrop(resolved, images)) {
      if (step.op === 'replace') {
        jobs.push({ frameId: step.frameId, file: step.file });
        ids.push(step.frameId);
        continue;
      }
      // Loose frames have no order to insert in: they go to the end.
      const frame = addFrame(doc, step.sceneId, step.sceneId ? step.index : null, {}, opts);
      jobs.push({ frameId: frame.id, file: step.file });
      ids.push(frame.id);
    }
  }, LOCAL);
  for (const { frameId, file } of jobs) {
    upload(file, {
      // Same as "Upload an image" in the frame panel: the picture is replaced and the video
      // source it may have been grabbed from is dropped with it.
      onAsset: (assetId) => {
        store.undo.stopCapturing();
        updateElement(doc, frameId, { assetId, source: undefined }, LOCAL);
      },
      onFailed: (assetId) => {
        if (!assetId) onFailed(file);
      },
    });
  }
  return ids;
}
