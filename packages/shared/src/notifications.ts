// SPDX-License-Identifier: MPL-2.0
import { Author, ElementRef, ListLimit } from './comments.ts';
import { Cursor, Id, Timestamp, z } from './common.ts';
import { ReviewStatus } from './reviews.ts';
import { UserSummary } from './users.ts';

/**
 * In-app notifications of the signed-in person (docs/decisions/0013). They are written by the
 * server when something happens and never by clients; email follows the person's preference.
 */
export const NotificationType = z
  .enum([
    'mention',
    'reply',
    'comment',
    'review',
    'invitation_accepted',
    'export_ready',
    'import_ready',
    'access_expiring',
    'access_expired',
    'link_opened',
    'task_assigned',
  ])
  .openapi({
    description:
      '`mention`: someone mentioned you in a comment. `reply`: a reply in a thread you wrote ' +
      'in. `comment`: a new thread on a card you created. `review`: the review status of a ' +
      'card you created, or asked a review for, changed. `invitation_accepted`: someone ' +
      'accepted your invitation. `export_ready`: your export of `projectId` can be ' +
      'downloaded; it carries no transfer id, clients find the archive in `GET /transfers`. ' +
      '`import_ready`: your import finished as `projectId`. Both are in-app only, without ' +
      'actor, and arrive from API 0.8.0. `access_expiring`: the role of `subject` on ' +
      '`projectId` (or on `boardId` and its sub-boards) ends at `accessExpiresAt`, sent three ' +
      'days before to that person and to the project owners. `access_expired`: it has ended. ' +
      'Both from API 0.9.0 (decision 0041). `link_opened`: a guest opened a share link you ' +
      'made for the first time, or for the first time since a new named version of the board; ' +
      'it has no actor (`shareLinkLabel` says which link) and nothing about the visit. Open: clients show types they do not know as a plain line ' +
      'with the actor, the board and the time.',
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
    threadId: Id.nullable()
      .optional()
      .openapi({
        description:
          'First comment of the thread of `commentId` (the same id for a thread start), to open ' +
          'the thread without paging through replies. Null without `commentId`. Missing from ' +
          'servers before API 0.5.0.',
      }),
    excerpt: z
      .string()
      .max(280)
      .nullable()
      .openapi({
        description:
          'Start of the comment as it is now, with mentions written as names; null once the ' +
          'comment is deleted.',
      }),
    reviewStatus: ReviewStatus.nullable().openapi({ description: 'For review.' }),
    subject: UserSummary.nullable()
      .optional()
      .openapi({
        description:
          'For access_expiring and access_expired: whose access it is (the recipient ' +
          'themselves, or a member for the owners). Missing from servers before API 0.9.0.',
      }),
    accessExpiresAt: Timestamp.nullable()
      .optional()
      .openapi({ description: 'For access_expiring and access_expired.' }),
    shareLinkLabel: z
      .string()
      .nullable()
      .optional()
      .openapi({
        description:
          'For link_opened: the label of the link that was opened; null without one, or when ' +
          'you have no role on its board. Missing from servers before this notification existed.',
      }),
    readAt: Timestamp.nullable(),
    createdAt: Timestamp,
  })
  .openapi('Notification');
export type Notification = z.infer<typeof Notification>;

export const NotificationQuery = z
  .object({
    unread: z.enum(['true', 'false']).optional().openapi({ description: 'Only unread ones.' }),
    cursor: Cursor.optional().openapi({
      description:
        'Opaque, by creation time and id. Notifications about boards the person can no longer ' +
        'open are left out after paging, so a page can be short or even empty while ' +
        '`nextCursor` is not null: keep following it.',
    }),
    limit: ListLimit,
  })
  .openapi('NotificationQuery');
export type NotificationQuery = z.infer<typeof NotificationQuery>;

export const UnreadCount = z
  .object({
    unread: z.int().min(0).openapi({
      description:
        'Unread notifications the list would show, with the same access filter. Capped at 1000.',
    }),
  })
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

/**
 * Notifications a person may turn off by channel in the notification matrix (#302): the matrix
 * and the server read this list, and each type has a label at
 * `settingsUi.notifications.events.<type>`.
 */
export const NotificationChannelType = z.enum([
  'mention',
  'reply',
  'comment',
  'review',
  'task_assigned',
]);
export type NotificationChannelType = z.infer<typeof NotificationChannelType>;

/** The ones that always reach the Inbox: only their email can be turned off. */
export const INBOX_ALWAYS: readonly NotificationChannelType[] = ['mention'];

export const NotificationPreferences = z
  .object({
    email: EmailFrequency,
    inboxOff: z
      .array(NotificationChannelType)
      .optional()
      .openapi({
        description:
          'Types this person does not want in the Inbox: they are not written at all, so they ' +
          'are not emailed either. `mention` always arrives. Missing from older servers.',
      }),
    emailOff: z
      .array(NotificationChannelType)
      .optional()
      .openapi({
        description:
          'Types that stay in the Inbox but are never emailed, alone or in the digest. Missing ' +
          'from older servers.',
      }),
  })
  .openapi('NotificationPreferences');
export type NotificationPreferences = z.infer<typeof NotificationPreferences>;

export const UpdateNotificationPreferences = NotificationPreferences.partial().openapi(
  'UpdateNotificationPreferences',
);
export type UpdateNotificationPreferences = z.infer<typeof UpdateNotificationPreferences>;
