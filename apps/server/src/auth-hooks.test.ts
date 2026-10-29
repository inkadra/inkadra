import { APIError, type BetterAuthPlugin } from 'better-auth';
import { afterEach, expect, it, vi } from 'vitest';
import { createAuth } from './auth.ts';
import { loadConfig } from './config.ts';
import type { Database } from './db/client.ts';

const budgets = vi.hoisted(() => ({
  consume: vi.fn(async () => ({ allowed: true, retryAfter: 0 })),
  refund: vi.fn(async () => {}),
  reportError: vi.fn(),
  check: vi.fn(async () => ({ allowed: true, retryAfter: 0 })),
  take: vi.fn(async () => true),
  storage: { delete: vi.fn(async () => {}) },
  close: vi.fn(),
}));
vi.mock('./auth-security.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./auth-security.ts')>()),
  authSecurity: () => budgets,
}));
afterEach(() => vi.clearAllMocks());
const auth = createAuth(
  loadConfig({
    NODE_ENV: 'test',
    PUBLIC_URL: 'https://example.com',
    DATABASE_URL: 'unused',
    AUTH_SECRET: 'test-secret-test-secret-test-secret',
  }),
  {} as Database,
);
const user = { id: 'member', email: 'member@example.com', twoFactorEnabled: true };
const ctx = (path: string, context: object = {}) => ({
  path,
  request: new Request(`https://example.com/api/auth${path}`),
  body: { email: user.email },
  headers: new Headers({ 'x-inkadra-client-ip': '192.0.2.1' }),
  context,
  getCookie: () => undefined,
  setCookie: vi.fn(),
  setHeader: vi.fn(),
});

it('does not clear password budgets before a required second factor', async () => {
  await auth.options.hooks?.after?.(ctx('/sign-in/email', { newSession: { user } }) as never);
  expect(budgets.storage.delete).not.toHaveBeenCalled();
  await auth.options.hooks?.after?.(
    ctx('/two-factor/verify-totp', { newSession: { user } }) as never,
  );
  expect(budgets.storage.delete).not.toHaveBeenCalledWith(`account:${user.email}`);
  expect(budgets.storage.delete).toHaveBeenCalledWith('totp:member');
});

it('reserves before verification and refunds only non-401 outcomes', async () => {
  for (const returned of [new APIError('UNAUTHORIZED'), new APIError('BAD_REQUEST'), {}]) {
    vi.clearAllMocks();
    const context = { returned };
    await auth.options.hooks?.before?.(ctx('/sign-in/email', context) as never);
    expect(budgets.consume).toHaveBeenCalledWith(`account:${user.email}`, 50, 3600);
    await auth.options.hooks?.after?.(ctx('/sign-in/email', context) as never);
    expect(budgets.refund).toHaveBeenCalledTimes(
      returned instanceof APIError && returned.status === 'UNAUTHORIZED' ? 0 : 2,
    );
  }
});

it('applies the TOTP budget to the authenticated user across sessions', async () => {
  const context = {
    session: { user, session: { id: 'session' } },
    createAuthCookie: () => ({ name: 'two_factor' }),
    secret: 'test',
  };
  await auth.options.hooks?.before?.({
    ...ctx('/two-factor/verify-totp', context),
    getSignedCookie: async () => null,
  } as never);
  expect(budgets.consume).toHaveBeenCalledWith('totp:member', 10, 300);
});

it('clears second-factor budgets after verification within an existing session', async () => {
  await auth.options.hooks?.after?.(ctx('/two-factor/verify-totp', { session: { user } }) as never);
  expect(budgets.storage.delete).toHaveBeenCalledWith('totp:member');
});

it('groups rotating IPv6 burst keys and reserves account/source counters', async () => {
  for (const ip of ['2001:db8::1', '2001:db8::2']) {
    await auth.options.hooks?.before?.({
      ...ctx('/sign-in/email'),
      headers: new Headers({ 'x-inkadra-client-ip': ip }),
    } as never);
  }
  expect(budgets.consume).toHaveBeenCalledWith('ip:2001:db8:0:0::/64:/sign-in/email', 30, 60);
  expect(budgets.consume).toHaveBeenCalledWith(`account:${user.email}`, 50, 3600);
});

