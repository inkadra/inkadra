import { type MailTexts, plural } from './it.ts';

export const de: MailTexts = {
  lang: 'de',
  locale: 'de-DE',
  fallback: 'Wenn die Schaltfläche nicht funktioniert, kopiere diese Adresse in deinen Browser:',
  sentBy: (instance) =>
    instance === 'Inkadra' ? 'Gesendet von Inkadra.' : `Gesendet von ${instance} mit Inkadra.`,
  join: (parts) =>
    parts.length > 1 ? `${parts.slice(0, -1).join(', ')} und ${parts.at(-1)}` : (parts[0] ?? ''),

  releaseSubject: (version) => `Neuigkeiten in Inkadra ${version}`,
  releaseBadge: (version) => `Version ${version}`,
  releaseTitle: 'Neu in Inkadra',
  releaseIntro: (instance, version, listed) =>
    listed
      ? `${instance} wurde aktualisiert. Das kannst du ab heute tun.`
      : `${instance} wurde auf Inkadra ${version} aktualisiert. Die Versionshinweise erklären, was neu ist.`,
  releaseAction: 'Versionshinweise lesen',
  releaseFooter: {
    text: 'Du hast Inkadra-Neuigkeiten in deinen Benachrichtigungen aktiviert.',
    link: 'Hier deaktivieren',
    after: ', wann immer du willst.',
  },

  security: {
    badge: 'Sicherheitshinweis',
    events: {
      password: {
        title: 'Passwort geändert',
        body: 'Das Passwort deines Kontos wurde geändert und deine persönlichen Zugriffstokens wurden widerrufen.',
        after:
          'Du erkennst diese Änderung nicht? Setze dein Passwort zurück und kontaktiere sofort deinen Admin.',
      },
      twoFactor: {
        title: 'Zwei-Faktor-Anmeldung deaktiviert',
        body: 'Dein Konto fragt bei der Anmeldung nicht mehr nach einem Bestätigungscode.',
        after:
          'Du erkennst diese Änderung nicht? Ändere dein Passwort, aktiviere die Bestätigung wieder und kontaktiere sofort deinen Admin.',
      },
      token: {
        title: 'Neues Zugriffstoken',
        body: 'Für dein Konto wurde ein Token erstellt, das den Zugriff ohne Passwort erlaubt.',
        after:
          'Du erkennst diese Änderung nicht? Widerrufe das Token und kontaktiere sofort deinen Admin.',
      },
    },
    subject: (title, instance) => `${title} bei ${instance}`,
    preheader: (title, token) =>
      `${token ? `Token „${token}“ erstellt` : title}. Warst du das nicht? Prüfe es sofort.`,
    token: 'Token',
    when: 'Wann',
    expires: 'Läuft ab',
    action: 'Dein Konto prüfen',
    footer: (instance) =>
      `Sicherheitshinweis von ${instance}: wird immer gesendet und lässt sich nicht deaktivieren.`,
  },

  inviteSubject: (who, what) => `${who} hat dich zu ${what} eingeladen`,
  inviteIntro: {
    project:
      'Melde dich an oder erstelle dein Konto, um mit dem restlichen Team am Projekt zu arbeiten.',
    board:
      'Melde dich an oder erstelle dein Konto, um mit dem restlichen Team am Board zu arbeiten.',
    instance: 'Melde dich an oder erstelle dein Konto, um loszulegen.',
  },
  invitePreheader: (days) =>
    `Melde dich an oder erstelle dein Konto, um loszulegen. Die Einladung gilt ${plural(days, 'einen Tag', 'Tage')}.`,
  inviteFacts: { project: 'Projekt', board: 'Board', role: 'Rolle', expires: 'Läuft ab' },
  roles: {
    owner: 'Inhaber: verwaltet das Projekt, seine Personen und Boards',
    editor: 'Bearbeiter: kann Boards erstellen und bearbeiten',
    commenter: 'Kommentator: kann ansehen und kommentieren',
    viewer: 'Betrachter: kann nur ansehen',
  },
  inviteAction: 'Einladung öffnen',
  inviteFooter: 'Du hast diese Einladung nicht erwartet? Du kannst diese E-Mail ignorieren.',

  magicSubject: (instance) => `Dein Anmeldelink für ${instance}`,
  magicTitle: (instance) => `Bei ${instance} anmelden`,
  magicIntro: 'Melde dich über die Schaltfläche an, ganz ohne Passwort.',
  magicNote: { text: 'Der Link gilt 15 Minuten und nur einmal.', strong: '15 Minuten' },
  magicPreheader: 'Gilt 15 Minuten und nur einmal.',
  magicAction: 'Anmelden',
  magicFooter:
    'Du hast diesen Link nicht angefordert? Ignoriere diese E-Mail: Ohne ihn kann sich niemand anmelden.',

  resetSubject: (instance) => `Passwort für ${instance} zurücksetzen`,
  resetTitle: 'Neues Passwort wählen',
  resetIntro: (instance) =>
    `Wir haben eine Anfrage erhalten, das Passwort deines Kontos bei ${instance} zurückzusetzen.`,
  resetPreheader: 'Wenn du das nicht angefordert hast, bleibt dein Passwort unverändert.',
  resetAction: 'Neues Passwort wählen',
  resetFooter: 'Nicht angefordert? Ignoriere diese E-Mail: Dein Passwort bleibt unverändert.',

  someone: 'Jemand',
  guestName: (name) => `${name} (Gast)`,
  today: 'Heute',
  yesterday: 'Gestern',
  reviewStatuses: {
    none: 'keiner',
    in_review: 'im Review',
    approved: 'freigegeben',
    changes_requested: 'Änderungen angefragt',
  },
  verbs: {
    mention: 'hat dich erwähnt',
    reply: 'hat in einer Diskussion geantwortet',
    comment: 'hat eine deiner Karten kommentiert',
    review: 'hat das Review geändert',
    task_assigned: 'hat dir eine Aufgabe zugewiesen',
    invitation_accepted: 'hat deine Einladung angenommen',
  },
  wrote: 'schrieb',
  unknownVerb: 'hat etwas Neues für dich',
  linkOpened: (label) =>
    label
      ? { who: `Link ${label}`, what: 'wurde von einem Gast geöffnet' }
      : { who: 'Ein Gast', what: 'hat einen Freigabelink geöffnet' },
  ownExpiring: (where, when) => `Dein Zugriff auf ${where} endet am ${when}`,
  ownExpiringTail: (where) => `dein Zugriff auf ${where}, der bald endet`,
  ownExpired: { who: 'Dein Zugriff', what: 'ist beendet' },
  otherExpiring: (when) => `verliert am ${when} den Zugriff`,
  otherExpired: 'hat keinen Zugriff mehr',
  counts: {
    mention: (n) => plural(n, 'eine Erwähnung', 'Erwähnungen'),
    reply: (n) => plural(n, 'eine Antwort', 'Antworten'),
    comment: (n) => plural(n, 'ein Kommentar', 'Kommentare'),
    review: (n) => plural(n, 'ein Review', 'Reviews'),
    task_assigned: (n) => plural(n, 'eine Aufgabe', 'Aufgaben'),
  },
  more: 'weitere Neuigkeiten',
  singleSubject: (sentence, where) => (where ? `${sentence}: ${where}` : sentence),
  digestTitle: (n, daily) =>
    `${n} ${n === 1 ? 'Neuigkeit' : 'Neuigkeiten'}${daily ? ' seit gestern' : ''}`,
  digestSubject: (n, instance, summary) =>
    `${n} ${n === 1 ? 'Neuigkeit' : 'Neuigkeiten'} bei ${instance}${summary ? `: ${summary}` : ''}`,
  replyAction: 'Auf den Kommentar antworten',
  openBoard: 'Board öffnen',
  openProject: 'Projekt öffnen',
  openInkadra: 'Inkadra öffnen',
  openInbox: 'Inbox öffnen',
  open: 'Öffnen',
  notificationFooter: {
    text: (instance) => `Du erhältst diese E-Mails für Benachrichtigungen von ${instance}.`,
    link: 'Wähle, welche und wann',
    after: '.',
  },
  calendar: {
    deadline: (task, board) => `Fällig: ${task} · ${board}`,
    todo: (board) => `To-do · Board „${board}“ · ganztägig`,
    call: (time, place, wrap) =>
      [`Call ${time}`, place, wrap && `Drehschluss ${wrap}`].filter(Boolean).join(' · '),
  },
};
