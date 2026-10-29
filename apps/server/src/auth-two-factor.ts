import { APIError } from 'better-auth';
import { createAuthMiddleware, getSessionFromCtx } from 'better-auth/api';
import { twoFactor } from 'better-auth/plugins';
import { FRESH_SIGN_IN_MS } from './auth-session.ts';

/** Extend the upstream challenge, keeping its signed cookie, expiry and attempt counter. */
export function hardenedTwoFactor(issuer: string) {
  const plugin = twoFactor({ issuer, allowPasswordless: true });
  const hook = plugin.hooks.after[0];
  if (!hook) throw new Error('Better Auth two-factor hook is missing.');
  const upstream = hook.handler;
  hook.matcher = (ctx) =>
    [
      '/sign-in/email',
      '/sign-in/username',
      '/sign-in/phone-number',
      '/sign-in/social',
      '/magic-link/verify',
    ].includes(ctx.path ?? '') ||
    (ctx.path?.startsWith('/callback/') ?? false);
  hook.handler = createAuthMiddleware(async (ctx) => {
    const needsChallenge = ctx.context.newSession?.user.twoFactorEnabled;
    // A nested Better Call middleware returns an envelope when returnHeaders is true.
    // Forward its cookies separately and return only its body to the outer hook.
    const result = (await upstream({ ...ctx, returnHeaders: true })) as unknown as {
      headers?: Headers;
      response: Awaited<ReturnType<typeof upstream>>;
    };
    if (result.headers) {
      for (const [name, value] of result.headers)
        if (name !== 'set-cookie') ctx.setHeader(name, value);
      for (const cookie of result.headers.getSetCookie())
        ctx.responseHeaders.append('set-cookie', cookie);
    }
    if (
      needsChallenge &&
      !ctx.context.newSession &&
      (ctx.path.includes('/callback/') || ctx.path === '/magic-link/verify')
    ) {
      // OAuth and email links are browser navigations, rather than JSON sign-ins.
      const location = ctx.context.responseHeaders?.get('location');
      const base = new URL(ctx.context.baseURL);
      const destination = location ? new URL(location, base) : null;
      const next =
        destination?.origin === base.origin
          ? destination.pathname + destination.search + destination.hash
          : '/';
      ctx.context.responseHeaders?.delete('location');
      throw ctx.redirect(`/login?twoFactor=true&next=${encodeURIComponent(next)}`);
    }
    return result.response;
  });
  return {
    ...plugin,
    hooks: {
      ...plugin.hooks,
      before: [
        {
          matcher: (ctx: { path?: string }) =>
            [
              '/two-factor/enable',
              '/two-factor/disable',
              '/two-factor/get-totp-uri',
              '/two-factor/generate-backup-codes',
              '/two-factor/view-backup-codes',
            ].includes(ctx.path ?? ''),
          handler: createAuthMiddleware(async (ctx) => {
            const session = await getSessionFromCtx(ctx);
            if (!session) return;
            const credential = await ctx.context.internalAdapter.findCredentialAccount(
              session.user.id,
            );
            // Password accounts retain upstream password confirmation. Provider-only accounts
            // must prove a recent sign-in before secrets or recovery codes can be exposed/changed.
            if (credential?.password) return;
            const signedInAt = new Date(session.session.createdAt).getTime();
            if (!Number.isFinite(signedInAt) || Date.now() - signedInAt >= FRESH_SIGN_IN_MS)
              throw new APIError('FORBIDDEN', {
                code: 'REAUTH_REQUIRED',
                message: 'Sign in again before managing two-step verification.',
              });
          }),
        },
      ],
    },
  };
}
