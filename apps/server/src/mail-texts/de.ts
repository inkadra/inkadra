import { type MailTexts, plural } from './it.ts';

export const de: MailTexts = {
  lang: 'de',
  locale: 'de-DE',
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
