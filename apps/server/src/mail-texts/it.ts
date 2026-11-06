/**
 * Italian, the reference language of the emails: the other files in this folder have this shape.
 * Every string is plain text: mail-layout.ts escapes it.
 */

/** "l’8 novembre" but "il 15 novembre": the article before an Italian date. */
const il = (date: string) => (/^(1|8|11)\D/.test(date) ? 'l’' : 'il ');

export const plural = (n: number, one: string, many: string) => (n === 1 ? one : `${n} ${many}`);

export const it = {
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

export type MailTexts = typeof it;
