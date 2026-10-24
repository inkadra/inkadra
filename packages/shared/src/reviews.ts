// SPDX-License-Identifier: MPL-2.0
import { Author, ElementRef, GuestAuthor, ListLimit } from './comments.ts';
import { Cursor, Id, Timestamp, z } from './common.ts';

/**
 * Review status of a card: whether the client or the director approved it. Kept in Postgres
 * with its history, not in the board document (docs/decisions/0013), so guests can approve
 * through their link, editors cannot rewrite an approval by editing the document, and every
 * change says who made it and when. It is separate from the production status of a storyboard
 * frame (`status` in the document: draft, todo, ready, shot, retake).
 *
 * A card has one status set by the team and, for each share link, the latest decision of a
 * guest of that link. Decisions of one link are never shown to guests of another: a guest sees
 * the more recent of the team's status and their own link's decision; the team sees the most
 * recent of all, with who made it. A withdrawn guest decision shows nothing, so the team's
 * status shows through.
 */
export const ReviewStatus = z.enum(['none', 'in_review', 'approved', 'changes_requested']).openapi({
  description:
    '`none`: never reviewed, or the review was cleared. `in_review`: waiting for a decision. ' +
    '`approved` and `changes_requested`: the decision. Open in answers: clients show a status ' +
    'they do not know like `in_review`, without actions.',
});
export type ReviewStatus = z.infer<typeof ReviewStatus>;

/**
 * The review status of a card as the team sees it: the most recent change among the team's
 * status and the decisions of every link (a withdrawn guest decision does not count).
 */
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
 * The review status of a card as a guest sees it (decision 0013): the more recent of the
 * team's status and the latest decision of a guest of the same link. Decisions made on other
 * links are never shown, not even without a name: their guests see the team's status instead.
 * Who decided is given by name only, and the note only when a guest of this link wrote it.
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
  .openapi('GuestElementReview', {
    description:
      'The more recent of the team’s status and the decision of a guest of this link. ' +
      'Decisions made on other links are never shown.',
  });
export type GuestElementReview = z.infer<typeof GuestElementReview>;

/** Every card of a board with a status other than `none`. */
export const BoardReviews = z.object({ items: z.array(ElementReview) }).openapi('BoardReviews');
export type BoardReviews = z.infer<typeof BoardReviews>;

/** What the team sets: the team's status of the card, any value. */
export const SetElementReview = z
  .object({
    status: ReviewStatus,
    note: z.string().trim().max(500).optional(),
  })
  .openapi('SetElementReview');
export type SetElementReview = z.infer<typeof SetElementReview>;

/**
 * What a guest of a `guest_approve` link sets: the decision of their link. A guest decides,
 * never asks for review, so `in_review` is a 400. `none` withdraws a decision and is allowed
 * only when the decision this guest currently sees on the card was made by them (403
 * otherwise): a guest never clears the team's status nor a decision of another guest.
 */
export const GuestSetElementReview = z
  .object({
    status: z.enum(['approved', 'changes_requested', 'none']).openapi({
      description:
        '`approved` or `changes_requested`: the decision of this link, replacing the one of ' +
        'any guest of the link. `none`: withdraw your own decision, only when the status you ' +
        'see was set by you (`changedBy.isYou`), otherwise 403; the team’s status shows ' +
        'through again. Other values are a 400.',
    }),
    note: z.string().trim().max(500).optional().openapi({
      description: 'Shown to the team and to guests of this link. Not kept with `none`.',
    }),
  })
  .openapi('GuestSetElementReview');
export type GuestSetElementReview = z.infer<typeof GuestSetElementReview>;

/** One change in the history of a card's review, newest first in lists. */
export const ElementReviewEvent = ElementReview.extend({
  id: Id,
  previous: ReviewStatus.openapi({
    description:
      'The status of the same source before the change: the team’s status, or the decision of ' +
      'the link of the guest who made it.',
  }),
}).openapi('ElementReviewEvent', {
  description:
    'One change of the team’s status or of the decision of one link; `changedBy` says which ' +
    '(a guest carries their `shareLinkId`).',
});
export type ElementReviewEvent = z.infer<typeof ElementReviewEvent>;

export const ReviewHistoryQuery = z
  .object({ cursor: Cursor.optional(), limit: ListLimit })
  .openapi('ReviewHistoryQuery');
export type ReviewHistoryQuery = z.infer<typeof ReviewHistoryQuery>;
