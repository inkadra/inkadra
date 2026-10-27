import { duplicateElements, updateElement } from '@inkadra/canvas-core';
import { FRAME_STATUSES } from '@inkadra/doc-schema';
import type { TFunction } from 'i18next';
import { type BoardStore, LOCAL } from '../board/store.ts';
import type { PaletteAction } from './actions.ts';

type FrameStatus = (typeof FRAME_STATUSES)[number];

/** Same status mutation for the frame inspector, its "ready" button and the command palette. */
export function frameStatusActions(store: BoardStore, id: string, t: TFunction): PaletteAction[] {
  return FRAME_STATUSES.map((status) => ({
    id: `frame-status-${status}`,
    label: `${t('film.frame.status')}: ${t(`film.status.${status}`)}`,
    run: () => setFrameStatus(store, id, status),
  }));
}
export function setFrameStatus(store: BoardStore, id: string, status: FrameStatus | undefined) {
  store.undo.stopCapturing();
  updateElement(store.doc, id, { status }, LOCAL);
  store.undo.stopCapturing();
}

/** Copies the elements 24px down-right as one undo step and returns the new ids. */
export function duplicateInStore(
  store: BoardStore,
  ids: Iterable<string>,
  userId: string | null,
): string[] {
  store.undo.stopCapturing();
  const copies = duplicateElements(
    store.doc,
    [...ids],
    { x: 24, y: 24 },
    { userId, origin: LOCAL },
  );
  store.undo.stopCapturing();
  return copies;
}

/** The open frame panel owns the frame commands; viewers and guests get none. */
export function framePanelActions({
  readOnly,
  store,
  frameId,
  duplicate,
  t,
}: {
  readOnly: boolean;
  store: BoardStore;
  frameId: string;
  duplicate: () => void;
  t: TFunction;
}): PaletteAction[] {
  if (readOnly) return [];
  return [
    ...frameStatusActions(store, frameId, t),
    { id: 'duplicate', label: t('film.frame.duplicate'), run: duplicate },
  ];
}

/**
 * Canvas actions for editors. While the frame panel is open it owns the frame commands
 * (status, duplicate), so the canvas leaves them out instead of registering the same ids.
 */
export function canvasActions({
  readOnly,
  guest,
  framePanelOpen,
  selection,
  selectedFrame,
  add,
  duplicate,
  store,
  t,
  duplicateHint,
}: {
  readOnly: boolean;
  guest: boolean;
  framePanelOpen: boolean;
  selection: ReadonlySet<string>;
  /** The id of the only selected element when it is a frame. */
  selectedFrame: string | null;
  add: PaletteAction[];
  duplicate: () => void;
  store: BoardStore;
  t: TFunction;
  duplicateHint: string;
}): PaletteAction[] {
  if (readOnly || guest) return [];
  if (framePanelOpen) return add;
  return [
    ...add,
    ...(selectedFrame ? frameStatusActions(store, selectedFrame, t) : []),
    ...(selection.size
      ? [
          {
            id: 'duplicate',
            label: t('board.menu.duplicate'),
            hint: duplicateHint,
            run: duplicate,
          },
        ]
      : []),
  ];
}
