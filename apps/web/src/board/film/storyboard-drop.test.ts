import { addFrame, addScene, frameLabels, storyboardOf, updateElement } from '@inkadra/canvas-core';
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { BoardStore } from '../store.ts';
import {
  applyDrop,
  type DropHooks,
  insertIndexAt,
  isFileDrag,
  planDrop,
  splitDropped,
} from './storyboard-drop.ts';

const file = (name: string, type = 'image/png') => new File(['x'], name, { type });

/** A board with scene 1 holding two frames (1A, 1B). */
function setup() {
  const doc = new Y.Doc();
  const store = new BoardStore(doc);
  const scene = addScene(doc, { number: '1' }, { userId: null });
  const a = addFrame(doc, scene.id, null, {}, { userId: null });
  const b = addFrame(doc, scene.id, null, {}, { userId: null });
  return { doc, store, scene, a, b };
}

/** The frames of the board by label, with their picture. */
function board(store: BoardStore) {
  const groups = storyboardOf([...store.getSnapshot().byId.values()]);
  const labels = frameLabels(groups);
  return groups.flatMap((g) =>
    g.frames.map((f) => ({ label: labels.get(f.id), assetId: f.assetId, id: f.id })),
  );
}

describe('splitDropped', () => {
  it('keeps the images in the order dropped and sets the others aside', () => {
    const { images, skipped } = splitDropped([
      file('a.png'),
      file('notes.txt', 'text/plain'),
      file('b.webp', 'image/webp'),
      file('clip.mp4', 'video/mp4'),
    ]);
    expect(images.map((f) => f.name)).toEqual(['a.png', 'b.webp']);
    expect(skipped.map((f) => f.name)).toEqual(['notes.txt', 'clip.mp4']);
  });
});

describe('isFileDrag', () => {
  it('tells files from the desktop apart from a frame being moved', () => {
    expect(isFileDrag(['Files'])).toBe(true);
    expect(isFileDrag(['application/x-inkadra-frame'])).toBe(false);
  });
});

describe('insertIndexAt', () => {
  // Two rows of three frames, 100 wide and 80 high, with 16 between them.
  const boxes = [0, 1, 2, 3, 4, 5].map((i) => {
    const left = (i % 3) * 116;
    const top = Math.floor(i / 3) * 96;
    return { left, top, right: left + 100, bottom: top + 80 };
  });

  it('inserts before the frame whose left half is hovered', () => {
    expect(insertIndexAt(boxes, 20, 40)).toBe(0);
    expect(insertIndexAt(boxes, 116 + 10, 40)).toBe(1);
  });
  it('inserts after the frame whose right half is hovered', () => {
    expect(insertIndexAt(boxes, 90, 40)).toBe(1);
  });
  it('treats the gap between two frames as the place between them', () => {
    expect(insertIndexAt(boxes, 108, 40)).toBe(1);
  });
  it('ends a row at the start of the next one', () => {
    expect(insertIndexAt(boxes, 340, 40)).toBe(3);
    expect(insertIndexAt(boxes, 50, 88)).toBe(3);
  });
  it('appends after the last frame and in an empty scene', () => {
    expect(insertIndexAt(boxes, 300, 130)).toBe(6);
    expect(insertIndexAt([], 10, 10)).toBe(0);
  });
});

describe('planDrop', () => {
  const [one, two, three] = [file('1.png'), file('2.png'), file('3.png')];
  it('makes one frame per image, in order, from the drop position', () => {
    const steps = planDrop({ kind: 'insert', sceneId: 's', index: 1 }, [
      one as File,
      two as File,
      three as File,
    ]);
    expect(steps.map((s) => (s.op === 'add' ? [s.sceneId, s.index, s.file.name] : s.op))).toEqual([
      ['s', 1, '1.png'],
      ['s', 2, '2.png'],
      ['s', 3, '3.png'],
    ]);
  });
  it('replaces the picture of the frame with the first image and adds the rest after it', () => {
    const steps = planDrop({ kind: 'replace', frameId: 'f', sceneId: 's', index: 4 }, [
      one as File,
      two as File,
      three as File,
    ]);
    expect(steps).toEqual([
      { op: 'replace', frameId: 'f', file: one },
      { op: 'add', sceneId: 's', index: 5, file: two },
      { op: 'add', sceneId: 's', index: 6, file: three },
    ]);
  });
  it('plans nothing without images', () => {
    expect(planDrop({ kind: 'insert', sceneId: 's', index: 0 }, [])).toEqual([]);
  });
});

