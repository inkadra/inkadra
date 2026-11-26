// SPDX-License-Identifier: MPL-2.0
import { ElementRef } from './comments.ts';
import { Id, z } from './common.ts';

/**
 * Cards that move to another board of the project (decision 0140, scenes moving into a
 * storyboard) take along what the server keeps by board and card: comments with their replies,
 * reactions and read marks, reactions on the card, review statuses and their history, guest
 * picks, notifications about the card, and the shooting-day blocks that point at it. Nothing is
 * copied or deleted: the rows are re-keyed to the other board in one transaction. Afterwards the
 * source board refuses new comments, reactions, reviews and picks about those cards (404).
 */

/** Capability on `GET /instance/version` of servers that answer `POST /boards/{id}/element-data/move`. */
export const ELEMENT_DATA_MOVE_CAPABILITY = 'element-data-move';

/** At most this many cards in one move: a storyboard's scenes with all their frames. */
export const ELEMENT_DATA_MOVE_MAX = 5000;

export const MoveElementData = z
  .object({
    toBoardId: Id.openapi({
      description:
        'The board the cards are on now (copied there with the same ids). Another board of ' +
        'the same project, not in the trash.',
    }),
    elementIds: z
      .array(ElementRef)
      .min(1)
      .max(ELEMENT_DATA_MOVE_MAX)
      .refine((ids) => new Set(ids).size === ids.length, { message: 'Ids must be unique.' })
      .openapi({
        description: `1 to ${ELEMENT_DATA_MOVE_MAX} distinct card ids, children (frames) included.`,
      }),
  })
  .strict()
  .openapi('MoveElementData');
export type MoveElementData = z.infer<typeof MoveElementData>;

const Moved = z.int().min(0);

/** How many rows followed the cards; all zero when there was nothing (left) to move. */
export const ElementDataMoved = z
  .object({
    comments: Moved.openapi({ description: 'Comments and replies.' }),
    reactions: Moved.openapi({ description: 'Reactions on the cards themselves.' }),
    reviews: Moved.openapi({ description: 'Review statuses (team and guest links).' }),
    reviewEvents: Moved.openapi({ description: 'Entries of the review history.' }),
    picks: Moved.openapi({ description: 'Guest picks and stars.' }),
    notifications: Moved,
    shootingDays: Moved.openapi({
      description:
        'Shooting days with a block that pointed at one of the cards. Days of boards in the ' +
        'trash are left as they are.',
    }),
    guestsOutOfReach: z.array(ElementRef).openapi({
      description:
        'Cards whose moved comments, decisions or picks come from guests of an active link that ' +
        'does not reach the other board: those guests no longer see them.',
    }),
  })
  .openapi('ElementDataMoved');
export type ElementDataMoved = z.infer<typeof ElementDataMoved>;
