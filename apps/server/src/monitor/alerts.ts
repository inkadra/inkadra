import {
  DEFAULT_SERVER_ALERTS,
  type ServerAlert,
  ServerAlerts,
  type UpdateServerAlerts,
} from '@inkadra/shared';
import { and, eq, isNull } from 'drizzle-orm';
import type { Logger } from 'pino';
import type { Database } from '../db/client.ts';
import { instanceSetting, notification, user } from '../db/schema.ts';
import type { Mailer } from '../mailer.ts';
import { serverAlertMail } from '../mails.ts';
import type { MonitorStore } from './store.ts';

const KEY = 'server-alerts';

export async function readServerAlerts(db: Pick<Database, 'select'>): Promise<ServerAlerts> {
  const [row] = await db.select().from(instanceSetting).where(eq(instanceSetting.key, KEY));
  const parsed = ServerAlerts.safeParse({ ...DEFAULT_SERVER_ALERTS, ...row?.value });
  return parsed.success ? parsed.data : DEFAULT_SERVER_ALERTS;
}

export async function saveServerAlerts(
  db: Database,
  patch: UpdateServerAlerts,
): Promise<ServerAlerts> {
  const value = { ...(await readServerAlerts(db)), ...patch };
  await db
    .insert(instanceSetting)
    .values({ key: KEY, value })
    .onConflictDoUpdate({ target: instanceSetting.key, set: { value, updatedAt: new Date() } });
  return value;
}

export interface AlertDeps {
  db: Database;
  store: MonitorStore;
  mailer?: Mailer;
  log: Pick<Logger, 'warn'>;
  instanceName: string;
  publicUrl: string;
}

/**
 * Tells every administrator (#514): a notification at most once an hour for the same thing, and
 * for `serious` problems an email too when the administrators asked for one, at most one an hour
 * whatever it is about. Without anyone to tell or alerts turned off, nothing is written.
 */
export async function sendServerAlert(deps: AlertDeps, alert: ServerAlert, serious: boolean) {
  const settings = await readServerAlerts(deps.db);
  if (!settings.enabled) return false;
  if (!(await deps.store.once(`alert:${alert.kind}:${alert.service ?? ''}`, 3600))) return false;
  const admins = await deps.db
    .select({ id: user.id, email: user.email, locale: user.locale })
    .from(user)
    .where(and(eq(user.role, 'admin'), isNull(user.deactivatedAt)));
  if (!admins.length) return false;
  await deps.db.insert(notification).values(
    admins.map((a) => ({
      userId: a.id,
      type: 'server_alert' as const,
      serverAlert: alert,
      // In-app: the email, when there is one, is this module's own.
      emailedAt: new Date(),
    })),
  );
  if (serious && settings.email && deps.mailer && (await deps.store.once('alert-mail', 3600)))
    for (const admin of admins)
      await deps.mailer
        .send(serverAlertMail(admin, alert, deps))
        .catch((err) => deps.log.warn({ err }, 'server alert email not sent'));
  return true;
}
