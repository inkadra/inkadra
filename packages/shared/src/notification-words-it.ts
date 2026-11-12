// SPDX-License-Identifier: MPL-2.0
import type { NotificationWords } from './notification-words.ts';

/**
 * The notification and calendar feed texts in Italian: the keys of `NOTIFICATION_WORDS_EN`
 * (decision 0116), as the web's Italian catalogue says them (a web test compares them).
 * Import it from `@inkadra/shared/notification-words/it`, so a client loads only the
 * languages it ships.
 */
export const NOTIFICATION_WORDS_IT: NotificationWords = {
  notifications: {
    type: {
      mention: 'ti ha menzionato',
      reply: 'ha risposto a una discussione',
      comment: 'ha commentato una tua card',
      review: 'ha cambiato una revisione',
      reviewStatus: 'ha cambiato la revisione in «{{status}}»',
      invitation_accepted: 'ha accettato il tuo invito',
      unknown: 'ha fatto qualcosa',
      export_ready: "L'esportazione del progetto è pronta da scaricare",
      import_ready: "L'importazione del progetto è terminata",
      access_expiring: 'L’accesso di {{name}} scade il {{date}}',
      access_expiringOwn: 'Il tuo accesso scade il {{date}}',
      access_expired: 'L’accesso di {{name}} è scaduto',
      access_expiredOwn: 'Il tuo accesso è scaduto',
      guest: 'Un ospite',
      link_opened: 'ha aperto la board',
      task_assigned: 'ti ha assegnato un compito',
      feedback_received: 'Nuova segnalazione in-app ricevuta',
      review_submitted: 'ha inviato la revisione',
      server_alert_disk_full: 'Spazio quasi finito: restano {{free}} su {{total}}',
      server_alert_service_down: '{{service}} non risponde',
      server_alert_backup_failed: 'Il backup non è riuscito',
      server_alert_repeated_errors:
        'Lo stesso errore si è ripetuto {{times}} volte nell’ultima ora',
      server_alert_unknown: 'Qualcosa non va sul server',
      update_available: 'È disponibile una nuova versione di Inkadra',
      server_alert_storage_limit: 'Spazio dell’istanza: {{percent}}% usato ({{used}} su {{limit}})',
      server_alert_storage_request: 'chiede più spazio',
    },
  },
  settingsUi: {
    notifications: {
      events: {
        mention: 'Qualcuno ti menziona',
        reply: 'Rispondono a una tua discussione',
        comment: 'Commentano una tua card',
        review: 'Decisione su una revisione',
        task_assigned: 'Ti assegnano un compito',
      },
      help: {
        immediate: 'Le notifiche ravvicinate arrivano in un’unica email',
        daily: 'Una email al giorno con tutto quello che è successo',
        off: 'Solo la Inbox dell’app',
      },
      reviewHelp: 'Approvata o modifiche richieste',
    },
  },
  calendar: {
    helpPhone: 'Aggiungi questo link come calendario da URL. Si aggiorna da solo.',
    privacyPhone: 'Chi ha il link vede questi eventi. Non condividerlo.',
    confirmBody:
      'Le app che usano il link attuale smettono di aggiornarsi. Dopo, copia il nuovo link e sostituiscilo in ciascuna.',
    rotated:
      'Il segreto dell’installazione è cambiato: rigenera il link per tornare a usare il calendario.',
    disabled: 'Il feed del calendario è disattivato dall’amministratore.',
  },
};
