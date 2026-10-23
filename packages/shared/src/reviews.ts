// SPDX-License-Identifier: MPL-2.0
import { Author, ElementRef, GuestAuthor, ListLimit } from './comments.ts';
import { Cursor, Id, Timestamp, z } from './common.ts';

/**
 * Review status of a card: whether the client or the director approved it. Kept in Postgres
 * with its history, not in the board document (docs/decisions/0013), so guests can approve
 * through their link, editors cannot rewrite an approval by editing the document, and every
 * change says who made it and when. It is separate from the production status of a storyboard
 * frame (`status` in the document: draft, todo, ready, shot, retake).
 */
export const ReviewStatus = z.enum(['none', 'in_review', 'approved', 'changes_requested']).openapi({
  description:
    '`none`: never reviewed, or the review was cleared. `in_review`: waiting for a decision. ' +
    '`approved` and `changes_requested`: the decision. Open in answers: clients show a status ' +
    'they do not know like `in_review`, without actions.',
});
export type ReviewStatus = z.infer<typeof ReviewStatus>;

export const ElementReview = z
  .object({
    elementId: ElementRef,
    status: ReviewStatus,
    note: z.string().nullable().openapi({ description: 'Short reason given with the change.' }),
    changedBy: Author,
    changedAt: Timestamp,
  })
  .openapi('ElementReview');
export type ElementReview = z.infer<typeof ElementReview>;

/**
 * The review status of a card as guests see it, on every link (decision 0013): who decided by
 * name only, and the note only when a guest of the same link wrote it.
 */
export const GuestElementReview = z
  .object({
    elementId: ElementRef,
    status: ReviewStatus,
    note: z.string().nullable().openapi({
      description: 'Only when a guest of this link made the change; null otherwise.',
    }),
    changedBy: GuestAuthor,
    changedAt: Timestamp,
  })
  .openapi('GuestElementReview');
export type GuestElementReview = z.infer<typeof GuestElementReview>;

/** Every card of a board with a status other than `none`. */
export const BoardReviews = z.object({ items: z.array(ElementReview) }).openapi('BoardReviews');
export type BoardReviews = z.infer<typeof BoardReviews>;

export const SetElementReview = z
  .object({
    status: ReviewStatus,
    note: z.string().trim().max(500).optional(),
  })
  .openapi('SetElementReview');
export type SetElementReview = z.infer<typeof SetElementReview>;

/** One change in the history of a card's review, newest first in lists. */
export const ElementReviewEvent = ElementReview.extend({
  id: Id,
  previous: ReviewStatus,
}).openapi('ElementReviewEvent');
export type ElementReviewEvent = z.infer<typeof ElementReviewEvent>;

export const ReviewHistoryQuery = z
  .object({ cursor: Cursor.optional(), limit: ListLimit })
  .openapi('ReviewHistoryQuery');
export type ReviewHistoryQuery = z.infer<typeof ReviewHistoryQuery>;