describe('applyDrop', () => {
  function hooks() {
    const started: Array<{
      file: File;
      onAsset: (id: string) => void;
      onFailed: (id: string | null) => void;
    }> = [];
    const failed: string[] = [];
    const h: DropHooks = {
      userId: 'u',
      upload: (f, cb) => started.push({ file: f, ...cb }),
      onFailed: (f) => failed.push(f.name),
    };
    return { h, started, failed };
  }

  it('drops 3 images between 1A and 1B as 3 frames, numbered and filled in order', () => {
    const { store, scene } = setup();
    const { h, started } = hooks();
    const files = ['x.png', 'y.png', 'z.png'].map((n) => file(n));
    const ids = applyDrop(store, { kind: 'insert', sceneId: scene.id, index: 1 }, files, h);
    expect(ids).toHaveLength(3);
    // The frames are there at once, without pictures: the layout does not move later.
    expect(board(store).map((f) => f.label)).toEqual(['1A', '1B', '1C', '1D', '1E']);
    expect(board(store).map((f) => f.assetId)).toEqual([undefined, undefined, undefined, undefined, undefined]);
    expect(started.map((s) => s.file.name)).toEqual(['x.png', 'y.png', 'z.png']);
    // Assets arrive in any order; each lands in the frame of its own file.
    started[2]?.onAsset('asset-z');
    started[0]?.onAsset('asset-x');
    started[1]?.onAsset('asset-y');
    expect(board(store).map((f) => f.assetId)).toEqual([
      undefined,
      'asset-x',
      'asset-y',
      'asset-z',
      undefined,
    ]);
    store.destroy();
  });

  it('replaces the picture of a frame and drops the video source with it, with undo', () => {
    const { doc, store, a } = setup();
    updateElement(doc, a.id, { assetId: 'old' });
    const { h, started } = hooks();
    const before = board(store);
    applyDrop(
      store,
      { kind: 'replace', frameId: a.id, sceneId: a.parent, index: 0 },
      [file('new.png')],
      h,
    );
    // Nothing moves before the asset exists.
    expect(board(store)).toEqual(before);
    started[0]?.onAsset('new-asset');
    expect(board(store).map((f) => f.assetId)).toEqual(['new-asset', undefined]);
    store.undo.undo();
    expect(board(store).map((f) => f.assetId)).toEqual(['old', undefined]);
    store.destroy();
  });

  it('adds the images to a new scene when the storyboard has none', () => {
    const doc = new Y.Doc();
    const store = new BoardStore(doc);
    const { h } = hooks();
    applyDrop(store, { kind: 'new-scene' }, [file('a.png'), file('b.png')], h);
    const groups = storyboardOf([...store.getSnapshot().byId.values()]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.scene).not.toBeNull();
    expect(groups[0]?.frames).toHaveLength(2);
    store.destroy();
  });

  it('reports an upload that failed before the server knew the file, not one it can resume', () => {
    const { store, scene } = setup();
    const { h, started, failed } = hooks();
    applyDrop(store, { kind: 'insert', sceneId: scene.id, index: 0 }, [file('a.png'), file('b.png')], h);
    started[0]?.onFailed(null);
    started[1]?.onFailed('asset-b');
    expect(failed).toEqual(['a.png']);
    store.destroy();
  });

  it('does nothing without images', () => {
    const { doc, store, scene } = setup();
    const before = Y.encodeStateAsUpdate(doc);
    const upload = vi.fn();
    applyDrop(store, { kind: 'insert', sceneId: scene.id, index: 0 }, [], {
      userId: 'u',
      upload,
      onFailed: () => {},
    });
    expect(upload).not.toHaveBeenCalled();
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
    store.destroy();
  });
});
