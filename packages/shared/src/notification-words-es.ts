// SPDX-License-Identifier: MPL-2.0
import type { NotificationWords } from './notification-words.ts';

/**
 * The notification and calendar feed texts in Spanish: the keys of `NOTIFICATION_WORDS_EN`
 * (decision 0116), as the web's Spanish catalogue says them (a web test compares them).
 * Import it from `@inkadra/shared/notification-words/es`, so a client loads only the
 * languages it ships.
 */
export const NOTIFICATION_WORDS_ES: NotificationWords = {
  notifications: {
    type: {
      mention: 'te mencionó',
      reply: 'respondió en un hilo',
      comment: 'comentó en una de tus tarjetas',
      review: 'cambió una revisión',
      reviewStatus: 'cambió la revisión a «{{status}}»',
      invitation_accepted: 'aceptó tu invitación',
      unknown: 'hizo algo',
      export_ready: 'La exportación del proyecto está lista para descargar',
      import_ready: 'La importación del proyecto terminó',
      access_expiring: 'El acceso de {{name}} termina el {{date}}',
      access_expiringOwn: 'Tu acceso termina el {{date}}',
      access_expired: 'El acceso de {{name}} terminó',
      access_expiredOwn: 'Tu acceso terminó',
      guest: 'Un invitado',
      link_opened: 'abrió el tablero',
      task_assigned: 'te asignó una tarea',
      feedback_received: 'Nuevo informe recibido desde la app',
      review_submitted: 'envió su revisión',
      server_alert_disk_full: 'Casi sin espacio: quedan {{free}} de {{total}}',
      server_alert_service_down: '{{service}} no responde',
      server_alert_backup_failed: 'La copia de seguridad ha fallado',
      server_alert_repeated_errors:
        'El mismo error se ha repetido {{times}} veces en la última hora',
      server_alert_unknown: 'Algo va mal en el servidor',
      update_available: 'Hay una nueva versión de Inkadra disponible',
      server_alert_storage_limit:
        'Espacio de la instancia: {{percent}} % usado ({{used}} de {{limit}})',
      server_alert_storage_request: 'pide más espacio',
    },
  },
  settingsUi: {
    notifications: {
      events: {
        mention: 'Alguien te menciona',
        reply: 'Alguien responde a tu hilo',
        comment: 'Alguien comenta en tu tarjeta',
        review: 'Decisión de revisión',
        task_assigned: 'Alguien te asigna una tarea',
      },
      help: {
        immediate: 'Las notificaciones seguidas llegan en un solo correo',
        daily: 'Un correo al día con todo lo que pasó',
        off: 'Solo la bandeja de la app',
      },
      reviewHelp: 'Aprobada o cambios solicitados',
    },
  },
  calendar: {
    helpPhone: 'Añade este enlace como calendario desde URL. Se actualiza solo.',
    privacyPhone: 'Quien tenga el enlace puede ver estos eventos. No lo compartas.',
    confirmBody:
      'Las apps que usan el enlace actual dejarán de actualizarse. Después, copia el enlace nuevo y sustitúyelo en cada una.',
    rotated:
      'El secreto de la instalación cambió: regenera el enlace para volver a usar el calendario.',
    disabled: 'El administrador desactivó el feed del calendario.',
  },
};
