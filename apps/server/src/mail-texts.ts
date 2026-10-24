/**
 * Texts of the emails the server sends, in Italian (the reference language) and English.
 * The web app has its own catalogues; emails are rendered on the server, so they live here.
 */
const it = {
  inviteSubject: (who: string, what: string) => `${who} ti ha invitato su ${what}`,
  inviteLines: (who: string, what: string, role: string | null, instance: string) => [
    role
      ? `${who} ti ha invitato su "${what}" come ${it.roles[role as keyof typeof it.roles] ?? role}.`
      : `${who} ti ha invitato su ${instance}.`,
    "Apri l'invito per accedere o creare il tuo account. Il link scade tra qualche giorno.",
  ],
  inviteAction: "Apri l'invito",
  roles: { owner: 'proprietario', editor: 'editor', commenter: 'commentatore', viewer: 'lettore' },
  magicSubject: (instance: string) => `Il tuo link di accesso a ${instance}`,
  magicLines: [
    'Usa questo link per accedere. Vale 15 minuti e una sola volta.',
    'Se non sei stato tu a chiederlo, ignora questa email.',
  ],
  magicAction: 'Accedi',
  resetSubject: 'Reimposta la password',
  resetLines: (instance: string) => [
    `Hai chiesto di reimpostare la password di ${instance}.`,
    'Se non sei stato tu, ignora questa email: la password resta quella di prima.',
  ],
  resetAction: 'Scegli una nuova password',
  someone: 'Qualcuno',
  guestName: (name: string) => `${name} (ospite)`,
  reviewStatuses: {
    none: 'nessuno',
    in_review: 'in revisione',
    approved: 'approvato',
    changes_requested: 'modifiche richieste',
  } as Record<string, string>,
  notificationLine: (
    type: string,
    who: string,
    where: string,
    excerpt: string | null,
    status: string | null,
  ) => {
    const said = excerpt ? `: «${excerpt}»` : '';
    switch (type) {
      case 'mention':
        return `${who} ti ha menzionato su "${where}"${said}`;
      case 'reply':
        return `${who} ha risposto su "${where}"${said}`;
      case 'comment':
        return `${who} ha commentato una tua scheda su "${where}"${said}`;
      case 'review':
        return `${who} ha cambiato la revisione di una scheda su "${where}": ${it.reviewStatuses[status ?? ''] ?? status ?? ''}`;
      case 'invitation_accepted':
        return where
          ? `${who} ha accettato il tuo invito su "${where}"`
          : `${who} ha accettato il tuo invito`;
      default:
        return `${who}: "${where}"`;
    }
  },
  notificationSubject: (count: number, instance: string) =>
    count === 1 ? `Una novità su ${instance}` : `${count} novità su ${instance}`,
  digestSubject: (instance: string) => `Il riepilogo di oggi su ${instance}`,
  notificationSettings: (url: string) =>
    `Scegli quando ricevere queste email nelle impostazioni: ${url}`,
  notificationAction: 'Apri Inkadra',
};

type Texts = typeof it;

const en: Texts = {
  inviteSubject: (who, what) => `${who} invited you to ${what}`,
  inviteLines: (who, what, role, instance) => [
    role
      ? `${who} invited you to "${what}" as ${en.roles[role as keyof typeof en.roles] ?? role}.`
      : `${who} invited you to ${instance}.`,
    'Open the invitation to sign in or create your account. The link expires in a few days.',
  ],
  inviteAction: 'Open the invitation',
  roles: { owner: 'owner', editor: 'editor', commenter: 'commenter', viewer: 'viewer' },
  magicSubject: (instance) => `Your sign-in link for ${instance}`,
  magicLines: [
    'Use this link to sign in. It works once, for 15 minutes.',
    'If you did not ask for it, ignore this email.',
  ],
  magicAction: 'Sign in',
  resetSubject: 'Reset your password',
  resetLines: (instance) => [
    `You asked to reset your ${instance} password.`,
    'If it was not you, ignore this email: your password stays the same.',
  ],
  resetAction: 'Choose a new password',
  someone: 'Someone',
  guestName: (name) => `${name} (guest)`,
  reviewStatuses: {
    none: 'none',
    in_review: 'in review',
    approved: 'approved',
    changes_requested: 'changes requested',
  },
  notificationLine: (type, who, where, excerpt, status) => {
    const said = excerpt ? `: “${excerpt}”` : '';
    switch (type) {
      case 'mention':
        return `${who} mentioned you on "${where}"${said}`;
      case 'reply':
        return `${who} replied on "${where}"${said}`;
      case 'comment':
        return `${who} commented on one of your cards on "${where}"${said}`;
      case 'review':
        return `${who} changed the review of a card on "${where}": ${en.reviewStatuses[status ?? ''] ?? status ?? ''}`;
      case 'invitation_accepted':
        return where
          ? `${who} accepted your invitation to "${where}"`
          : `${who} accepted your invitation`;
      default:
        return `${who}: "${where}"`;
    }
  },
  notificationSubject: (count, instance) =>
    count === 1 ? `Something new on ${instance}` : `${count} new things on ${instance}`,
  digestSubject: (instance) => `Today on ${instance}`,
  notificationSettings: (url) => `Choose when you get these emails in your settings: ${url}`,
  notificationAction: 'Open Inkadra',
};

export function mailText(who: { locale?: string | null }): Texts {
  return who.locale?.toLowerCase().startsWith('en') ? en : it;
}
