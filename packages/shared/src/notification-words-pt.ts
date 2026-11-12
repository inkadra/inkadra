// SPDX-License-Identifier: MPL-2.0
import type { NotificationWords } from './notification-words.ts';

/**
 * The notification and calendar feed texts in Portuguese: the keys of `NOTIFICATION_WORDS_EN`
 * (decision 0116), as the web's Portuguese catalogue says them (a web test compares them).
 * Import it from `@inkadra/shared/notification-words/pt`, so a client loads only the
 * languages it ships.
 */
export const NOTIFICATION_WORDS_PT: NotificationWords = {
  notifications: {
    type: {
      mention: 'mencionou você',
      reply: 'respondeu a uma conversa',
      comment: 'comentou em um card seu',
      review: 'alterou uma revisão',
      reviewStatus: 'alterou a revisão para “{{status}}”',
      invitation_accepted: 'aceitou seu convite',
      unknown: 'fez algo',
      export_ready: 'A exportação do projeto está pronta para baixar',
      import_ready: 'A importação do projeto terminou',
      access_expiring: 'O acesso de {{name}} termina em {{date}}',
      access_expiringOwn: 'Seu acesso termina em {{date}}',
      access_expired: 'O acesso de {{name}} terminou',
      access_expiredOwn: 'Seu acesso terminou',
      guest: 'Um convidado',
      link_opened: 'abriu o quadro',
      task_assigned: 'atribuiu uma tarefa a você',
      feedback_received: 'Novo relato recebido pelo app',
      review_submitted: 'enviou a revisão',
      server_alert_disk_full: 'Quase sem espaço: restam {{free}} de {{total}}',
      server_alert_service_down: '{{service}} não responde',
      server_alert_backup_failed: 'A cópia de segurança falhou',
      server_alert_repeated_errors: 'O mesmo erro repetiu-se {{times}} vezes na última hora',
      server_alert_unknown: 'Algo não está bem no servidor',
      update_available: 'Uma nova versão do Inkadra está disponível',
      server_alert_storage_limit: 'Espaço da instância: {{percent}}% usado ({{used}} de {{limit}})',
      server_alert_storage_request: 'pede mais espaço',
    },
  },
  settingsUi: {
    notifications: {
      events: {
        mention: 'Alguém menciona você',
        reply: 'Alguém responde a uma conversa sua',
        comment: 'Alguém comenta em um card seu',
        review: 'Decisão sobre uma revisão',
        task_assigned: 'Alguém atribui uma tarefa a você',
      },
      help: {
        immediate: 'Notificações próximas chegam em um único e-mail',
        daily: 'Um e-mail por dia com tudo o que aconteceu',
        off: 'Só a caixa de entrada do app',
      },
      reviewHelp: 'Aprovado ou alterações solicitadas',
    },
  },
  calendar: {
    helpPhone: 'Adicione este link como calendário por URL. Ele se atualiza sozinho.',
    privacyPhone: 'Quem tiver este link vê estes eventos. Não compartilhe.',
    confirmBody:
      'Os apps que usam o link atual deixarão de se atualizar. Depois, copie o novo link e substitua em cada app.',
    rotated: 'O segredo da instalação mudou: gere um novo link para voltar a usar o calendário.',
    disabled: 'O administrador desativou os feeds de calendário.',
  },
};
