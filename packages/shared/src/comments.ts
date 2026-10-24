// SPDX-License-Identifier: MPL-2.0
import { Cursor, Id, Timestamp, z } from './common.ts';
import { UserSummary } from './users.ts';

/**
 * Comments on a board or on one of its cards (docs/decisions/0013). They live in Postgres, not
 * in the board document: commenters and guests cannot write the document, and comments need
 * authors, edits and notifications. Open boards learn about changes through a stateless
 * message on the collab WebSocket (BoardNotice in @inkadra/doc-schema).
 *
 * Guests of share links get their own shapes (GuestComment, GuestAuthor): no user ids, no
 * avatars, no internal fields, and mentions already written as names.
 */

/** Element id of the board document (21 url-safe characters, see @inkadra/doc-schema). */
export const ElementRef = z
  .string()
  .regex(/^[A-Za-z0-9_-]{8,64}$/)
  .openapi({ description: 'Element id in the board document.', example: 'V1StGXR8_Z5jdHi6B-myT' });

export const MAX_COMMENT_LENGTH = 5000;
export const MAX_MENTIONS = 20;
/** Replies sent inline with each thread; the rest through the replies endpoint. */
export const INLINE_REPLIES = 50;

/** Page size of the review and sharing lists: 30 by default, at most 100. */
export const ListLimit = z.coerce.number().int().min(1).max(100).default(30);

/**
 * Who wrote a comment or changed a review, as people with a role on the board see it: a
 * person with an account, or a guest of a share link, known only by the name they typed.
 */
export const Author = z
  .discriminatedUnion('kind', [
    z.object({ kind: z.literal('user'), user: UserSummary }),
    z.object({
      kind: z.literal('guest'),
      guestId: Id,
      name: z.string().min(1).max(80),
      shareLinkId: Id,
    }),
    z.object({ kind: z.literal('deleted') }).openapi({
      description: 'The account was deleted; the comment stays without an author.',
    }),
  ])
  .openapi('Author', {
    description:
      'Open union: clients show a `kind` they do not know like `deleted` (no author shown).',
  });
export type Author = z.infer<typeof Author>;

/**
 * Who wrote a comment or changed a review, as a guest of a share link sees it: a name and
 * nothing that identifies an account.
 */
export const GuestAuthor = z
  .object({
    kind: z.enum(['team', 'guest', 'deleted']).openapi({
      description:
        '`team`: someone with an account. `guest`: a guest of a share link. `deleted`: the ' +
        'account was deleted. Open: clients show values they do not know like `deleted`.',
    }),
    name: z
      .string()
      .nullable()
      .openapi({
        description:
          'Current name of the account, or the name a guest of the same link typed. Null for ' +
          '`deleted`. Guests of other links never appear in what a guest receives.',
      }),
    isYou: z.boolean().openapi({ description: 'The guest asking wrote it.' }),
  })
  .openapi('GuestAuthor');
export type GuestAuthor = z.infer<typeof GuestAuthor>;

export const CommentVisibility = z.enum(['team', 'everyone']).openapi({
  description:
    '`team` (default): people with a role on the board. `everyone`: also the guests of share ' +
    'links that may read comments, limited to one link by `shareLinkId`. Threads written by ' +
    'guests are always `everyone` and belong to the guest’s link. Replies take the visibility ' +
    'and the link of their thread.',
});
export type CommentVisibility = z.infer<typeof CommentVisibility>;

/** A point on the card, relative to its picture or box (0 to 1), for comments on a detail. */
export const CommentPin = z
  .object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })
  .openapi('CommentPin');
export type CommentPin = z.infer<typeof CommentPin>;

const Body = z
  .string()
  .trim()
  .min(1)
  .max(MAX_COMMENT_LENGTH)
  .openapi({
    description:
      'Plain text. A mention is written `@{<userId>}` and shown with the current name of the ' +
      'person (see `mentions`); the server keeps only mentions of people who can read the ' +
      'board.',
    example: 'Mi piace, ma @{0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10} può schiarire il cielo?',
  });

const GuestBody = z.string().trim().min(1).max(MAX_COMMENT_LENGTH).openapi({
  description: 'Plain text. Guests cannot mention: `@{…}` is kept as typed and is no mention.',
});

const commentFields = {
  id: Id,
  boardId: Id,
  elementId: ElementRef.nullable().openapi({
    description:
      'Card the comment is about; null for a comment on the whole board. The card may since ' +
      'have been removed from the document: clients show such threads as about a removed card.',
  }),
  parentId: Id.nullable().openapi({
    description: 'Thread the comment replies to; null for the first comment of a thread.',
  }),
  pin: CommentPin.nullable(),
  createdAt: Timestamp,
  editedAt: Timestamp.nullable(),
  deletedAt: Timestamp.nullable().openapi({
    description:
      'Set when a thread start is deleted while it has replies: it stays as a placeholder.',
  }),
};

export const Comment = z
  .object({
    ...commentFields,
    author: Author,
    body: z.string().openapi({ description: 'Empty once deleted.' }),
    mentions: z.array(UserSummary).openapi({
      description:
        'People mentioned in `body`. Clients render `@{id}` as a mention only for ids listed ' +
        'here and show any other `@{…}` as typed.',
    }),
    visibility: CommentVisibility,
    shareLinkId: Id.nullable().openapi({
      description:
        'With `everyone`: the only link whose guests see the thread (a thread written by a ' +
        'guest, or one the team limited to a link). Null: every link that may read comments, ' +
        'or a `team` thread. A reply carries the link of the guest who wrote it, or null.',
    }),
    canEdit: z.boolean().openapi({ description: 'The caller wrote it.' }),
    canDelete: z.boolean().openapi({ description: 'The caller wrote it, or is editor or owner.' }),
  })
  .openapi('Comment');
