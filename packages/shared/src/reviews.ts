// SPDX-License-Identifier: MPL-2.0
import { Author, ElementRef } from './comments.ts';
import { Timestamp, z } from './common.ts';

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
    '`approved` and `changes_requested`: the decision.',
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
  previous: ReviewStatus,
}).openapi('ElementReviewEvent');
export type ElementReviewEvent = z.infer<typeof ElementReviewEvent>;
