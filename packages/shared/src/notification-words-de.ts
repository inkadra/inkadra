// SPDX-License-Identifier: MPL-2.0
import type { NotificationWords } from './notification-words.ts';

/**
 * The notification and calendar feed texts in German: the keys of `NOTIFICATION_WORDS_EN`
 * (decision 0116), as the web's German catalogue says them (a web test compares them).
 * Import it from `@inkadra/shared/notification-words/de`, so a client loads only the
 * languages it ships.
 */
export const NOTIFICATION_WORDS_DE: NotificationWords = {
  notifications: {
    type: {
      mention: 'hat dich erwähnt',
      reply: 'hat in einer Diskussion geantwortet',
      comment: 'hat deine Karte kommentiert',
      review: 'hat ein Review geändert',
      reviewStatus: 'hat das Review auf „{{status}}“ geändert',
      invitation_accepted: 'hat deine Einladung angenommen',
      unknown: 'hat etwas getan',
      export_ready: 'Dein Projektexport steht zum Download bereit',
      import_ready: 'Dein Projektimport ist abgeschlossen',
      access_expiring: 'Der Zugriff von {{name}} endet am {{date}}',
      access_expiringOwn: 'Dein Zugriff endet am {{date}}',
      access_expired: 'Der Zugriff von {{name}} ist beendet',
      access_expiredOwn: 'Dein Zugriff ist beendet',
      guest: 'Ein Gast',
      link_opened: 'hat das Board geöffnet',
      task_assigned: 'hat dir eine Aufgabe zugewiesen',
      feedback_received: 'Neue In-App-Meldung erhalten',
      review_submitted: 'hat das Review gesendet',
      server_alert_disk_full: 'Speicher fast voll: noch {{free}} von {{total}}',
      server_alert_service_down: '{{service}} antwortet nicht',
      server_alert_backup_failed: 'Die Sicherung ist fehlgeschlagen',
      server_alert_repeated_errors: 'Derselbe Fehler trat in der letzten Stunde {{times}}-mal auf',
      server_alert_unknown: 'Mit dem Server stimmt etwas nicht',
      update_available: 'Eine neue Version von Inkadra ist verfügbar',
      server_alert_storage_limit:
        'Speicher der Instanz: {{percent}} % belegt ({{used}} von {{limit}})',
      server_alert_storage_request: 'bittet um mehr Speicher',
    },
  },
  settingsUi: {
    notifications: {
      events: {
        mention: 'Jemand erwähnt dich',
        reply: 'Jemand antwortet auf deine Diskussion',
        comment: 'Jemand kommentiert deine Karte',
        review: 'Review-Entscheidung',
        task_assigned: 'Jemand weist dir eine Aufgabe zu',
      },
      help: {
        immediate: 'Kurz aufeinanderfolgende Benachrichtigungen kommen in einer E-Mail',
        daily: 'Eine E-Mail pro Tag mit allem, was passiert ist',
        off: 'Nur die Inbox in der App',
      },
      reviewHelp: 'Freigegeben oder Änderungen angefragt',
    },
  },
  calendar: {
    helpPhone: 'Füge diesen Link als Kalender per URL hinzu. Er aktualisiert sich von selbst.',
    privacyPhone: 'Wer den Link hat, sieht diese Termine. Teile ihn nicht.',
    confirmBody:
      'Apps mit dem aktuellen Link werden nicht mehr aktualisiert. Kopiere danach den neuen Link und ersetze ihn in jeder App.',
    rotated:
      'Das Installations-Secret wurde geändert: Erzeuge den Link neu, um den Kalender wieder zu nutzen.',
    disabled: 'Der Admin hat Kalender-Feeds deaktiviert.',
  },
};
