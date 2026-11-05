/**
 * Every email the server sends, as content for the shared layout (mail-layout.ts).
 * Builders are pure: the callers decide when and how to send.
 */
import { type Notification, notificationPath } from '@inkadra/shared';
import { type Chip, type MailContent, type MailRow, renderMail } from './mail-layout.ts';
import {
  accessWhen,
  type MailTexts,
  mailDate,
  mailDateTime,
  mailText,
  rowWhen,
} from './mail-texts.ts';
import type { Mail } from './mailer.ts';

type Locale = { locale?: string | null };
export interface MailInstance {
  instanceName: string;
  publicUrl: string;
}

export function inviteMail(input: {
  to: string;
  from: Locale;
  who: string;
  projectName: string | null;
  boardTitle: string | null;
  /** Null for an invitation to the instance. */
  role: string | null;
  expiresAt: Date;
  url: string;
  instanceName: string;
  now?: Date;
  timeZone?: string;
}): Mail {
  const t = mailText(input.from);
  const { who, projectName, boardTitle, role, instanceName } = input;
  const what = boardTitle ?? projectName ?? instanceName;
  const target = !role ? 'instance' : boardTitle ? 'board' : 'project';
  const days = Math.max(
    1,
    Math.round((input.expiresAt.getTime() - (input.now ?? new Date()).getTime()) / 86_400_000),
  );
  const facts: Array<[string, string]> = [];
  if (role) {
    if (projectName) facts.push([t.inviteFacts.project, projectName]);
    if (boardTitle) facts.push([t.inviteFacts.board, boardTitle]);
    facts.push([t.inviteFacts.role, t.roles[role] ?? role]);
  }
  facts.push([t.inviteFacts.expires, mailDate(input.expiresAt, t.locale, input.timeZone)]);
  return renderMail({
    to: input.to,
    subject: t.inviteSubject(who, what),
    lang: t.lang,
    instanceName,
    preheader: t.invitePreheader(days),
    title: t.inviteSubject(who, what),
    intro: t.inviteIntro[target],
    facts,
    action: { label: t.inviteAction, url: input.url },
    fallback: t.fallback,
    footer: { text: `${t.inviteFooter} ${t.sentBy(instanceName)}` },
  });
}

export function magicLinkMail(to: string, who: Locale, url: string, instanceName: string): Mail {
  const t = mailText(who);
  return renderMail({
    to,
    subject: t.magicSubject(instanceName),
    lang: t.lang,
    instanceName,
    preheader: t.magicPreheader,
    title: t.magicTitle(instanceName),
    intro: t.magicIntro,
    action: { label: t.magicAction, url },
    note: t.magicNote,
    fallback: t.fallback,
    footer: { text: `${t.magicFooter} ${t.sentBy(instanceName)}` },
  });
}

export function resetMail(to: string, who: Locale, url: string, instanceName: string): Mail {
  const t = mailText(who);
  return renderMail({
    to,
    subject: t.resetSubject(instanceName),
    lang: t.lang,
    instanceName,
    preheader: t.resetPreheader,
    title: t.resetTitle,
    intro: t.resetIntro(instanceName),
    action: { label: t.resetAction, url },
    fallback: t.fallback,
    footer: { text: `${t.resetFooter} ${t.sentBy(instanceName)}` },
  });
}

export type SecurityEvent = 'password' | 'twoFactor' | 'token';

/** No device or address: the email says what changed and when, not from where. */
export function securityMail(
  user: { email: string; locale?: string | null },
  event: SecurityEvent,
  instance: MailInstance & { token?: { name: string; expiresAt: Date | null } },
  at = new Date(),
  timeZone?: string,
): Mail {
  const t = mailText(user);
  const e = t.security.events[event];
  const token = event === 'token' ? instance.token : undefined;
  const facts: Array<[string, string]> = [];
  if (token) facts.push([t.security.token, token.name]);
  facts.push([t.security.when, mailDateTime(at, t.locale, timeZone)]);
  if (token?.expiresAt)
    facts.push([t.security.expires, mailDate(token.expiresAt, t.locale, timeZone)]);
  return renderMail({
    to: user.email,
    subject: t.security.subject(e.title, instance.instanceName),
    lang: t.lang,
    instanceName: instance.instanceName,
    preheader: t.security.preheader(e.title, token?.name ?? null),
    badge: { label: t.security.badge, tone: 'danger' },
    title: e.title,
    intro: e.body,
    facts,
    action: { label: t.security.action, url: `${instance.publicUrl}/settings?section=account` },
    note: { text: e.after },
    footer: { text: t.security.footer(instance.instanceName) },
  });
}

const COMMENTS = new Set(['mention', 'reply', 'comment']);

/** One notification, as the layout shows it; `banner` for the recipient's own access ending. */
interface Item {
  type: string;
  where: string;
  row: MailRow;
  /** The whole sentence, for the title and subject of a single notification. */
  sentence: string;
  banner?: string;
}

function reviewChip(t: MailTexts, status: string | null): Chip | null {
  if (!status) return null;
  const label = t.reviewStatuses[status] ?? status;
  if (status === 'approved') return { label, tone: 'ok' };
  if (status === 'changes_requested') return { label, tone: 'warn' };
  return { label, tone: 'neutral' };
}

