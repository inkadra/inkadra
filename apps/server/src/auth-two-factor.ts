import { createAuthMiddleware } from 'better-auth/api';
import { twoFactor } from 'better-auth/plugins';

/** Extend the upstream challenge, keeping its signed cookie, expiry and attempt counter. */
export function hardenedTwoFactor(issuer: string) {
  const plugin = twoFactor({ issuer });
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
  return plugin;
}
