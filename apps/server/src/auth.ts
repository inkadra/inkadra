import { APIError, betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { createAuthMiddleware, getSessionFromCtx } from 'better-auth/api';
import { genericOAuth, magicLink } from 'better-auth/plugins';
import { and, count, eq, lt, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import { DEVICE_AGE, DEVICE_COOKIE, knownDevices } from './auth-device.ts';
import { authSecurity, authSource } from './auth-security.ts';
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
              (!domains.includes(domain) ||
                (!isGoogle && profile.email_verified !== true && profile.email_verified !== 'true'))
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

  const security = authSecurity(config, deps.log);
  const devices = knownDevices(config.AUTH_SECRET);
  // Better Auth copies context between hooks; keep reservations on that context.
  type BudgetContext = { inkadraReservations?: string[] };
  const mailBudget = async (address: string, ip: string) =>
    (await security.take(`mail:${address}:${authSource(ip)}`, 3, 900)) &&
    (await security.take(`mail:${address}`, 10, 3600));
  const revokeTokens = async (
    user: { id: string; email: string; locale?: string | null },
    all = false,
  ) => {
    await db
      .delete(schema.personalToken)
      .where(
        and(
          eq(schema.personalToken.userId, user.id),
          all ? undefined : sql`${schema.personalToken.client} is null`,
        ),
      );
    securityNotification(mailer, user, 'password', deps.log);
  };
  const auth = betterAuth({
    // Scope availability failures to credential entry, never session lookup/sign-out.
    rateLimit: { enabled: false },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        const invitation =
          ctx.path === '/sign-up/email'
            ? await invitationFromCookie(db, ctx.headers?.get('cookie'))
            : null;
        if (ctx.path === '/sign-up/email' && (await countUsers(db)) > 0) {
          const { registration } = await readInstanceSettings(db, config);
          if (registration !== 'open' && (registration === 'closed' || !invitation))
            throw new APIError('FORBIDDEN', {
              code: 'REGISTRATION_CLOSED',
              message: 'Registration is closed. Ask an administrator for an invitation.',
            });
        }
        if (ctx.path === '/sign-up/email') {
          if (
            invitation &&
            typeof ctx.body?.email === 'string' &&
            !invitedAddressMatches(invitation, ctx.body.email)
          )
            throw new APIError('FORBIDDEN', {
              code: 'INVITATION_EMAIL_MISMATCH',
              message: 'Use the invited email address.',
            });
        }
        const sensitive =
          ctx.path.startsWith('/sign-in/') ||
          ctx.path.startsWith('/sign-up/') ||
          ctx.path === '/change-password' ||
          ctx.path === '/change-email' ||
          ctx.path.startsWith('/callback/') ||
          ctx.path === '/magic-link/verify' ||
          ctx.path.startsWith('/two-factor/') ||
          ctx.path === '/request-password-reset' ||
          ctx.path === '/reset-password';
        // Internal auth.api calls (for example /api/v1 session checks) are not HTTP auth traffic.
        if (!ctx.request) return;
        if (config.NODE_ENV !== 'production' && config.AUTH_RATE_LIMITS === 'off') return;
        const address =
          typeof ctx.body?.email === 'string' ? ctx.body.email.trim().toLowerCase() : '';
        const ip = ctx.headers?.get(CLIENT_IP_HEADER) ?? 'unknown';
        try {
          const generic = await security.consume(`generic:${authSource(ip)}`, 100, 10);
          if (!generic.allowed) {
            ctx.setHeader('retry-after', String(generic.retryAfter));
            throw new APIError('TOO_MANY_REQUESTS', { message: 'Too many attempts.' });
          }
          if (!sensitive) return;
          const strict =
            ctx.path.startsWith('/sign-up/') ||
            ['/change-password', '/change-email'].includes(ctx.path);
          const burst = await security.consume(
            `ip:${authSource(ip)}:${ctx.path}`,
            strict ? 3 : 30,
            strict ? 10 : 60,
          );
          if (!burst.allowed) {
            ctx.setHeader('retry-after', String(burst.retryAfter));
            throw new APIError('TOO_MANY_REQUESTS', { message: 'Too many attempts.' });
          }
          if (ctx.path === '/sign-in/email' && address) {
            const device = devices.verify(ctx.getCookie(DEVICE_COOKIE) ?? undefined, address);
            const held: string[] = [];
            (ctx.context as BudgetContext).inkadraReservations = held;
            for (const [id, max, seconds] of [
              [`login:${address}:${authSource(ip)}`, 10, 900],
              device
                ? ([`device:${device}`, 5, 900] as const)
                : ([`account:${address}`, 50, 3600] as const),
            ] as const) {
              const result = await security.consume(id, max, seconds);
              held.push(id);
              if (!result.allowed) {
                await Promise.all(held.map((key) => security.refund(key)));
                delete (ctx.context as BudgetContext).inkadraReservations;
                ctx.setHeader('retry-after', String(result.retryAfter));
                throw new APIError('TOO_MANY_REQUESTS', { message: 'Too many attempts.' });
              }
            }
          }
          if (ctx.path.startsWith('/two-factor/verify-')) {
            const session = await getSessionFromCtx(ctx);
            const cookie = ctx.context.createAuthCookie('two_factor');
            const challenge = await ctx.getSignedCookie(cookie.name, ctx.context.secret);
            const record = challenge
              ? await ctx.context.internalAdapter.findVerificationValue(challenge)
              : null;
            const userId = session?.user.id ?? record?.value;
            if (userId) {
              const result = await security.consume(`totp:${userId}`, 10, 300);
              if (!result.allowed) {
                ctx.setHeader('retry-after', String(result.retryAfter));
                throw new APIError('TOO_MANY_REQUESTS', { message: 'Too many attempts.' });
              }
            }
          }
        } catch (err) {
          if (err instanceof APIError) throw err;
          security.reportError();
          if (!sensitive) return;
          throw new APIError('SERVICE_UNAVAILABLE', {
            message: 'Authentication temporarily unavailable.',
          });
        }
      }),
      after: createAuthMiddleware(async (ctx) => {
        const ok = !(ctx.context.returned instanceof APIError);
        try {
          const enabled = config.NODE_ENV === 'production' || config.AUTH_RATE_LIMITS !== 'off';
          const held = (ctx.context as BudgetContext).inkadraReservations;
          delete (ctx.context as BudgetContext).inkadraReservations;
          if (
            held &&
            !(
              ctx.context.returned instanceof APIError &&
              ctx.context.returned.status === 'UNAUTHORIZED'
            )
          )
            await Promise.all(held.map((id) => security.refund(id)));
          const verifiedUser = ctx.context.newSession?.user ?? ctx.context.session?.user;
          if (enabled && ok && ctx.path.startsWith('/two-factor/verify-') && verifiedUser) {
            const user = verifiedUser;
            await security.storage.delete(`totp:${user.id}`);
          }
        } catch {
          security.reportError();
        }
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
    disabledPaths: [
      '/list-sessions',
      '/revoke-session',
      '/update-user',
      '/get-access-token',
      '/refresh-token',
    ],
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
      onPasswordReset: async ({ user }) => revokeTokens(user, true),
      minPasswordLength: 10,
      maxPasswordLength: 128,
      autoSignIn: true,
      ...(email
        ? {
            sendResetPassword: async ({ user, url }, request) => {
              const t = mailText(user as { locale?: string | null });
              void (async () => {
                if (
                  !(await mailBudget(
                    user.email.toLowerCase(),
                    request?.headers.get(CLIENT_IP_HEADER) ?? 'unknown',
                  ))
                )
                  return;
                sendDetached(
                  mailer,
                  actionMail(user.email, t.resetSubject, t.resetLines(config.INSTANCE_NAME), {
                    label: t.resetAction,
                    url,
                  }),
                  deps.log,
                );
              })().catch(() => security.reportError());
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
                // Detach lookup as well as SMTP to avoid disclosing account existence by latency.
                void (async () => {
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
                  if (
                    !(await mailBudget(
                      to.toLowerCase(),
                      ctx?.headers?.get(CLIENT_IP_HEADER) ?? 'unknown',
                    ))
                  )
                    return;
                  const t = mailText(existing ?? {});
                  sendDetached(
                    mailer,
                    actionMail(to, t.magicSubject(config.INSTANCE_NAME), t.magicLines, {
                      label: t.magicAction,
                      url,
                    }),
                    deps.log,
                  );
                })().catch(() => security.reportError());
              },
            }),
          ]
        : []),
      {
        id: 'known-device',
        hooks: {
          after: [
            {
              matcher: (ctx) =>
                new URL(config.PUBLIC_URL).protocol === 'https:' &&
                Boolean(ctx.context.newSession) &&
                Boolean(ctx.path) &&
                ((ctx.path ?? '').startsWith('/sign-in/') ||
                  (ctx.path ?? '').startsWith('/sign-up/') ||
                  (ctx.path ?? '').startsWith('/callback/') ||
                  ctx.path === '/magic-link/verify' ||
                  (ctx.path ?? '').startsWith('/two-factor/verify-')),
              handler: createAuthMiddleware(async (ctx) => {
                const user = ctx.context.newSession?.user;
                // Runs after the upstream two-factor hook has removed provisional sessions.
                if (!user) return;
                const result = ctx.context.returned;
                if (result instanceof APIError && result.statusCode >= 400) return;
                ctx.setCookie(DEVICE_COOKIE, devices.issue(user), {
                  httpOnly: true,
                  secure: true,
                  sameSite: 'lax',
                  path: '/',
                  maxAge: DEVICE_AGE,
                });
              }),
            },
          ],
        },
      },
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
  return Object.assign(auth, {
    readySecurity: () => security.ready(),
    closeSecurity: () => security.close(),
  });
}

export type Auth = ReturnType<typeof createAuth>;
