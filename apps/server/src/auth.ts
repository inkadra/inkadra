import { APIError, betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { and, count, eq, lt, sql } from 'drizzle-orm';
import type { Config } from './config.ts';
import type { Database } from './db/client.ts';
import * as schema from './db/schema.ts';

/** Internal header carrying the client address from the HTTP layer to Better Auth. */
export const CLIENT_IP_HEADER = 'x-inkadra-client-ip';

export async function countUsers(db: Database): Promise<number> {
  const [row] = await db.select({ n: count() }).from(schema.user);
  return row?.n ?? 0;
}

/**
 * Atomically claims the first-run setup: exactly one sign-up gets `true`, even when several
 * arrive at once. If the claiming sign-up failed before creating its user, the claim goes
 * stale after a minute and the next sign-up on the still-empty instance can take it over.
 */
async function claimSetup(db: Database): Promise<boolean> {
  const value = { claimedAt: new Date().toISOString() };
  const claimed = await db
    .insert(schema.instanceSetting)
    .values({ key: 'setup', value })
    .onConflictDoNothing()
    .returning({ key: schema.instanceSetting.key });
  if (claimed.length > 0) return true;
  if ((await countUsers(db)) > 0) return false;
  const retaken = await db
    .update(schema.instanceSetting)
    .set({ value })
    .where(
      and(
        eq(schema.instanceSetting.key, 'setup'),
        lt(schema.instanceSetting.updatedAt, sql`now() - interval '1 minute'`),
      ),
    )
    .returning({ key: schema.instanceSetting.key });
  return retaken.length > 0;
}

export function createAuth(config: Config, db: Database) {
  return betterAuth({
    appName: config.INSTANCE_NAME,
    baseURL: config.PUBLIC_URL,
    basePath: '/api/auth',
    secret: config.AUTH_SECRET,
    trustedOrigins: [config.PUBLIC_URL],
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
      },
    }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      autoSignIn: true,
    },
    user: {
      additionalFields: {
        role: { type: 'string', required: false, defaultValue: 'member', input: false },
        // Set through PATCH /api/v1/me, which validates it.
        locale: { type: 'string', required: false, input: false },
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
    },
    advanced: {
      cookiePrefix: 'inkadra',
      database: { generateId: 'uuid' },
      // The HTTP bridge puts Fastify's client address (which honours TRUST_PROXY) in this header
      // and drops any copy sent by the client, so rate limits cannot be dodged with X-Forwarded-For.
      ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
    },
    telemetry: { enabled: false },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            // The first account of an instance is its administrator. After that,
            // sign-up is closed unless REGISTRATION=open (invitations arrive in wave 2).
            if (await claimSetup(db)) return { data: { ...user, role: 'admin' } };
            if (config.REGISTRATION !== 'open') {
              throw new APIError('FORBIDDEN', {
                code: 'REGISTRATION_CLOSED',
                message: 'Registration is closed. Ask an administrator for an invitation.',
              });
            }
            return { data: { ...user, role: 'member' } };
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
