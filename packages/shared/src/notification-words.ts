// SPDX-License-Identifier: MPL-2.0

/**
 * The notification and calendar feed texts that every client shows the same (decision 0116):
 * what each notification type says after the actor's name (`notifications.type.*`, by
 * `NotificationType` and, for `server_alert`, by the alert's kind), the events and frequencies of
 * the notification settings (`settingsUi.notifications.*`) and the sentences of the private
 * calendar link on a phone (`calendar.*`). English, the source; the keys are those of the web
 * catalogues, so a client loads this object as its English catalogue. The other languages have
 * the same keys, one file each (`@inkadra/shared/notification-words/it`, `es`, `de`, `fr`,
 * `pt`), so a client imports only those it ships. The web's catalogues must say the same (a web
 * test compares them).
 */
export const NOTIFICATION_WORDS_EN = {
  notifications: {
    type: {
      mention: 'mentioned you',
      reply: 'replied to a thread',
      comment: 'commented on your card',
      review: 'changed a review',
      reviewStatus: 'changed the review to “{{status}}”',
      invitation_accepted: 'accepted your invitation',
      unknown: 'did something',
      export_ready: 'Your project export is ready to download',
      import_ready: 'Your project import is finished',
      access_expiring: '{{name}}’s access ends on {{date}}',
      access_expiringOwn: 'Your access ends on {{date}}',
      access_expired: '{{name}}’s access has ended',
      access_expiredOwn: 'Your access has ended',
      guest: 'A guest',
      link_opened: 'opened the board',
      task_assigned: 'assigned you a task',
      feedback_received: 'New in-app report received',
      review_submitted: 'sent their review',
      server_alert_disk_full: 'Almost out of space: {{free}} left of {{total}}',
      server_alert_service_down: '{{service}} is not answering',
      server_alert_backup_failed: 'The backup failed',
      server_alert_repeated_errors: 'The same error happened {{times}} times in the last hour',
      server_alert_unknown: 'Something is wrong with the server',
      update_available: 'A new version of Inkadra is available',
      server_alert_storage_limit: 'Instance space: {{percent}}% used ({{used}} of {{limit}})',
      server_alert_storage_request: 'asks for more space',
    },
  },
  settingsUi: {
    notifications: {
      events: {
        mention: 'Someone mentions you',
        reply: 'Someone replies to your thread',
        comment: 'Someone comments on your card',
        review: 'Review decision',
        task_assigned: 'Someone assigns you a task',
      },
      help: {
        immediate: 'Notifications close together arrive in one email',
        daily: 'One email a day with everything that happened',
        off: 'Only the in-app Inbox',
      },
      reviewHelp: 'Approved or changes requested',
    },
  },
  calendar: {
    helpPhone: 'Add this link as a calendar from URL. It updates by itself.',
    privacyPhone: 'Anyone with this link can see these events. Do not share it.',
    confirmBody:
      'Apps using the current link will stop updating. Afterwards, copy the new link and replace it in each app.',
    rotated: 'The installation secret changed: regenerate the link to use the calendar again.',
    disabled: 'The administrator has disabled calendar feeds.',
  },
};

/** The shape of every language's words: the keys of `NOTIFICATION_WORDS_EN`, each a string. */
export type NotificationWords = typeof NOTIFICATION_WORDS_EN;