it.each(['/change-password', '/change-email', '/sign-up/other'])(
  'limits sensitive endpoint %s',
  async (path) => {
    await auth.options.hooks?.before?.(ctx(path) as never);
    expect(budgets.consume).toHaveBeenCalledWith(`ip:192.0.2.0/24:${path}`, 3, 10);
  },
);
it('covers generic auth endpoints', async () => {
  await auth.options.hooks?.before?.(ctx('/get-session') as never);
  expect(budgets.consume).toHaveBeenCalledWith('generic:192.0.2.0/24', 100, 10);
});

it('retains budgets after a failed second factor', async () => {
  await auth.options.hooks?.after?.(
    ctx('/two-factor/verify-totp', {
      session: { user },
      returned: new APIError('UNAUTHORIZED'),
    }) as never,
  );
  expect(budgets.storage.delete).not.toHaveBeenCalled();
});

it('uses a device budget instead of the exhausted account budget', async () => {
  const { knownDevices, DEVICE_COOKIE } = await import('./auth-device.ts');
  const token = knownDevices('test-secret-test-secret-test-secret').issue(user);
  await auth.options.hooks?.before?.({
    ...ctx('/sign-in/email'),
    headers: new Headers({
      'x-inkadra-client-ip': '192.0.2.1',
      cookie: `${DEVICE_COOKIE}=${token}`,
    }),
  } as never);
  expect(budgets.consume).not.toHaveBeenCalledWith(`account:${user.email}`, 50, 3600);
  expect(budgets.consume).toHaveBeenCalledWith(expect.stringMatching(/^device:member:/), 5, 900);
  expect(budgets.consume).toHaveBeenCalledWith(`login:${user.email}:192.0.2.0/24`, 10, 900);
});

it('refunds reservations after Better Auth copies the request context', async () => {
  const context = {};
  await auth.options.hooks?.before?.(ctx('/sign-in/email', context) as never);
  await auth.options.hooks?.after?.(ctx('/sign-in/email', { ...context, returned: {} }) as never);
  expect(budgets.refund).toHaveBeenCalledWith(`account:${user.email}`);
});

it('does not reserve an account attempt after source rejection', async () => {
  budgets.consume.mockResolvedValueOnce({ allowed: true, retryAfter: 0 });
  budgets.consume.mockResolvedValueOnce({ allowed: true, retryAfter: 0 });
  budgets.consume.mockResolvedValueOnce({ allowed: false, retryAfter: 900 });
  await expect(auth.options.hooks?.before?.(ctx('/sign-in/email') as never)).rejects.toMatchObject({
    status: 'TOO_MANY_REQUESTS',
  });
  expect(budgets.refund).toHaveBeenCalledWith(`login:${user.email}:192.0.2.0/24`);
  expect(budgets.consume).not.toHaveBeenCalledWith(`account:${user.email}`, 50, 3600);
});

it('detaches reset delivery budgets and keys them by recipient and source', async () => {
  const send = vi.fn(async () => {});
  const configured = createAuth(
    loadConfig({
      NODE_ENV: 'test',
      PUBLIC_URL: 'https://example.com',
      DATABASE_URL: 'unused',
      AUTH_SECRET: 'test-secret-test-secret-test-secret',
    }),
    {} as Database,
    { mailer: { enabled: true, send } },
  );
  let release = (_allowed: boolean) => {};
  budgets.take.mockImplementationOnce(
    () =>
      new Promise<boolean>((resolve) => {
        release = resolve;
      }),
  );
  await configured.options.emailAndPassword?.sendResetPassword?.(
    { user: user as never, url: 'https://example.com/reset', token: 'test' },
    new Request('https://example.com', { headers: { 'x-inkadra-client-ip': '192.0.2.1' } }),
  );
  expect(send).not.toHaveBeenCalled();
  expect(budgets.take).toHaveBeenCalledWith(`mail:${user.email}:192.0.2.0/24`, 3, 900);
  release(true);
  await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
  expect(budgets.take).toHaveBeenCalledWith(`mail:${user.email}`, 10, 3600);
});

