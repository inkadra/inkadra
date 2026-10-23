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
};

export function mailText(who: { locale?: string | null }): Texts {
  return who.locale?.toLowerCase().startsWith('en') ? en : it;
}
