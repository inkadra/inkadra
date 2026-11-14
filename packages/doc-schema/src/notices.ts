// SPDX-License-Identifier: MPL-2.0
import { z } from 'zod';
import { ElementId } from './elements.ts';

/**
 * Stateless messages the collaboration server sends to the clients of a board document
 * (Hocuspocus `stateless`, JSON text). They only say that something changed: clients fetch
 * the new state over the REST API. Clients ignore types they do not know.
 */

/** The role of the connection changed between editing and reading (decision 0011). */
export const AccessNotice = z.object({ type: z.literal('access'), readOnly: z.boolean() });

/** A comment thread of the board changed (created, replied to, edited, resolved, deleted). */
export const CommentsNotice = z.object({
  type: z.literal('comments'),
  elementId: ElementId.nullable().describe('Card of the thread; null for the board.'),
  threadId: z.uuid(),
});

/** The review status of a card changed. */
export const ReviewNotice = z.object({ type: z.literal('review'), elementId: ElementId });

/** The board was brought back to a saved version; the content arrives as a normal update. */
export const RestoredNotice = z.object({ type: z.literal('restored'), versionId: z.uuid() });

/**
 * A saved version of the board was created, renamed or deleted, so open version lists fetch
 * again. Clients that do not know this type ignore it, as any other (see readBoardNotice).
 */
export const VersionsNotice = z.object({ type: z.literal('versions'), versionId: z.uuid() });

/**
 * Edits of this connection were not applied (decision 0102). `schema`: its client is older than
 * the oldest schema that may write the board, `schemaVersion`, so it keeps the edits and asks
 * for an update of the app; `role`: it may only read; `frozen`: the board is over its caps.
 */
export const WriteRefusedNotice = z.object({
  type: z.literal('writeRefused'),
  reason: z.enum(['schema', 'role', 'frozen']),
  schemaVersion: z.int().min(1).optional(),
});

/**
 * The playable copies of a file shown on the board are being made again (a regeneration from
 * Settings → Video), so its cards fetch the file again and follow it until the copies are
 * ready. Servers send it only with the `asset-notices` capability; older clients ignore it.
 */
export const AssetNotice = z.object({ type: z.literal('asset'), assetId: z.uuid() });

export const BoardNotice = z.discriminatedUnion('type', [
  AccessNotice,
  WriteRefusedNotice,
  CommentsNotice,
  ReviewNotice,
  RestoredNotice,
  VersionsNotice,
  AssetNotice,
]);
export type BoardNotice = z.infer<typeof BoardNotice>;

/** Parses a stateless payload; null for anything malformed or of an unknown type. */
export function readBoardNotice(payload: string): BoardNotice | null {
  let value: unknown;
  try {
    value = JSON.parse(payload);
  } catch {
    return null;
  }
  const parsed = BoardNotice.safeParse(value);
  return parsed.success ? parsed.data : null;
}
