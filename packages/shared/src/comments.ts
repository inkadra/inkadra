// SPDX-License-Identifier: MPL-2.0
import { Cursor, Id, Timestamp, z } from './common.ts';
import { UserSummary } from './users.ts';

/**
 * Comments on a board or on one of its cards (docs/decisions/0013). They live in Postgres, not
 * in the board document: commenters and guests cannot write the document, and comments need
 * authors, edits and notifications. Open boards learn about changes through a stateless
 * message on the collab WebSocket (BoardNotice in @inkadra/doc-schema).
 */

/** Element id of the board document (21 url-safe characters, see @inkadra/doc-schema). */
export const ElementRef = z
  .string()
  .regex(/^[A-Za-z0-9_-]{8,64}$/)
  .openapi({ description: 'Element id in the board document.', example: 'V1StGXR8_Z5jdHi6B-myT' });

export const MAX_COMMENT_LENGTH = 5000;
export const MAX_MENTIONS = 20;

/**
 * Who wrote a comment or changed a review: a person with an account, or a guest of a share
 * link, known only by the name they typed.
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
  .openapi('Author');
export type Author = z.infer<typeof Author>;

export const CommentVisibility = z.enum(['team', 'everyone']).openapi({
  description:
    '`team`: people with a role on the board. `everyone`: also the guests of share links that ' +
    'may read comments. Guests always write `everyone`; replies take the visibility of their ' +
    'thread.',
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

export const Comment = z
  .object({
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
    author: Author,
    body: z.string().openapi({ description: 'Empty once deleted.' }),
    mentions: z.array(UserSummary).openapi({
      description: 'People mentioned in `body`, to render `@{id}` with their name.',
    }),
    visibility: CommentVisibility,
    pin: CommentPin.nullable(),
    createdAt: Timestamp,
    editedAt: Timestamp.nullable(),
    deletedAt: Timestamp.nullable().openapi({
      description:
        'Set when a thread start is deleted while it has replies: it stays as a placeholder.',
    }),
    canEdit: z.boolean().openapi({ description: 'The caller wrote it.' }),
    canDelete: z.boolean().openapi({ description: 'The caller wrote it, or is editor or owner.' }),
  })
  .openapi('Comment');
export type Comment = z.infer<typeof Comment>;

export const CommentThread = Comment.extend({
  resolvedAt: Timestamp.nullable(),
  resolvedBy: Author.nullable(),
  replies: z.array(Comment).openapi({ description: 'Oldest first. Replies have no replies.' }),
}).openapi('CommentThread');
export type CommentThread = z.infer<typeof CommentThread>;

export const CommentQuery = z
  .object({
    elementId: ElementRef.optional().openapi({ description: 'Threads about this card only.' }),
    scope: z.enum(['all', 'board', 'elements']).default('all').openapi({
      description: '`board`: threads about the whole board; `elements`: threads about cards.',
    }),
    status: z.enum(['open', 'resolved', 'all']).default('open'),
    cursor: Cursor.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(30),
  })
  .openapi('CommentQuery');
export type CommentQuery = z.infer<typeof CommentQuery>;

export const CreateComment = z
  .object({
    elementId: ElementRef.optional().openapi({ description: 'Omit for a comment on the board.' }),
    parentId: Id.optional().openapi({
      description: 'Reply to this thread (its first comment). elementId is taken from it.',
    }),
    body: Body,
    visibility: CommentVisibility.optional().openapi({
      description: 'Default `team`. Ignored for replies and for guests.',
    }),
    pin: CommentPin.optional(),
  })
  .openapi('CreateComment');
export type CreateComment = z.infer<typeof CreateComment>;

export const UpdateComment = z.object({ body: Body }).openapi('UpdateComment');
export type UpdateComment = z.infer<typeof UpdateComment>;

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
  for (const m of body.matchAll(/@\{([0-9a-f-]{36})\}/gi)) ids.add((m[1] as string).toLowerCase());
  return [...ids].slice(0, MAX_MENTIONS);
}
