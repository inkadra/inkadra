import { createTransport } from 'nodemailer';
import type { Logger } from 'pino';
import type { Config } from './config.ts';
import { mailText } from './mail-texts.ts';

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface Mailer {
  readonly enabled: boolean;
  send(mail: Mail): Promise<void>;
}

export const noMailer: Mailer = {
  enabled: false,
  async send() {
    throw new Error('Email is not configured (SMTP_URL).');
  },
};

/** SMTP from SMTP_URL, or a mailer that is off. */
export function createMailer(config: Config, log: Logger): Mailer {
  if (!config.SMTP_URL || !config.MAIL_FROM) return noMailer;
  const transport = createTransport(config.SMTP_URL);
  const from = config.MAIL_FROM;
  return {
    enabled: true,
    async send(mail) {
      await transport.sendMail({ from, ...mail });
      log.info({ to: mail.to.replace(/^(.).*(@.*)$/, '$1…$2') }, 'email sent');
    },
  };
}

/** Collects mail in memory, for tests. */
export function memoryMailer(): Mailer & { sent: Mail[] } {
  const sent: Mail[] = [];
  return {
    enabled: true,
    sent,
    async send(mail) {
      sent.push(mail);
    },
  };
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** A short message with one button, in plain text and simple HTML. */
export function actionMail(
  to: string,
  subject: string,
  lines: string[],
  action: { label: string; url: string },
  layout: {
    instanceName?: string;
    highlights?: { title: string; items: string[] };
    footer?: { text: string; label: string; url: string };
  } = {},
): Mail {
  const instanceName = layout.instanceName ?? 'Inkadra';
  const { highlights, footer } = layout;
  const text = [
    instanceName,
    '',
    ...lines,
    ...(highlights?.items.length
      ? ['', highlights.title, ...highlights.items.map((item) => `• ${item}`)]
      : []),
    '',
    `${action.label}: ${action.url}`,
    ...(footer ? ['', footer.text, `${footer.label}: ${footer.url}`] : []),
  ].join('\n');
  const html = [
    '<div style="font-family:Inter,system-ui,sans-serif;font-size:14px;line-height:1.6;color:#141416;max-width:560px;margin:0 auto;padding:24px">',
    '<header style="border-bottom:1px solid #E5E5E7;padding-bottom:20px;margin-bottom:24px">',
    '<strong style="font-size:20px;letter-spacing:-0.5px">Inkadra</strong>',
    ...(instanceName !== 'Inkadra'
      ? [`<div style="color:#6E6E73;font-size:13px">${esc(instanceName)}</div>`]
      : []),
    '</header>',
    ...lines.map((l) => `<p style="margin:0 0 12px">${esc(l)}</p>`),
    ...(highlights?.items.length
      ? [
          `<h2 style="font-size:16px;margin:24px 0 12px">${esc(highlights.title)}</h2>`,
          '<ul style="padding-left:22px;margin:0 0 20px">',
          ...highlights.items.map((item) => `<li style="margin-bottom:8px">${esc(item)}</li>`),
          '</ul>',
        ]
      : []),
    `<p style="margin:24px 0"><a href="${esc(action.url)}" style="display:inline-block;padding:10px 16px;border-radius:8px;background:#2563EB;color:#FFFFFF;text-decoration:none;font-weight:500">${esc(action.label)}</a></p>`,
    `<p style="margin:0;color:#6E6E73;font-size:12px;overflow-wrap:anywhere">${esc(action.url)}</p>`,
    ...(footer
      ? [
          '<footer style="border-top:1px solid #E5E5E7;margin-top:28px;padding-top:16px;color:#6E6E73;font-size:12px">',
          `<p style="margin:0 0 8px">${esc(footer.text)}</p>`,
          `<a href="${esc(footer.url)}" style="color:#2563EB">${esc(footer.label)}</a>`,
          '</footer>',
        ]
      : []),
    '</div>',
  ].join('');
  return { to, subject, text, html };
}

/** SMTP never delays an auth response; delivery errors cannot expose account existence. */
export function sendDetached(mailer: Mailer | undefined, mail: Mail, log?: Pick<Logger, 'warn'>) {
  if (!mailer?.enabled) return;
  void Promise.resolve()
    .then(() => mailer.send(mail))
    .catch(() => log?.warn('security email delivery failed'));
}

export function securityNotification(
  mailer: Mailer | undefined,
  user: { email: string; locale?: string | null },
  event: 'password' | 'twoFactor' | 'token',
  log?: Pick<Logger, 'warn'>,
) {
  const t = mailText(user);
  sendDetached(
    mailer,
    { to: user.email, subject: t.securitySubjects[event], text: t.securityNotice },
    log,
  );
}
