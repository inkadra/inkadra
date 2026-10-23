import { APIError, betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { count } from 'drizzle-orm';
import type { Config } from './config.ts';
import type { Database } from './db/client.ts';
import * as schema from './db/schema.ts';

export async function countUsers(db: Database): Promise<number> {
  const [row] = await db.select({ n: count() }).from(schema.user);
  return row?.n ?? 0;
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
        locale: { type: 'string', required: false, input: true },
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
    },
    advanced: {
      cookiePrefix: 'inkadra',
      database: { generateId: 'uuid' },
      ipAddress: { ipAddressHeaders: ['x-forwarded-for', 'x-real-ip'] },
    },
    telemetry: { enabled: false },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            // The first account of an instance is its administrator. After that,
            // sign-up is closed unless REGISTRATION=open (invitations arrive in wave 2).
            const existing = await countUsers(db);
            if (existing === 0) return { data: { ...user, role: 'admin' } };
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
