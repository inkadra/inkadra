// SPDX-License-Identifier: MPL-2.0
import { Author, ElementRef } from './comments.ts';
import { Cursor, Id, Timestamp, z } from './common.ts';
import { ReviewStatus } from './reviews.ts';

/**
 * In-app notifications of the signed-in person (docs/decisions/0013). They are written by the
 * server when something happens and never by clients; email follows the person's preference.
 */
export const NotificationType = z
  .enum(['mention', 'reply', 'comment', 'review', 'invitation_accepted'])
  .openapi({
    description:
      '`mention`: someone mentioned you in a comment. `reply`: a reply in a thread you wrote ' +
      'in. `comment`: a new thread on a card you created. `review`: the review status of a ' +
      'card you created, or asked a review for, changed. `invitation_accepted`: someone ' +
      'accepted your invitation. Clients show types they do not know as a plain line.',
  });
export type NotificationType = z.infer<typeof NotificationType>;

export const Notification = z
  .object({
    id: Id,
    type: NotificationType,
    actor: Author.nullable().openapi({ description: 'Who did it; null when nobody did.' }),
    projectId: Id.nullable(),
    projectName: z.string().nullable(),
    boardId: Id.nullable(),
    boardTitle: z.string().nullable(),
    elementId: ElementRef.nullable(),
    commentId: Id.nullable().openapi({ description: 'For mention, reply and comment.' }),
    excerpt: z.string().max(280).nullable().openapi({
      description: 'Start of the comment, with mentions already written as names.',
    }),
    reviewStatus: ReviewStatus.nullable().openapi({ description: 'For review.' }),
    readAt: Timestamp.nullable(),
    createdAt: Timestamp,
  })
  .openapi('Notification');
export type Notification = z.infer<typeof Notification>;

export const NotificationQuery = z
  .object({
    unread: z.enum(['true', 'false']).optional().openapi({ description: 'Only unread ones.' }),
    cursor: Cursor.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(30),
  })
  .openapi('NotificationQuery');
export type NotificationQuery = z.infer<typeof NotificationQuery>;

export const UnreadCount = z
  .object({ unread: z.int().min(0).openapi({ description: 'Capped at 1000.' }) })
  .openapi('UnreadCount');
export type UnreadCount = z.infer<typeof UnreadCount>;

export const MarkAllRead = z
  .object({
    before: Timestamp.optional().openapi({
      description:
        'Only notifications created up to this time, so one that arrives while the list is ' +
        'open is not marked unseen. Default: now.',
    }),
  })
  .openapi('MarkAllRead');
export type MarkAllRead = z.infer<typeof MarkAllRead>;

export const EmailFrequency = z.enum(['immediate', 'daily', 'off']).openapi({
  description:
    '`immediate`: within a few minutes, several notifications in one email. `daily`: one ' +
    'digest a day of what is still unread. `off`: no email. Without SMTP ' +
    '(Instance.auth.email false) nothing is sent whatever the choice.',
});
export type EmailFrequency = z.infer<typeof EmailFrequency>;

export const NotificationPreferences = z
  .object({ email: EmailFrequency })
  .openapi('NotificationPreferences');
export type NotificationPreferences = z.infer<typeof NotificationPreferences>;

export const UpdateNotificationPreferences = NotificationPreferences.partial().openapi(
  'UpdateNotificationPreferences',
);
export type UpdateNotificationPreferences = z.infer<typeof UpdateNotificationPreferences>;
