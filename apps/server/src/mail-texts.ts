/**
 * Texts of the emails the server sends, in Italian (the reference language) and English.
 * The web app has its own catalogues; emails are rendered on the server, so they live here.
 */
const it = {
  securitySubjects: {
    password: 'Password modificata',
    twoFactor: 'Autenticazione a due fattori disabilitata',
    token: 'Token di accesso creato',
  },
  securityNotice:
    'Le impostazioni di sicurezza del tuo account sono cambiate. Se non sei stato tu, contatta subito l’amministratore.',
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
  /** `label`: what the link is called, null without one. */
  linkOpenedLine: (label: string | null, where: string) =>
    `${label ?? 'Un ospite'} ha aperto "${where}"`,
  /** `who` null: the access of the recipient. */
  accessLine: (type: string, who: string | null, where: string, at: Date | null) => {
    const when = at ? accessWhen(at, 'it-IT') : '';
    if (type === 'access_expiring')
      return who
        ? `L'accesso di ${who} a "${where}" scade il ${when}`
        : `Il tuo accesso a "${where}" scade il ${when}`;
    return who
      ? `L'accesso di ${who} a "${where}" è scaduto`
      : `Il tuo accesso a "${where}" è scaduto`;
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
  securitySubjects: {
    password: 'Password changed',
    twoFactor: 'Two-factor authentication disabled',
    token: 'Access token created',
  },
  securityNotice:
    'Your account security settings changed. If this was not you, contact your administrator immediately.',
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
  linkOpenedLine: (label, where) => `${label ?? 'A guest'} opened "${where}"`,
  accessLine: (type, who, where, at) => {
    const when = at ? accessWhen(at, 'en-GB') : '';
    if (type === 'access_expiring')
      return who
        ? `${who}'s access to "${where}" ends on ${when}`
        : `Your access to "${where}" ends on ${when}`;
    return who ? `${who}'s access to "${where}" has ended` : `Your access to "${where}" has ended`;
  },
  notificationSubject: (count, instance) =>
    count === 1 ? `Something new on ${instance}` : `${count} new things on ${instance}`,
  digestSubject: (instance) => `Today on ${instance}`,
  notificationSettings: (url) => `Choose when you get these emails in your settings: ${url}`,
  notificationAction: 'Open Inkadra',
};

/**
 * When access ends, for emails. Accounts keep no time zone, so the time and the zone name
 * (the server's) go with the date: "15 dicembre, 23:59 CET" is unambiguous anywhere.
 */
export function accessWhen(at: Date, locale: string, timeZone?: string): string {
  return at.toLocaleString(locale, {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
    ...(timeZone ? { timeZone } : {}),
  });
}

export function mailText(who: { locale?: string | null }): Texts {
  return who.locale?.toLowerCase().startsWith('en') ? en : it;
}
