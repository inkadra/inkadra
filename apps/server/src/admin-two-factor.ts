import { eq, sql } from 'drizzle-orm';
import type { Database } from './db/client.ts';
import { instanceSetting } from './db/schema.ts';
import { HttpError } from './http/errors.ts';

/** Read the existing JSON store without depending on the settings contract follow-up. */
export async function adminEnrollmentRequired(
  db: Pick<Database, 'select'>,
  owner: { role: string; twoFactorEnabled: boolean | null },
): Promise<boolean> {
  if (owner?.role !== 'admin' || owner.twoFactorEnabled) return false;
  const [settings] = await db
    .select()
    .from(instanceSetting)
    .where(eq(instanceSetting.key, 'administration'));
  return settings?.value?.requireAdminTwoFactor === true;
}

export async function enforceAdminTwoFactor(
  db: Pick<Database, 'select'>,
  owner: { role: string; twoFactorEnabled: boolean | null },
) {
  if (await adminEnrollmentRequired(db, owner))
    throw new HttpError('forbidden', 'Set up two-step verification to continue.', {
      reason: 'admin_two_factor_required',
    });
}

/** Host/container recovery only. Preserve all unrelated instance settings atomically. */
export async function disableAdminTwoFactor(db: Pick<Database, 'update'>) {
  await db
    .update(instanceSetting)
    .set({
      value: sql`${instanceSetting.value} || '{"requireAdminTwoFactor":false}'::jsonb`,
      updatedAt: new Date(),
    })
    .where(eq(instanceSetting.key, 'administration'));
}