it('issues a host-only secure device cookie after the two-factor plugin', async () => {
  const plugins = auth.options.plugins ?? [];
  const index = plugins.findIndex((plugin) => plugin.id === 'known-device');
  expect(index).toBeGreaterThan(plugins.findIndex((plugin) => plugin.id === 'two-factor'));
  const hook = (plugins[index] as BetterAuthPlugin | undefined)?.hooks?.after?.[0];
  if (!hook) throw new Error('Missing known-device hook');
  const context = ctx('/two-factor/verify-totp', { newSession: { user } });
  expect(hook.matcher(context as never)).toBe(true);
  expect(hook.matcher(ctx('/sign-in/email') as never)).toBe(false);
  const result = (await hook.handler({ ...context, returnHeaders: true } as never)) as {
    headers: Headers;
  };
  const cookie = result.headers.get('set-cookie');
  expect(cookie).toContain('__Host-inkadra.known-device=');
  expect(cookie).toContain('HttpOnly');
  expect(cookie).toContain('Secure');
  expect(cookie).toContain('SameSite=Lax');
  expect(cookie).not.toContain('Domain=');
});

it('limits password confirmations for account deletion per user', async () => {
  const headers = new Headers({ 'x-inkadra-client-ip': '192.0.2.1' });
  const verify = vi.spyOn(auth.api, 'verifyPassword');
  verify.mockRejectedValueOnce(
    new APIError('BAD_REQUEST', { code: 'INVALID_PASSWORD', message: 'Invalid password' }),
  );
  expect(await auth.confirmPassword(user, 'wrong', headers)).toBe('wrong');
  expect(budgets.consume).toHaveBeenCalledWith('ip:192.0.2.0/24:/delete-user', 3, 10);
  expect(budgets.consume).toHaveBeenCalledWith('delete:member', 10, 3600);
  // Not the sign-in budget per address, which anyone who knows the address can spend.
  expect(budgets.consume).not.toHaveBeenCalledWith(`account:${user.email}`, 50, 3600);
  // A wrong password keeps its reservations.
  expect(budgets.refund).not.toHaveBeenCalled();

  verify.mockResolvedValueOnce({ status: true } as never);
  expect(await auth.confirmPassword(user, 'right', headers)).toBe('ok');
  expect(budgets.refund).toHaveBeenCalledWith('delete:member');

  vi.clearAllMocks();
  budgets.consume
    .mockResolvedValueOnce({ allowed: true, retryAfter: 0 })
    .mockResolvedValueOnce({ allowed: false, retryAfter: 7 });
  expect(await auth.confirmPassword(user, 'right', headers)).toEqual({ retryAfter: 7 });
  expect(verify).not.toHaveBeenCalled();
  // Refused before checking anything, so neither reservation counts.
  expect(budgets.refund).toHaveBeenCalledWith('ip:192.0.2.0/24:/delete-user');
  expect(budgets.refund).toHaveBeenCalledWith('delete:member');

  budgets.consume.mockRejectedValueOnce(new Error('offline'));
  expect(await auth.confirmPassword(user, 'right', headers)).toBe('unavailable');
  expect(budgets.reportError).toHaveBeenCalled();
  expect(verify).not.toHaveBeenCalled();
  verify.mockRestore();
});

it('does not count a failed password check as a wrong password', async () => {
  const headers = new Headers({ 'x-inkadra-client-ip': '192.0.2.1' });
  const verify = vi.spyOn(auth.api, 'verifyPassword');
  for (const err of [new Error('connection lost'), new APIError('UNAUTHORIZED')]) {
    vi.clearAllMocks();
    verify.mockRejectedValueOnce(err);
    expect(await auth.confirmPassword(user, 'right', headers)).toBe('failed');
    expect(budgets.refund).toHaveBeenCalledWith('ip:192.0.2.0/24:/delete-user');
    expect(budgets.refund).toHaveBeenCalledWith('delete:member');
  }
  verify.mockRestore();
});