export type Comment = z.infer<typeof Comment>;

const threadFields = {
  resolvedAt: Timestamp.nullable(),
  replyCount: z.int().min(0).openapi({ description: 'Replies the caller can see.' }),
};
const repliesDescription =
  `The latest ${INLINE_REPLIES} replies, oldest first; replies have no replies. When ` +
  '`replyCount` is larger, the earlier ones come from the replies endpoint.';

export const CommentThread = Comment.extend({
  ...threadFields,
  resolvedBy: Author.nullable(),
  replies: z.array(Comment).max(INLINE_REPLIES).openapi({ description: repliesDescription }),
}).openapi('CommentThread');
export type CommentThread = z.infer<typeof CommentThread>;

/** A comment as a guest of a share link sees it. */
export const GuestComment = z
  .object({
    ...commentFields,
    author: GuestAuthor,
    body: z.string().openapi({
      description:
        'Empty once deleted. Mentions are already written as `@Name`, with no ids; a deleted ' +
        'account becomes `@…`.',
    }),
    canEdit: z.boolean().openapi({ description: 'This guest wrote it.' }),
    canDelete: z.boolean().openapi({ description: 'This guest wrote it.' }),
  })
  .openapi('GuestComment');
export type GuestComment = z.infer<typeof GuestComment>;

export const GuestCommentThread = GuestComment.extend({
  ...threadFields,
  resolvedBy: GuestAuthor.nullable(),
  replies: z.array(GuestComment).max(INLINE_REPLIES).openapi({ description: repliesDescription }),
}).openapi('GuestCommentThread');
export type GuestCommentThread = z.infer<typeof GuestCommentThread>;

const cursorDescription =
  'Opaque. Threads are ordered by when they were started, newest first, with the id as a ' +
  'tie-breaker, so replies, edits and resolutions never move a thread between pages. A thread ' +
  'started after the first page appears only when the list is fetched again from the start.';

export const CommentQuery = z
  .object({
    elementId: ElementRef.optional().openapi({ description: 'Threads about this card only.' }),
    scope: z.enum(['all', 'board', 'elements']).default('all').openapi({
      description: '`board`: threads about the whole board; `elements`: threads about cards.',
    }),
    status: z.enum(['open', 'resolved', 'all']).default('open'),
    cursor: Cursor.optional().openapi({ description: cursorDescription }),
    limit: ListLimit,
  })
  .openapi('CommentQuery');
export type CommentQuery = z.infer<typeof CommentQuery>;

export const ReplyQuery = z
  .object({
    cursor: Cursor.optional().openapi({
      description: 'Opaque. Replies oldest first, by creation time and then id.',
    }),
    limit: ListLimit,
  })
  .openapi('ReplyQuery');
export type ReplyQuery = z.infer<typeof ReplyQuery>;

export const CreateComment = z
  .object({
    elementId: ElementRef.optional().openapi({ description: 'Omit for a comment on the board.' }),
    parentId: Id.optional().openapi({
      description: 'Reply to this thread (its first comment). elementId is taken from it.',
    }),
    body: Body,
    visibility: CommentVisibility.optional().openapi({
      description: 'Default `team`. Ignored for replies.',
    }),
    shareLinkId: Id.optional().openapi({
      description:
        'Only with `everyone`: show the thread to the guests of this link only. The link must ' +
        'be active and include the board. Ignored for replies.',
    }),
    pin: CommentPin.optional(),
  })
  .openapi('CreateComment');
export type CreateComment = z.infer<typeof CreateComment>;

/** What a guest sends: no visibility (always `everyone`, for their link) and no mentions. */
export const GuestCreateComment = z
  .object({
    elementId: ElementRef.optional().openapi({ description: 'Omit for a comment on the board.' }),
    parentId: Id.optional().openapi({
      description:
        'Reply to a thread this guest can see (its first comment); any other thread is a 404.',
    }),
    body: GuestBody,
    pin: CommentPin.optional(),
  })
  .openapi('GuestCreateComment');
export type GuestCreateComment = z.infer<typeof GuestCreateComment>;

export const UpdateComment = z.object({ body: Body }).openapi('UpdateComment');
export type UpdateComment = z.infer<typeof UpdateComment>;

export const GuestUpdateComment = z.object({ body: GuestBody }).openapi('GuestUpdateComment');
export type GuestUpdateComment = z.infer<typeof GuestUpdateComment>;

/** Badge numbers on the canvas: threads per card (elementId) and on the board (null). */
export const CommentCount = z
  .object({
    elementId: ElementRef.nullable(),
    open: z.int().min(0),
    resolved: z.int().min(0),
  })
  .openapi('CommentCount');
export type CommentCount = z.infer<typeof CommentCount>;

export const CommentCounts = z.object({ items: z.array(CommentCount) }).openapi('CommentCounts');
export type CommentCounts = z.infer<typeof CommentCounts>;

/** Turns `@{id}` mentions in a comment body into the ids they mention, without duplicates. */
export function mentionedIds(body: string): string[] {
  const ids = new Set<string>();
  for (const m of body.matchAll(/@\{([0-9a-f-]{36})\}/gi)) {
    const id = (m[1] as string).toLowerCase();
    if (Id.safeParse(id).success) ids.add(id);
  }
  return [...ids].slice(0, MAX_MENTIONS);
}

/**
 * Writes the mentions of a body as `@Name`, for guests, emails and notification excerpts.
 * Ids without a name (people who can no longer read the board, deleted accounts) become `@…`.
 */
export function renderMentions(body: string, names: ReadonlyMap<string, string>): string {
  return body.replace(
    /@\{([0-9a-f-]{36})\}/gi,
    (_, id: string) => `@${names.get(id.toLowerCase()) ?? '…'}`,
  );
}
