import { APIError, betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { createAuthMiddleware } from 'better-auth/api';
import { genericOAuth, magicLink } from 'better-auth/plugins';
import { and, count, eq, lt, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import { authSecurity } from './auth-security.ts';
import { hardenedTwoFactor } from './auth-two-factor.ts';
import type { Config } from './config.ts';
import type { Database } from './db/client.ts';
import * as schema from './db/schema.ts';
import { readInstanceSettings } from './instance-settings.ts';
import { acceptInvitation, invitationFromCookie, invitedAddressMatches } from './invitations.ts';
import { mailText } from './mail-texts.ts';
import { actionMail, type Mailer, securityNotification, sendDetached } from './mailer.ts';

/** Internal header carrying the client address from the HTTP layer to Better Auth. */
export const CLIENT_IP_HEADER = 'x-inkadra-client-ip';

/** Provider id of the generic OIDC provider in Better Auth (`/api/auth/callback/oidc`). */
export const OIDC_PROVIDER_ID = 'oidc';

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

const domainOf = (email: string) => email.split('@').pop()?.toLowerCase() ?? '';

export interface AuthDeps {
  mailer?: Mailer;
  log?: Logger;
}

export function createAuth(config: Config, db: Database, deps: AuthDeps = {}) {
  const { mailer } = deps;
  const email = Boolean(mailer?.enabled);
  const allowedDomains = config.GOOGLE_ALLOWED_DOMAINS.map((d) => d.toLowerCase());
  const google =
    config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET
      ? {
          clientId: config.GOOGLE_CLIENT_ID,
          clientSecret: config.GOOGLE_CLIENT_SECRET,
          prompt: 'select_account' as const,
          mapProfileToUser: (profile: { email: string; hd?: string }) => {
            if (
              allowedDomains.length &&
              (!profile.hd || !allowedDomains.includes(profile.hd.toLowerCase()))
            )
              throw new APIError('FORBIDDEN', {
                code: 'DOMAIN_NOT_ALLOWED',
                message: 'Domain not allowed.',
              });
            return {};
          },
          // Google enforces a single hosted domain itself; several are checked below.
          ...(allowedDomains.length === 1 ? { hd: allowedDomains[0] } : {}),
        }
      : undefined;
  const oidc =
    config.OIDC_CLIENT_ID && config.OIDC_CLIENT_SECRET && config.OIDC_DISCOVERY_URL
      ? {
          providerId: OIDC_PROVIDER_ID,
          name: config.OIDC_NAME,
          discoveryUrl: config.OIDC_DISCOVERY_URL,
          clientId: config.OIDC_CLIENT_ID,
          clientSecret: config.OIDC_CLIENT_SECRET,
          scopes: config.OIDC_SCOPES.split(/\s+/).filter(Boolean),
          pkce: true,
          requireIdTokenVerification: true,
          mapProfileToUser: (profile: { email?: string | null; [key: string]: unknown }) => {
            const isGoogle =
              new URL(config.OIDC_DISCOVERY_URL ?? '').hostname === 'accounts.google.com';
            const domains = (
              config.OIDC_ALLOWED_DOMAINS.length
                ? config.OIDC_ALLOWED_DOMAINS
                : isGoogle
                  ? allowedDomains
                  : []
            ).map((d) => d.toLowerCase());
            const domain = isGoogle
              ? typeof profile.hd === 'string'
                ? profile.hd.toLowerCase()
                : ''
              : domainOf(profile.email ?? '');
            if (
              domains.length &&
              (!domains.includes(domain) || (!isGoogle && profile.email_verified !== true))
            )
              throw new APIError('FORBIDDEN', {
                code: 'DOMAIN_NOT_ALLOWED',
                message: 'Domain not allowed.',
              });
            return {};
          },
        }
      : undefined;

  const checkDomain = (address: string) => {
    if (!allowedDomains.includes(domainOf(address)))
      throw new APIError('FORBIDDEN', {
        code: 'DOMAIN_NOT_ALLOWED',
        message: 'This Google account is not from an allowed domain.',
      });
  };

  const trusted = ['google', ...(oidc && config.OIDC_TRUST_EMAIL ? [OIDC_PROVIDER_ID] : [])];

  const security = authSecurity(config);
  const revokeTokens = async (user: { id: string; email: string; locale?: string | null }) => {
    await db
      .delete(schema.personalToken)
      .where(
        and(eq(schema.personalToken.userId, user.id), sql`${schema.personalToken.client} is null`),
      );
    securityNotification(mailer, user, 'password', deps.log);
  };
  const auth = betterAuth({
    rateLimit: {
      enabled: config.NODE_ENV !== 'test',
      customStorage: {
        async consume(key, rule) {
          const allowed = await security.take(`ip:${key}`, rule.max, rule.window);
          return { allowed, retryAfter: allowed ? null : rule.window };
        },
      },
      customRules: {
        '/sign-in/email': { window: 900, max: 10 },
        '/sign-in/magic-link': { window: 300, max: 3 },
        '/two-factor/*': { window: 300, max: 10 },
        '/request-password-reset': { window: 900, max: 3 },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === '/sign-up/email' && (await countUsers(db)) > 0) {
          const { registration } = await readInstanceSettings(db, config);
          const invitation = await invitationFromCookie(db, ctx.headers?.get('cookie'));
          if (registration !== 'open' && (registration === 'closed' || !invitation))
            throw new APIError('FORBIDDEN', {
              code: 'REGISTRATION_CLOSED',
              message: 'Registration is closed. Ask an administrator for an invitation.',
            });
        }
        if (ctx.path === '/sign-up/email') {
          const invitation = await invitationFromCookie(db, ctx.headers?.get('cookie'));
          if (invitation && typeof ctx.body?.email === 'string' && !invitedAddressMatches(invitation, ctx.body.email))
            throw new APIError('FORBIDDEN', { code: 'INVITATION_EMAIL_MISMATCH', message: 'Use the invited email address.' });
        }
        const address =
          typeof ctx.body?.email === 'string' ? ctx.body.email.trim().toLowerCase() : '';
        if (ctx.path === '/sign-in/email' && address && config.NODE_ENV !== 'test') {
          if (!(await security.take(`login:${address}`, 10, 900)))
            throw new APIError('TOO_MANY_REQUESTS', {
              message: 'Too many attempts. Try again later.',
            });
        }
        if (['/sign-in/magic-link', '/request-password-reset'].includes(ctx.path) && address) {
          if (!(await security.take(`mail:${address}`, 3, 900)))
            throw new APIError('TOO_MANY_REQUESTS', {
              message: 'Too many attempts. Try again later.',
            });
        }
      }),
      after: createAuthMiddleware(async (ctx) => {
        const ok = !(ctx.context.returned instanceof APIError);
        if (ctx.path === '/sign-in/email' && ctx.context.newSession && config.NODE_ENV !== 'test')
          await security.storage.delete(`login:${ctx.body.email.trim().toLowerCase()}`);
        if (ctx.path === '/change-password' && ok && ctx.context.session)
          await revokeTokens(ctx.context.session.user);
        if (ctx.path === '/two-factor/disable' && ok && ctx.context.session)
          securityNotification(mailer, ctx.context.session.user, 'twoFactor', deps.log);
      }),
    },
    appName: config.INSTANCE_NAME,
    baseURL: config.PUBLIC_URL,
    basePath: '/api/auth',
    secret: config.AUTH_SECRET,
    trustedOrigins: [config.PUBLIC_URL],
    // They expose or take session tokens; the account page uses /api/v1/me/sessions instead.
    disabledPaths: ['/list-sessions', '/revoke-session', '/update-user', '/get-access-token'],
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
        twoFactor: schema.twoFactor,
      },
    }),
    emailAndPassword: {
      enabled: true,
      revokeSessionsOnPasswordReset: true,
      onPasswordReset: async ({ user }) => revokeTokens(user),
      minPasswordLength: 10,
      maxPasswordLength: 128,
      autoSignIn: true,
      ...(email
        ? {
            sendResetPassword: async ({ user, url }) => {
              const t = mailText(user as { locale?: string | null });
              sendDetached(
                mailer,
                actionMail(user.email, t.resetSubject, t.resetLines(config.INSTANCE_NAME), {
                  label: t.resetAction,
                  url,
                }),
                deps.log,
              );
            },
          }
        : {}),
    },
    socialProviders: google ? { google } : {},
    account: {
      accountLinking: { enabled: true, trustedProviders: trusted },
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
      // Deleting the account or changing security settings needs a sign-in this recent.
      freshAge: 60 * 15,
    },
    plugins: [
      {
        id: 'cookie-only-sessions',
        // Project every HTTP JSON response, after endpoint and two-factor hooks finish.
        // Better Auth returns both token and session.token (including password rotation).
        // No web consumer needs either; auth.api calls retain tokens for internal use.
        // Personal/PKCE tokens live under /api/v1 and do not pass through this plugin.
        async onResponse(response) {
          // Redirects may carry a JSON content type despite having no JSON body.
          if (response.status >= 300 && response.status < 400) return;
          if (!response.body) return;
          if (!response.headers.get('content-type')?.includes('application/json')) return;
          const body = JSON.stringify(await response.json(), (key, value) =>
            key === 'token' ? undefined : value,
          );
          const headers = new Headers(response.headers);
          headers.delete('content-length');
          return {
            response: new Response(body, {
              status: response.status,
              statusText: response.statusText,
              headers,
            }),
          };
        },
      },
      hardenedTwoFactor(config.INSTANCE_NAME),
      ...(oidc ? [genericOAuth({ config: [oidc] })] : []),
      ...(email
        ? [
            magicLink({
              storeToken: 'hashed',
              expiresIn: 60 * 15,
              sendMagicLink: async ({ email: to, url }, ctx) => {
                // Without an account, only send a link when the person could sign up anyway,
                // and always answer the same, so addresses cannot be probed.
                const [existing] = await db
                  .select({ locale: schema.user.locale })
                  .from(schema.user)
                  .where(eq(schema.user.email, to.toLowerCase()));
                if (!existing) {
                  const invited = await invitationFromCookie(db, ctx?.headers?.get('cookie'));
                  const { registration } = await readInstanceSettings(db, config);
                  if (
                    (registration === 'closed' || (registration !== 'open' && !invited)) &&
                    (await countUsers(db)) > 0
                  )
                    return;
                }
                const t = mailText(existing ?? {});
                sendDetached(
                  mailer,
                  actionMail(to, t.magicSubject(config.INSTANCE_NAME), t.magicLines, {
                    label: t.magicAction,
                    url,
                  }),
                  deps.log,
                );
              },
            }),
          ]
        : []),
    ],
    advanced: {
      cookiePrefix: 'inkadra',
      database: { generateId: 'uuid' },
      // The HTTP bridge puts Fastify's client address (which honours TRUST_PROXY) in this header
      // and drops any copy sent by the client, so rate limits cannot be dodged with X-Forwarded-For.
      ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
    },
    telemetry: { enabled: false },
    databaseHooks: {
      session: {
        create: {
          before: async (session) => {
            const [owner] = await db
              .select()
              .from(schema.user)
              .where(eq(schema.user.id, session.userId));
            if (!owner || owner.deactivatedAt)
              throw new APIError('FORBIDDEN', { message: 'Account deactivated.' });
          },
        },
      },
      user: {
        create: {
          before: async (user, ctx) => {
            if (ctx?.path?.includes('/callback/google') && allowedDomains.length > 0)
              checkDomain(user.email);
            // The first account of an instance is its administrator. After that, sign-up is
            // closed unless REGISTRATION=open or the browser claimed a valid invitation.
            if (await claimSetup(db)) return { data: { ...user, role: 'admin' } };
            const { registration } = await readInstanceSettings(db, config);
            if (registration !== 'open') {
              const invited = await invitationFromCookie(db, ctx?.headers?.get('cookie'));
              if (!invited || registration === 'closed') {
                throw new APIError('FORBIDDEN', {
                  code: 'REGISTRATION_CLOSED',
                  message: 'Registration is closed. Ask an administrator for an invitation.',
                });
              }
              if (!invitedAddressMatches(invited, user.email)) {
                throw new APIError('FORBIDDEN', {
                  code: 'INVITATION_EMAIL_MISMATCH',
                  message: `This invitation was sent to ${invited.email}: sign up with that address.`,
                });
              }
            }
            return { data: { ...user, role: 'member' } };
          },
          after: async (user, ctx) => {
            const invited = await invitationFromCookie(db, ctx?.headers?.get('cookie'));
            if (!invited) return;
            try {
              await acceptInvitation(db, invited.id, user.id);
            } catch (err) {
              // The account exists either way; the invitation page can be opened again.
              deps.log?.warn({ err }, 'invitation not accepted at sign-up');
            }
          },
        },
      },
      account: {
        create: {
          before: async (account) => {
            // Linking Google to an existing account.
            if (account.providerId !== 'google' || allowedDomains.length === 0) return;
            const [owner] = await db
              .select({ email: schema.user.email })
              .from(schema.user)
              .where(eq(schema.user.id, account.userId));
            checkDomain(owner?.email ?? '');
          },
        },
      },
    },
  });
  return Object.assign(auth, { closeSecurity: () => security.close() });
}

export type Auth = ReturnType<typeof createAuth>;
