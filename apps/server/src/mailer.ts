import { createTransport } from 'nodemailer';
import type { Logger } from 'pino';
import type { Config } from './config.ts';
import { type SecurityEvent, securityMail } from './mails.ts';

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** The same id for the same content sent again (#812). */
  messageId?: string;
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

/** `name@example.com` as `n…@example.com`, the way every mail log line shows an address. */
export const maskAddress = (address: string) => address.replace(/^(.).*(@.*)$/, '$1…$2');

/**
 * A delivery failure that is safe to log: the cause (`code`, `responseCode`, `command`) and the
 * message, with every address masked (an SMTP server often echoes the recipient). Nodemailer's
 * own error also carries the full `response`, `rejected` and the transport, so it is not kept.
 */
export class MailError extends Error {
  code: string | undefined;
  responseCode: number | undefined;
  command: string | undefined;
  constructor(cause: unknown) {
    const e = (cause ?? {}) as Record<string, unknown>;
    const raw = cause instanceof Error ? cause.message : String(cause);
    super(raw.replace(/[^\s<>"',;]+@[^\s<>"',;]+/g, maskAddress));
    this.name = 'MailError';
    if (typeof e.code === 'string') this.code = e.code;
    if (typeof e.responseCode === 'number') this.responseCode = e.responseCode;
    if (typeof e.command === 'string') this.command = e.command;
  }
}

/**
 * SMTP_URL with timeouts of 30 seconds unless it sets its own (#812): Nodemailer's defaults
 * wait up to 10 minutes on a silent server, holding the single email worker. Pooled, at most
 * two connections: the email jobs send to several people at once, and small relays and Gmail
 * refuse more connections (`421 too many connections`).
 */
export function smtpUrl(url: string): string {
  const parsed = new URL(url);
  const defaults = {
    connectionTimeout: '30000',
    greetingTimeout: '30000',
    socketTimeout: '30000',
    pool: 'true',
    maxConnections: '2',
  };
  for (const [option, value] of Object.entries(defaults))
    if (!parsed.searchParams.has(option)) parsed.searchParams.set(option, value);
  return parsed.toString();
}

/** SMTP from SMTP_URL, or a mailer that is off. */
export function createMailer(config: Config, log: Logger): Mailer {
  if (!config.SMTP_URL || !config.MAIL_FROM) return noMailer;
  const transport = createTransport(smtpUrl(config.SMTP_URL));
  const from = config.MAIL_FROM;
  return {
    enabled: true,
    async send(mail) {
      try {
        await transport.sendMail({ from, ...mail });
      } catch (err) {
        throw new MailError(err);
      }
      log.info({ to: maskAddress(mail.to) }, 'email sent');
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
    .catch((err) => log?.warn({ err }, 'security email delivery failed'));
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
