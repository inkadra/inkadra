import { createAuthMiddleware } from 'better-auth/api';
import { twoFactor } from 'better-auth/plugins';

/** Extend the upstream challenge, keeping its signed cookie, expiry and attempt counter. */
export function hardenedTwoFactor(issuer: string) {
  const plugin = twoFactor({ issuer });
  const hook = plugin.hooks.after[0];
  const upstream = hook.handler;
  hook.matcher = (ctx) => ['/sign-in/email', '/sign-in/username', '/sign-in/phone-number', '/magic-link/verify'].includes(ctx.path)
    || ctx.path.startsWith('/callback/') || ctx.path.startsWith('/oauth2/callback/');
  hook.handler = createAuthMiddleware(async (ctx) => {
    const needsChallenge = ctx.context.newSession?.user.twoFactorEnabled;
    const result = await upstream(ctx);
    if (needsChallenge && !ctx.context.newSession && (ctx.path.includes('/callback/') || ctx.path === '/magic-link/verify')) {
      // OAuth and email links are browser navigations, rather than JSON sign-ins.
      ctx.context.responseHeaders?.delete('location');
      throw ctx.redirect('/login?twoFactor=true');
    }
    return result;
  });
  return plugin;
}
