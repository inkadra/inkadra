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

export const BoardNotice = z.discriminatedUnion('type', [
  AccessNotice,
  CommentsNotice,
  ReviewNotice,
  RestoredNotice,
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
