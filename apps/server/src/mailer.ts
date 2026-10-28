import { createTransport } from 'nodemailer';
import type { Logger } from 'pino';
import { mailText } from './mail-texts.ts';
import type { Config } from './config.ts';

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
): Mail {
  const text = [...lines, '', `${action.label}: ${action.url}`].join('\n');
  const html = [
    '<div style="font-family:Inter,system-ui,sans-serif;font-size:14px;line-height:1.5;color:#141416">',
    ...lines.map((l) => `<p style="margin:0 0 12px">${esc(l)}</p>`),
    `<p style="margin:20px 0"><a href="${esc(action.url)}" style="display:inline-block;padding:10px 16px;border-radius:8px;background:#2563EB;color:#FFFFFF;text-decoration:none;font-weight:500">${esc(action.label)}</a></p>`,
    `<p style="margin:0;color:#6E6E73;font-size:12px">${esc(action.url)}</p>`,
    '</div>',
  ].join('');
  return { to, subject, text, html };
}

/** SMTP never delays an auth response; delivery errors cannot expose account existence. */
export function sendDetached(mailer: Mailer | undefined, mail: Mail, log?: Pick<Logger, 'warn'>) {
  if (!mailer?.enabled) return;
  void Promise.resolve().then(() => mailer.send(mail)).catch(() => log?.warn('security email delivery failed'));
}

export function securityNotification(mailer: Mailer | undefined, user: { email: string; locale?: string | null }, event: 'password' | 'twoFactor' | 'token', log?: Pick<Logger, 'warn'>) {
  const t = mailText(user);
  sendDetached(mailer, { to: user.email, subject: t.securitySubjects[event], text: t.securityNotice }, log);
}
