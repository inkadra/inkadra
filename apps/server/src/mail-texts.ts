/**
 * Texts of the emails the server sends, in Italian (the reference language) and English.
 * The web app has its own catalogues; emails are rendered on the server, so they live here.
 * Every string is plain text: mail-layout.ts escapes it.
 */

/** "l’8 novembre" but "il 15 novembre": the article before an Italian date. */
const il = (date: string) => (/^(1|8|11)\D/.test(date) ? 'l’' : 'il ');

const plural = (n: number, one: string, many: string) => (n === 1 ? one : `${n} ${many}`);

const it = {
  lang: 'it',
  locale: 'it-IT',
  fallback: 'Se il pulsante non funziona, copia questo indirizzo nel browser:',
  sentBy: (instance: string) =>
    instance === 'Inkadra'
      ? 'Email inviata da Inkadra.'
      : `Email inviata da ${instance} con Inkadra.`,
  join: (parts: string[]) =>
    parts.length > 1 ? `${parts.slice(0, -1).join(', ')} e ${parts.at(-1)}` : (parts[0] ?? ''),

  releaseSubject: (version: string) => `Novità di Inkadra ${version}`,
  releaseBadge: (version: string) => `Versione ${version}`,
  releaseTitle: 'Novità di Inkadra',
  releaseIntro: (instance: string, version: string, listed: boolean) =>
    listed
      ? `${instance} è stata aggiornata. Ecco cosa puoi fare da oggi.`
      : `${instance} è stata aggiornata a Inkadra ${version}. Le note di rilascio raccontano le novità.`,
  releaseAction: 'Leggi le note di rilascio',
  releaseFooter: {
    text: 'Hai attivato Novità di Inkadra nelle notifiche.',
    link: 'Disattivale qui',
    after: ' quando vuoi.',
  },

  security: {
    badge: 'Avviso di sicurezza',
    events: {
      password: {
        title: 'Password modificata',
        body: 'La password del tuo account è stata cambiata e i token di accesso personali sono stati revocati.',
        after:
          'Non riconosci questa modifica? Reimposta la password e contatta subito l’amministratore.',
      },
      twoFactor: {
        title: 'Verifica in due passaggi disattivata',
        body: 'Il tuo account non chiede più il codice di verifica quando accedi.',
        after:
          'Non riconosci questa modifica? Cambia la password, riattiva la verifica e contatta subito l’amministratore.',
      },
      token: {
        title: 'Nuovo token di accesso',
        body: 'Sul tuo account è stato creato un token che permette di accedere senza password.',
        after: 'Non riconosci questa modifica? Revoca il token e contatta subito l’amministratore.',
      },
    },
    subject: (title: string, instance: string) => `${title} su ${instance}`,
    preheader: (title: string, token: string | null) =>
      `${token ? `Token «${token}» creato` : title}. Se non sei tu, controlla subito.`,
    token: 'Token',
    when: 'Quando',
    expires: 'Scade',
    action: 'Controlla il tuo account',
    footer: (instance: string) =>
      `Avviso di sicurezza di ${instance}: arriva sempre, non si può disattivare.`,
  },

  inviteSubject: (who: string, what: string) => `${who} ti ha invitato su ${what}`,
  inviteIntro: {
    project: 'Accedi o crea il tuo account per lavorare al progetto insieme al resto del team.',
    board: 'Accedi o crea il tuo account per lavorare alla lavagna insieme al resto del team.',
    instance: 'Accedi o crea il tuo account per iniziare.',
  },
  invitePreheader: (days: number) =>
    `Accedi o crea il tuo account per iniziare. Invito valido ${plural(days, 'un giorno', 'giorni')}.`,
  inviteFacts: { project: 'Progetto', board: 'Lavagna', role: 'Ruolo', expires: 'Scade' },
  roles: {
    owner: 'Proprietario: gestisce il progetto, le persone e le lavagne',
    editor: 'Editor: può creare e modificare le lavagne',
    commenter: 'Commentatore: può vedere e commentare',
    viewer: 'Lettore: può solo vedere',
  } as Record<string, string>,
  inviteAction: "Apri l'invito",
  inviteFooter: 'Non aspettavi questo invito? Puoi ignorare questa email.',

  magicSubject: (instance: string) => `Il tuo link di accesso a ${instance}`,
  magicTitle: (instance: string) => `Accedi a ${instance}`,
  magicIntro: 'Usa il pulsante per entrare, senza password.',
  magicNote: { text: 'Il link vale 15 minuti e una sola volta.', strong: '15 minuti' },
  magicPreheader: 'Vale 15 minuti e una sola volta.',
  magicAction: 'Accedi',
  magicFooter: 'Non hai chiesto tu questo link? Ignora questa email: nessuno può entrare senza.',

  resetSubject: (instance: string) => `Reimposta la password di ${instance}`,
  resetTitle: 'Scegli una nuova password',
  resetIntro: (instance: string) =>
    `Abbiamo ricevuto la richiesta di reimpostare la password del tuo account su ${instance}.`,
  resetPreheader: 'Se non l’hai chiesto tu, la password resta quella di prima.',
  resetAction: 'Scegli una nuova password',
  resetFooter: 'Non l’hai chiesto tu? Ignora questa email: la password resta quella di prima.',

  someone: 'Qualcuno',
  guestName: (name: string) => `${name} (ospite)`,
  today: 'Oggi',
  yesterday: 'Ieri',
  reviewStatuses: {
    none: 'nessuno',
    in_review: 'in revisione',
    approved: 'approvato',
    changes_requested: 'modifiche richieste',
  } as Record<string, string>,
  /** What someone did, after their name. */
  verbs: {
    mention: 'ti ha menzionato',
    reply: 'ha risposto in una discussione',
    comment: 'ha commentato una tua scheda',
    review: 'ha cambiato la revisione',
    task_assigned: 'ti ha assegnato un compito',
    invitation_accepted: 'ha accettato il tuo invito',
  } as Record<string, string>,
  wrote: 'ha scritto',
  unknownVerb: 'ha una novità per te',
  linkOpened: (label: string | null) =>
    label
      ? { who: `Link ${label}`, what: 'è stato aperto da un ospite' }
      : { who: 'Un ospite', what: 'ha aperto un link di condivisione' },
  ownExpiring: (where: string, when: string) =>
    `Il tuo accesso a ${where} scade ${il(when)}${when}`,
  ownExpiringTail: (where: string) => `il tuo accesso a ${where} che scade`,
  ownExpired: { who: 'Il tuo accesso', what: 'è scaduto' },
  otherExpiring: (when: string) => `perde l’accesso ${il(when)}${when}`,
  otherExpired: 'non ha più accesso',
  counts: {
    mention: (n: number) => plural(n, 'una menzione', 'menzioni'),
    reply: (n: number) => plural(n, 'una risposta', 'risposte'),
    comment: (n: number) => plural(n, 'un commento', 'commenti'),
    review: (n: number) => plural(n, 'una revisione', 'revisioni'),
    task_assigned: (n: number) => plural(n, 'un compito', 'compiti'),
  } as Record<string, (n: number) => string>,
  more: 'altro da guardare',
  singleSubject: (sentence: string, where: string) =>
    where ? `${sentence} su ${where}` : sentence,
  digestTitle: (n: number, daily: boolean) => `${n} novità${daily ? ' da ieri' : ''}`,
  digestSubject: (n: number, instance: string, summary: string) =>
    `${n} novità su ${instance}${summary ? `: ${summary}` : ''}`,
  replyAction: 'Rispondi al commento',
  openBoard: 'Apri la lavagna',
  openProject: 'Apri il progetto',
  openInkadra: 'Apri Inkadra',
  openInbox: 'Apri la posta in arrivo',
  open: 'Apri',
  notificationFooter: {
    text: (instance: string) => `Ricevi queste email per le notifiche di ${instance}.`,
    link: 'Scegli quali e quando',
    after: '.',
  },
  calendar: {
    deadline: (task: string, board: string) => `Scadenza: ${task} · ${board}`,
    todo: (board: string) => `To-do · board "${board}" · tutto il giorno`,
    call: (time: string, place: string, wrap: string | null) =>
      [`Conv. ${time}`, place, wrap && `fine prevista ${wrap}`].filter(Boolean).join(' · '),
  },
};

