import { APIError } from 'better-auth';
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
  expect(budgets.storage.delete).toHaveBeenCalledWith(`account:${user.email}`);
  expect(budgets.storage.delete).toHaveBeenCalledWith('totp:member');
});

it('reserves before verification and refunds only non-401 outcomes', async () => {
  for (const returned of [new APIError('UNAUTHORIZED'), new APIError('BAD_REQUEST'), {}]) {
    vi.clearAllMocks();
    const context = { returned };
    await auth.options.hooks?.before?.(ctx('/sign-in/email', context) as never);
    expect(budgets.consume).toHaveBeenCalledWith(`account:${user.email}`, 50, 3600);
    await auth.options.hooks?.after?.(ctx('/sign-in/email', context) as never);
    expect(budgets.refund).toHaveBeenCalledTimes(returned instanceof APIError && returned.status === 'UNAUTHORIZED' ? 0 : 2);
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
    await auth.options.hooks?.before?.({ ...ctx('/sign-in/email'), headers: new Headers({ 'x-inkadra-client-ip': ip }) } as never);
  }
  expect(budgets.consume).toHaveBeenCalledWith('ip:2001:db8:0:0::/64:/sign-in/email', 30, 60);
  expect(budgets.consume).toHaveBeenCalledWith(`account:${user.email}`, 50, 3600);
});

it.each(['/change-password', '/change-email', '/sign-up/other'])('limits sensitive endpoint %s', async (path) => {
  await auth.options.hooks?.before?.(ctx(path) as never);
  expect(budgets.consume).toHaveBeenCalledWith(`ip:192.0.2.0/24:${path}`, 3, 10);
});
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
