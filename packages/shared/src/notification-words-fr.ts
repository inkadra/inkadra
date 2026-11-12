// SPDX-License-Identifier: MPL-2.0
import type { NotificationWords } from './notification-words.ts';

/**
 * The notification and calendar feed texts in French: the keys of `NOTIFICATION_WORDS_EN`
 * (decision 0116), as the web's French catalogue says them (a web test compares them).
 * Import it from `@inkadra/shared/notification-words/fr`, so a client loads only the
 * languages it ships.
 */
export const NOTIFICATION_WORDS_FR: NotificationWords = {
  notifications: {
    type: {
      mention: 'vous a mentionné',
      reply: 'a répondu à une discussion',
      comment: 'a commenté votre carte',
      review: 'a changé une révision',
      reviewStatus: 'a changé la révision en « {{status}} »',
      invitation_accepted: 'a accepté votre invitation',
      unknown: 'a fait quelque chose',
      export_ready: 'L’export de votre projet est prêt à être téléchargé',
      import_ready: 'L’import de votre projet est terminé',
      access_expiring: 'L’accès de {{name}} prend fin le {{date}}',
      access_expiringOwn: 'Votre accès prend fin le {{date}}',
      access_expired: 'L’accès de {{name}} a pris fin',
      access_expiredOwn: 'Votre accès a pris fin',
      guest: 'Un invité',
      link_opened: 'a ouvert le tableau',
      task_assigned: 'vous a attribué une tâche',
      feedback_received: 'Nouveau signalement reçu dans l’application',
      review_submitted: 'a envoyé sa relecture',
      server_alert_disk_full: 'Presque plus d’espace : il reste {{free}} sur {{total}}',
      server_alert_service_down: '{{service}} ne répond pas',
      server_alert_backup_failed: 'La sauvegarde a échoué',
      server_alert_repeated_errors:
        'La même erreur s’est produite {{times}} fois dans la dernière heure',
      server_alert_unknown: 'Quelque chose ne va pas sur le serveur',
      update_available: 'Une nouvelle version d’Inkadra est disponible',
      server_alert_storage_limit:
        'Espace de l’instance : {{percent}} % utilisé ({{used}} sur {{limit}})',
      server_alert_storage_request: 'demande plus d’espace',
    },
  },
  settingsUi: {
    notifications: {
      events: {
        mention: 'Quelqu’un vous mentionne',
        reply: 'Quelqu’un répond à votre discussion',
        comment: 'Quelqu’un commente votre carte',
        review: 'Décision sur une révision',
        task_assigned: 'Quelqu’un vous attribue une tâche',
      },
      help: {
        immediate: 'Les notifications rapprochées arrivent dans un seul e-mail',
        daily: 'Un e-mail par jour avec tout ce qui s’est passé',
        off: 'Uniquement la réception de l’application',
      },
      reviewHelp: 'Approuvé ou modifications demandées',
    },
  },
  calendar: {
    helpPhone: 'Ajoutez ce lien comme calendrier à partir d’une URL. Il se met à jour tout seul.',
    privacyPhone: 'Toute personne ayant ce lien voit ces événements. Ne le partagez pas.',
    confirmBody:
      'Les applications qui utilisent le lien actuel cesseront de se mettre à jour. Ensuite, copiez le nouveau lien et remplacez-le dans chacune.',
    rotated:
      'Le secret de l’installation a changé : régénérez le lien pour utiliser à nouveau le calendrier.',
    disabled: 'L’administrateur a désactivé les flux de calendrier.',
  },
};
