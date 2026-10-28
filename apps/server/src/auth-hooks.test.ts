import { APIError } from 'better-auth';
import { afterEach, expect, it, vi } from 'vitest';
import { createAuth } from './auth.ts';
import { loadConfig } from './config.ts';
import type { Database } from './db/client.ts';

const budgets = vi.hoisted(() => ({
  consume: vi.fn(async () => ({ allowed: true, retryAfter: 0 })),
  check: vi.fn(async () => ({ allowed: true, retryAfter: 0 })),
  take: vi.fn(async () => true),
  storage: { delete: vi.fn(async () => {}) },
  close: vi.fn(),
}));
vi.mock('./auth-security.ts', () => ({ authSecurity: () => budgets }));
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

it('increments account and source budgets only on password 401 responses', async () => {
  await auth.options.hooks?.after?.(
    ctx('/sign-in/email', { returned: new APIError('UNAUTHORIZED') }) as never,
  );
  expect(budgets.take).toHaveBeenCalledWith(`login:${user.email}:192.0.2.1`, 10, 900);
  expect(budgets.take).toHaveBeenCalledWith(`account:${user.email}`, 50, 3600);
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
