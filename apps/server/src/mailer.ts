import { createTransport } from 'nodemailer';
import type { Logger } from 'pino';
import type { Config } from './config.ts';
import { type SecurityEvent, securityMail } from './mails.ts';

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

/** SMTP never delays an auth response; delivery errors cannot expose account existence. */
export function sendDetached(mailer: Mailer | undefined, mail: Mail, log?: Pick<Logger, 'warn'>) {
  if (!mailer?.enabled) return;
  void Promise.resolve()
    .then(() => mailer.send(mail))
    .catch(() => log?.warn('security email delivery failed'));
}

/** Sent for every security change, detached so an auth response never waits for SMTP. */
export function securityNotification(
  mailer: Mailer | undefined,
  user: { email: string; locale?: string | null },
  event: SecurityEvent,
  instance: Parameters<typeof securityMail>[2],
  log?: Pick<Logger, 'warn'>,
) {
  if (!mailer?.enabled) return;
  sendDetached(mailer, securityMail(user, event, instance), log);
}
