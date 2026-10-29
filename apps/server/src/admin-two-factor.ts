import { eq } from 'drizzle-orm';
import type { Database } from './db/client.ts';
import { instanceSetting, user } from './db/schema.ts';
import { HttpError } from './http/errors.ts';

/** Read the existing JSON store without depending on the settings contract follow-up. */
export async function adminEnrollmentRequired(db: Database, id: string): Promise<boolean> {
  const [owner] = await db.select().from(user).where(eq(user.id, id));
  if (owner?.role !== 'admin' || owner.twoFactorEnabled) return false;
  const [settings] = await db.select().from(instanceSetting).where(eq(instanceSetting.key, 'administration'));
  return settings?.value?.requireAdminTwoFactor === true;
}

export async function enforceAdminTwoFactor(db: Database, id: string) {
  if (await adminEnrollmentRequired(db, id))
    throw new HttpError('forbidden', 'Set up two-step verification to continue.', {
      reason: 'admin_two_factor_required',
    });
}