type Texts = typeof it;

const en: Texts = {
  lang: 'en',
  locale: 'en-GB',
  fallback: 'If the button does not work, copy this address into your browser:',
  sentBy: (instance) =>
    instance === 'Inkadra' ? 'Sent by Inkadra.' : `Sent by ${instance} with Inkadra.`,
  join: (parts) =>
    parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : (parts[0] ?? ''),

  releaseSubject: (version) => `Inkadra ${version} news`,
  releaseBadge: (version) => `Version ${version}`,
  releaseTitle: 'What’s new in Inkadra',
  releaseIntro: (instance, version, listed) =>
    listed
      ? `${instance} was updated. Here is what you can do from today.`
      : `${instance} was updated to Inkadra ${version}. The release notes tell what is new.`,
  releaseAction: 'Read release notes',
  releaseFooter: {
    text: 'You turned on Inkadra news in your notifications.',
    link: 'Turn it off here',
    after: ' at any time.',
  },

  security: {
    badge: 'Security alert',
    events: {
      password: {
        title: 'Password changed',
        body: 'The password of your account was changed and your personal access tokens were revoked.',
        after:
          'Don’t recognise this change? Reset your password and contact your administrator straight away.',
      },
      twoFactor: {
        title: 'Two-step verification turned off',
        body: 'Your account no longer asks for a verification code when you sign in.',
        after:
          'Don’t recognise this change? Change your password, turn verification back on and contact your administrator straight away.',
      },
      token: {
        title: 'New access token',
        body: 'A token that can access your account without a password was created.',
        after:
          'Don’t recognise this change? Revoke the token and contact your administrator straight away.',
      },
    },
    subject: (title, instance) => `${title} on ${instance}`,
    preheader: (title, token) =>
      `${token ? `Token “${token}” created` : title}. If this was not you, check now.`,
    token: 'Token',
    when: 'When',
    expires: 'Expires',
    action: 'Review your account',
    footer: (instance) => `Security alert from ${instance}: always sent, it cannot be turned off.`,
  },

  inviteSubject: (who, what) => `${who} invited you to ${what}`,
  inviteIntro: {
    project: 'Sign in or create your account to work on the project with the rest of the team.',
    board: 'Sign in or create your account to work on the board with the rest of the team.',
    instance: 'Sign in or create your account to get started.',
  },
  invitePreheader: (days) =>
    `Sign in or create your account to get started. The invitation is valid for ${plural(days, 'one day', 'days')}.`,
  inviteFacts: { project: 'Project', board: 'Board', role: 'Role', expires: 'Expires' },
  roles: {
    owner: 'Owner: manages the project, its people and boards',
    editor: 'Editor: can create and edit boards',
    commenter: 'Commenter: can view and comment',
    viewer: 'Viewer: can only view',
  },
  inviteAction: 'Open the invitation',
  inviteFooter: 'Not expecting this invitation? You can ignore this email.',

  magicSubject: (instance) => `Your sign-in link for ${instance}`,
  magicTitle: (instance) => `Sign in to ${instance}`,
  magicIntro: 'Use the button to sign in, no password needed.',
  magicNote: { text: 'The link works once, for 15 minutes.', strong: '15 minutes' },
  magicPreheader: 'It works once, for 15 minutes.',
  magicAction: 'Sign in',
  magicFooter: 'Didn’t ask for this link? Ignore this email: nobody can sign in without it.',

  resetSubject: (instance) => `Reset your ${instance} password`,
  resetTitle: 'Choose a new password',
  resetIntro: (instance) =>
    `We received a request to reset the password of your account on ${instance}.`,
  resetPreheader: 'If you didn’t ask for it, your password stays the same.',
  resetAction: 'Choose a new password',
  resetFooter: 'Didn’t ask for it? Ignore this email: your password stays the same.',

  someone: 'Someone',
  guestName: (name) => `${name} (guest)`,
  today: 'Today',
  yesterday: 'Yesterday',
  reviewStatuses: {
    none: 'none',
    in_review: 'in review',
    approved: 'approved',
    changes_requested: 'changes requested',
  },
  verbs: {
    mention: 'mentioned you',
    reply: 'replied in a thread',
    comment: 'commented on one of your cards',
    review: 'changed the review',
    task_assigned: 'assigned you a task',
    invitation_accepted: 'accepted your invitation',
  },
  wrote: 'wrote',
  unknownVerb: 'has something new for you',
  linkOpened: (label) =>
    label
      ? { who: `${label} link`, what: 'was opened by a guest' }
      : { who: 'A guest', what: 'opened a share link' },
  ownExpiring: (where, when) => `Your access to ${where} ends on ${when}`,
  ownExpiringTail: (where) => `your access to ${where} ending soon`,
  ownExpired: { who: 'Your access', what: 'has ended' },
  otherExpiring: (when) => `loses access on ${when}`,
  otherExpired: 'no longer has access',
  counts: {
    mention: (n) => plural(n, 'a mention', 'mentions'),
    reply: (n) => plural(n, 'a reply', 'replies'),
    comment: (n) => plural(n, 'a comment', 'comments'),
    review: (n) => plural(n, 'a review', 'reviews'),
    task_assigned: (n) => plural(n, 'a task', 'tasks'),
  },
  more: 'more to look at',
  singleSubject: (sentence, where) => (where ? `${sentence} on ${where}` : sentence),
  digestTitle: (n, daily) =>
    `${n} ${n === 1 ? 'new thing' : 'new things'}${daily ? ' since yesterday' : ''}`,
  digestSubject: (n, instance, summary) =>
    `${n} new ${n === 1 ? 'thing' : 'things'} on ${instance}${summary ? `: ${summary}` : ''}`,
  replyAction: 'Reply to the comment',
  openBoard: 'Open the board',
  openProject: 'Open the project',
  openInkadra: 'Open Inkadra',
  openInbox: 'Open the inbox',
  open: 'Open',
  notificationFooter: {
    text: (instance) => `You get these emails for notifications on ${instance}.`,
    link: 'Choose which and when',
    after: '.',
  },
  calendar: {
    deadline: (task, board) => `Due: ${task} · ${board}`,
    todo: (board) => `To-do · board "${board}" · all day`,
    call: (time, place, wrap) =>
      [`Call ${time}`, place, wrap && `wrap ${wrap}`].filter(Boolean).join(' · '),
  },
};