function item(
  t: MailTexts,
  n: Notification,
  me: string,
  base: string,
  now: Date,
  timeZone?: string,
): Item {
  const where = n.boardTitle ?? n.projectName ?? '';
  const path = notificationPath(n);
  const row = {
    when: rowWhen(new Date(n.createdAt), now, t, timeZone),
    link: path ? { label: t.open, url: `${base}${path}` } : null,
  };
  const made = (who: string, what: string, extra: Partial<MailRow> = {}): Item => ({
    type: n.type,
    where,
    row: { who, what, ...row, ...extra },
    sentence: `${who} ${what}`,
  });
  if (n.type === 'access_expiring' || n.type === 'access_expired') {
    const mine = !n.subject || n.subject.id === me;
    const when = n.accessExpiresAt ? accessWhen(new Date(n.accessExpiresAt), t.locale, timeZone) : '';
    if (mine && n.type === 'access_expiring') {
      const sentence = t.ownExpiring(where, when);
      return { ...made(t.ownExpired.who, sentence), sentence, banner: sentence };
    }
    if (mine) return made(t.ownExpired.who, t.ownExpired.what);
    const who = n.subject?.name ?? t.someone;
    return made(who, n.type === 'access_expiring' ? t.otherExpiring(when) : t.otherExpired);
  }
  if (n.type === 'link_opened') {
    const { who, what } = t.linkOpened(n.shareLinkLabel ?? null);
    return made(who, what);
  }
  const who =
    n.actor?.kind === 'user'
      ? n.actor.user.name
      : n.actor?.kind === 'guest'
        ? t.guestName(n.actor.name)
        : t.someone;
  return made(who, t.verbs[n.type] ?? t.unknownVerb, {
    chip: n.type === 'review' ? reviewChip(t, n.reviewStatus) : null,
    quote: COMMENTS.has(n.type) ? n.excerpt : null,
  });
}

/** "Una menzione, 2 revisioni": the counted kinds, in a fixed order. */
function summaryParts(t: MailTexts, items: Item[]) {
  return Object.entries(t.counts).flatMap(([type, count]) => {
    const n = items.filter((i) => i.type === type).length;
    return n ? [count(n)] : [];
  });
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The email for pending notifications: one notification gets its own title and button; more
 * are grouped by board, each with a link to the card and thread. `daily` is the digest.
 */
export function notificationMail(input: {
  to: string;
  recipient: { id: string; locale?: string | null };
  notifications: Notification[];
  daily: boolean;
  instance: MailInstance;
  now?: Date;
  timeZone?: string;
}): Mail {
  const t = mailText(input.recipient);
  const { instanceName, publicUrl } = input.instance;
  const now = input.now ?? new Date();
  const items = input.notifications.map((n) =>
    item(t, n, input.recipient.id, publicUrl, now, input.timeZone),
  );
  const settingsUrl = `${publicUrl}/settings?section=notifications`;
  const base = {
    to: input.to,
    lang: t.lang,
    instanceName,
    footer: {
      text: t.notificationFooter.text(instanceName),
      link: { label: t.notificationFooter.link, url: settingsUrl },
      after: t.notificationFooter.after,
    },
  };
  const [only] = items;
  if (items.length === 1 && only) {
    const n = input.notifications[0] as Notification;
    const path = notificationPath(n);
    const label = COMMENTS.has(n.type)
      ? t.replyAction
      : n.boardId
        ? t.openBoard
        : n.projectId
          ? t.openProject
          : t.openInkadra;
    const heading = [n.boardTitle, n.projectName].filter(Boolean).join(' · ');
    const content: MailContent = {
      ...base,
      subject: only.banner ?? t.singleSubject(only.sentence, only.where),
      preheader: n.excerpt ?? only.sentence,
      title: only.banner ?? only.sentence,
      ...(heading ? { intro: heading } : {}),
      ...(only.banner
        ? {}
        : {
            row: {
              ...only.row,
              link: null,
              ...(only.row.quote ? { what: t.wrote } : {}),
            },
          }),
      action: { label, url: `${publicUrl}${path ?? '/'}` },
    };
    return renderMail(content);
  }
  const banners = items.flatMap((i) => (i.banner ? [i.banner] : []));
  const listed = items.filter((i) => !i.banner);
  const groups = new Map<string, { title: string; rows: MailRow[] }>();
  input.notifications.forEach((n, index) => {
    const it = items[index];
    if (!it || it.banner) return;
    const key = n.boardId ?? (n.projectId ? `p:${n.projectId}` : '');
    const title = [n.boardTitle, n.projectName].filter(Boolean).join(' · ') || instanceName;
    const group = groups.get(key) ?? { title, rows: [] };
    group.rows.push(it.row);
    groups.set(key, group);
  });
  const parts = summaryParts(t, items);
  const others = listed.some((i) => !(i.type in t.counts));
  const ownEnding = items.find((i) => i.banner);
  const summary = (tail: string | null) =>
    parts.length || tail ? `${capital(t.join(tail ? [...parts, tail] : parts))}.` : '';
  const intro = summary(others || ownEnding ? t.more : null);
  return renderMail({
    ...base,
    subject: t.digestSubject(items.length, instanceName, parts.slice(0, 2).join(', ')),
    preheader:
      summary(ownEnding ? t.ownExpiringTail(ownEnding.where) : others ? t.more : null) ||
      (items[0]?.sentence ?? ''),
    title: t.digestTitle(items.length, input.daily),
    ...(intro ? { intro } : {}),
    banners,
    groups: [...groups.values()],
    action: { label: t.openInbox, url: `${publicUrl}/` },
  });
}
