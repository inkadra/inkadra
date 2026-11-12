import { type MailTexts, plural } from './it.ts';

export const fr: MailTexts = {
  lang: 'fr',
  locale: 'fr-FR',
  fallback: 'Si le bouton ne fonctionne pas, copiez cette adresse dans votre navigateur :',
  sentBy: (instance) =>
    instance === 'Inkadra' ? 'Envoyé par Inkadra.' : `Envoyé par ${instance} avec Inkadra.`,
  join: (parts) =>
    parts.length > 1 ? `${parts.slice(0, -1).join(', ')} et ${parts.at(-1)}` : (parts[0] ?? ''),

  releaseSubject: (version) => `Nouveautés d’Inkadra ${version}`,
  releaseBadge: (version) => `Version ${version}`,
  releaseTitle: 'Les nouveautés d’Inkadra',
  releaseIntro: (instance, version, listed) =>
    listed
      ? `${instance} a été mis à jour. Voici ce que vous pouvez faire dès aujourd’hui.`
      : `${instance} a été mis à jour vers Inkadra ${version}. Les notes de version présentent les nouveautés.`,
  releaseAction: 'Lire les notes de version',
  releaseFooter: {
    text: 'Vous avez activé les actualités d’Inkadra dans vos notifications.',
    link: 'Désactivez-les ici',
    after: ' à tout moment.',
  },

  security: {
    badge: 'Alerte de sécurité',
    events: {
      password: {
        title: 'Mot de passe modifié',
        body: 'Le mot de passe de votre compte a été modifié et vos jetons d’accès personnels ont été révoqués.',
        after:
          'Vous ne reconnaissez pas cette modification ? Réinitialisez votre mot de passe et contactez immédiatement votre administrateur.',
      },
      twoFactor: {
        title: 'Validation en deux étapes désactivée',
        body: 'Votre compte ne demande plus de code de vérification à la connexion.',
        after:
          'Vous ne reconnaissez pas cette modification ? Changez votre mot de passe, réactivez la vérification et contactez immédiatement votre administrateur.',
      },
      token: {
        title: 'Nouveau jeton d’accès',
        body: 'Un jeton permettant d’accéder à votre compte sans mot de passe a été créé.',
        after:
          'Vous ne reconnaissez pas cette modification ? Révoquez le jeton et contactez immédiatement votre administrateur.',
      },
    },
    subject: (title, instance) => `${title} sur ${instance}`,
    preheader: (title, token) =>
      `${token ? `Jeton « ${token} » créé` : title}. Si ce n’est pas vous, vérifiez maintenant.`,
    token: 'Jeton',
    when: 'Quand',
    expires: 'Expire le',
    action: 'Vérifier votre compte',
    footer: (instance) =>
      `Alerte de sécurité de ${instance} : toujours envoyée, elle ne peut pas être désactivée.`,
  },

  inviteSubject: (who, what) => `${who} vous a invité à ${what}`,
  inviteIntro: {
    project:
      'Connectez-vous ou créez votre compte pour travailler sur le projet avec le reste de l’équipe.',
    board:
      'Connectez-vous ou créez votre compte pour travailler sur le tableau avec le reste de l’équipe.',
    instance: 'Connectez-vous ou créez votre compte pour commencer.',
  },
  invitePreheader: (days) =>
    `Connectez-vous ou créez votre compte pour commencer. L’invitation est valable ${plural(days, 'un jour', 'jours')}.`,
  inviteFacts: { project: 'Projet', board: 'Tableau', role: 'Rôle', expires: 'Expire le' },
  roles: {
    owner: 'Propriétaire : gère le projet, ses membres et ses tableaux',
    editor: 'Éditeur : peut créer et modifier des tableaux',
    commenter: 'Commentateur : peut consulter et commenter',
    viewer: 'Lecteur : peut seulement consulter',
  },
  inviteAction: 'Ouvrir l’invitation',
  inviteFooter: 'Vous n’attendiez pas cette invitation ? Vous pouvez ignorer cet e-mail.',

  magicSubject: (instance) => `Votre lien de connexion à ${instance}`,
  magicTitle: (instance) => `Connexion à ${instance}`,
  magicIntro: 'Utilisez le bouton pour vous connecter, sans mot de passe.',
  magicNote: {
    text: 'Le lien fonctionne une seule fois, pendant 15 minutes.',
    strong: '15 minutes',
  },
  magicPreheader: 'Il fonctionne une seule fois, pendant 15 minutes.',
  magicAction: 'Se connecter',
  magicFooter:
    'Vous n’avez pas demandé ce lien ? Ignorez cet e-mail : personne ne peut se connecter sans lui.',

  resetSubject: (instance) => `Réinitialisez votre mot de passe ${instance}`,
  resetTitle: 'Choisissez un nouveau mot de passe',
  resetIntro: (instance) =>
    `Nous avons reçu une demande de réinitialisation du mot de passe de votre compte sur ${instance}.`,
  resetPreheader:
    'Si vous n’êtes pas à l’origine de cette demande, votre mot de passe ne change pas.',
  resetAction: 'Choisir un nouveau mot de passe',
  resetFooter: 'Vous n’avez rien demandé ? Ignorez cet e-mail : votre mot de passe ne change pas.',

  productionBoard: 'Production',
  someone: 'Quelqu’un',
  guestName: (name) => `${name} (invité)`,
  today: 'Aujourd’hui',
  yesterday: 'Hier',
  reviewStatuses: {
    none: 'aucune',
    in_review: 'en révision',
    approved: 'approuvé',
    changes_requested: 'modifications demandées',
  },
  verbs: {
    mention: 'vous a mentionné',
    reply: 'a répondu dans une discussion',
    comment: 'a commenté l’une de vos cartes',
    review: 'a changé la révision',
    task_assigned: 'vous a attribué une tâche',
    invitation_accepted: 'a accepté votre invitation',
    review_submitted: 'a envoyé sa relecture',
  },
  wrote: 'a écrit',
  unknownVerb: 'a du nouveau pour vous',
  linkOpened: (label) =>
    label
      ? { who: `Le lien ${label}`, what: 'a été ouvert par un invité' }
      : { who: 'Un invité', what: 'a ouvert un lien de partage' },
  ownExpiring: (where, when) => `Votre accès à ${where} prend fin le ${when}`,
  ownExpiringTail: (where) => `votre accès à ${where} qui prend bientôt fin`,
  ownExpired: { who: 'Votre accès', what: 'a pris fin' },
  otherExpiring: (when) => `perd l’accès le ${when}`,
  otherExpired: 'n’a plus accès',
  counts: {
    mention: (n) => plural(n, 'une mention', 'mentions'),
    reply: (n) => plural(n, 'une réponse', 'réponses'),
    comment: (n) => plural(n, 'un commentaire', 'commentaires'),
    review: (n) => plural(n, 'une révision', 'révisions'),
    task_assigned: (n) => plural(n, 'une tâche', 'tâches'),
  },
  more: 'd’autres choses à voir',
  singleSubject: (sentence, where) => (where ? `${sentence} sur ${where}` : sentence),
  digestTitle: (n, daily) =>
    `${n} ${n === 1 ? 'nouveauté' : 'nouveautés'}${daily ? ' depuis hier' : ''}`,
  digestSubject: (n, instance, summary) =>
    `${n} ${n === 1 ? 'nouveauté' : 'nouveautés'} sur ${instance}${summary ? ` : ${summary}` : ''}`,
  replyAction: 'Répondre au commentaire',
  openBoard: 'Ouvrir le tableau',
  openProject: 'Ouvrir le projet',
  openInkadra: 'Ouvrir Inkadra',
  openInbox: 'Ouvrir la réception',
  open: 'Ouvrir',
  notificationFooter: {
    text: (instance) => `Vous recevez ces e-mails pour les notifications sur ${instance}.`,
    link: 'Choisissez lesquels et quand',
    after: '.',
  },
  serverAlert: {
    badge: 'Alerte du serveur',
    subject: (title, instance) => `${title} sur ${instance}`,
    titles: {
      disk_full: 'Presque plus d’espace',
      service_down: 'Un service ne répond pas',
      backup_failed: 'La sauvegarde a échoué',
      repeated_errors: 'Une erreur se répète',
      storage_limit: 'L’instance n’a presque plus d’espace',
      storage_request: 'Plus d’espace demandé',
    },
    disk: (free, total, weeks) =>
      `Il reste ${free} sur ${total}.${weeks ? ` Au rythme actuel, cela suffit pour environ ${weeks}.` : ''} Libérez de l’espace ou ajoutez un disque avant que les envois ne s’arrêtent.`,
    weeks: (n) => plural(n, 'une semaine', 'semaines'),
    storage: (used, total, weeks) =>
      `L’instance utilise ${used} sur ${total}.${weeks ? ` Au rythme actuel, cela suffit pour environ ${weeks}.` : ''} Augmentez la limite ou libérez de l’espace avant que les envois ne s’arrêtent.`,
    storageAction: 'Ouvrir Stockage',
    down: (service) =>
      `${service} ne répond pas. Le reste d’Inkadra fonctionne, mais cette partie est à l’arrêt jusqu’au redémarrage du service.`,
    backup:
      'La sauvegarde de cette nuit a échoué. Vos données sont en sécurité, mais vérifiez avant la prochaine.',
    errors: (n) => `La même erreur s’est produite ${n} fois dans la dernière heure.`,
    services: {
      web: 'Le site et la connexion',
      collab: 'La collaboration en direct',
      worker: 'La préparation des vidéos et des aperçus',
      database: 'La base de données',
      queue: 'La file des tâches',
      configuration: 'La configuration',
    } as Record<string, string>,
    action: 'Ouvrir Serveur',
    footer: (instance) =>
      `Alertes du serveur de ${instance} pour les administrateurs. Modifiables dans Réglages › Serveur.`,
  },
  calendar: {
    deadline: (task, board) => `Échéance : ${task} · ${board}`,
    todo: (board) => `À faire · tableau « ${board} » · toute la journée`,
    call: (time, place, wrap) =>
      [`Convocation ${time}`, place, wrap && `fin ${wrap}`].filter(Boolean).join(' · '),
  },
};