const time = (at: Date, locale: string, timeZone?: string) =>
  at.toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
    ...(timeZone ? { timeZone } : {}),
  });

/** A date in the server's zone: "12 novembre 2026", without the year when `year` is false. */
export function mailDate(at: Date, locale: string, timeZone?: string, year = true): string {
  return at.toLocaleDateString(locale, {
    day: 'numeric',
    month: 'long',
    ...(year ? { year: 'numeric' } : {}),
    ...(timeZone ? { timeZone } : {}),
  });
}

/**
 * When access ends, for emails. Accounts keep no time zone, so the time and the zone name
 * (the server's) go with the date: "15 dicembre, 23:59 CET" is unambiguous anywhere.
 */
export function accessWhen(at: Date, locale: string, timeZone?: string): string {
  return `${mailDate(at, locale, timeZone, false)}, ${time(at, locale, timeZone)}`;
}

/** A moment with its year, time and zone: "5 novembre 2026, 18:42 CET". */
export function mailDateTime(at: Date, locale: string, timeZone?: string): string {
  return `${mailDate(at, locale, timeZone)}, ${time(at, locale, timeZone)}`;
}

const dayKey = (at: Date, timeZone?: string) =>
  at.toLocaleDateString('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    ...(timeZone ? { timeZone } : {}),
  });

/** When a notification happened: "Oggi, 18:39 CET", "Ieri, …" or the date, in the server's zone. */
export function rowWhen(at: Date, now: Date, texts: Texts, timeZone?: string): string {
  const day = dayKey(at, timeZone);
  const today = dayKey(now, timeZone);
  const [y, m, d] = today.split('-').map(Number) as [number, number, number];
  const yesterday = new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
  const label =
    day === today
      ? texts.today
      : day === yesterday
        ? texts.yesterday
        : mailDate(at, texts.locale, timeZone, day.slice(0, 4) !== today.slice(0, 4));
  return `${label}, ${time(at, texts.locale, timeZone)}`;
}

export function mailText(who: { locale?: string | null }): Texts {
  return who.locale?.toLowerCase().startsWith('en') ? en : it;
}

export type { Texts as MailTexts };
