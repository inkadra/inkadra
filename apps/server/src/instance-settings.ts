import { InstanceSettings } from '@inkadra/shared';
import { eq } from 'drizzle-orm';
import type { Config } from './config.ts';
import type { Database } from './db/client.ts';
import { instanceSetting } from './db/schema.ts';

/** Persisted administrator choices override installation defaults without a restart. */
export async function readInstanceSettings(
  db: Pick<Database, 'select'>,
  config: Config,
): Promise<InstanceSettings> {
  const [row] = await db
    .select()
    .from(instanceSetting)
    .where(eq(instanceSetting.key, 'administration'));
  return InstanceSettings.parse({
    name: config.INSTANCE_NAME,
    registration: config.REGISTRATION,
    ...row?.value,
  });
}
