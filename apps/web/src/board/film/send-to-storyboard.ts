// SPDX-License-Identifier: AGPL-3.0-only
import { HocuspocusProvider } from '@hocuspocus/provider';
import { addFrame, type FrameElement, listElements } from '@inkadra/canvas-core';
import {
  boardDocName,
  CURRENT_SCHEMA_VERSION,
  type Element,
  getSchemaVersion,
  hiddenFromGuests,
} from '@inkadra/doc-schema';
import * as Y from 'yjs';
import { collabUrl } from '../connection.ts';
import type { MediaReference } from './MoodboardView.tsx';

type FrameFields = Pick<FrameElement, 'assetId' | 'source' | 'action' | 'guestHidden'>;

const SEND_TIMEOUT_MS = 15_000;
/** Frames beside each other, so they don't stack if the board shows them on the canvas. */
const FRAME_STEP = 340;

/**
 * The frames of these references. A picture hidden from guests stays hidden as a frame, and the
 * reference stays where it is: this copies, unlike moving a card into a frame.
 * shortcut: a frame has no crop, so it shows the whole picture; the reference keeps its crop.
 */
export function framesFromReferences(
  references: readonly MediaReference[],
  lookup: (id: string) => Element | undefined,
): FrameFields[] {
  return references.flatMap((el) => {
    const assetId = el.type === 'image' ? el.assetId : el.imageAssetId;
    if (!assetId) return [];
    const note = el.type === 'image' ? el.caption : el.title;
    return [
      {
        assetId,
        ...(el.type === 'image' && el.source ? { source: el.source } : {}),
        ...(note ? { action: note } : {}),
        ...(hiddenFromGuests(el.id, lookup) ? { guestHidden: true } : {}),
      },
    ];
  });
}

/** Adds frames outside any scene ("Senza scena"), below what the board already has. */
export function placeFrames(
  doc: Y.Doc,
  frames: readonly FrameFields[],
  opts: { userId: string; origin?: unknown },
): void {
  const y =
    listElements(doc)
      .filter((el) => !el.parent)
      .reduce((max, el) => Math.max(max, el.y + (el.h ?? 200)), 0) + 40;
  doc.transact(() => {
    frames.forEach((frame, i) => {
      addFrame(doc, null, null, { ...frame, x: i * FRAME_STEP, y }, opts);
    });
  }, opts.origin);
}

/**
 * Adds frames to another board of the project over a connection of its own, and resolves only
 * once the server has confirmed them. Refused without edit rights on that board.
 */
export function addFramesToBoard(
  boardId: string,
  frames: readonly FrameFields[],
  userId: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const doc = new Y.Doc();
    let readOnly = false;
    let written = false;
    const finish = (error?: Error) => {
      clearTimeout(timer);
      provider.destroy();
      doc.destroy();
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(() => finish(new Error('Timed out')), SEND_TIMEOUT_MS);
    const provider = new HocuspocusProvider({
      url: collabUrl(),
      name: boardDocName(boardId),
      document: doc,
      onAuthenticated: ({ scope }) => {
        readOnly = scope === 'readonly';
      },
      onAuthenticationFailed: () => finish(new Error('Refused')),
      onSynced: () => {
        if (written) return;
        if (readOnly || getSchemaVersion(doc) > CURRENT_SCHEMA_VERSION) {
          finish(new Error('Read-only'));
          return;
        }
        written = true;
        placeFrames(doc, frames, { userId });
      },
    });
    provider.on('unsyncedChanges', ({ number }: { number: number }) => {
      if (written && number === 0) finish();
    });
  });
}
