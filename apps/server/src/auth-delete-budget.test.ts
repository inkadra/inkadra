import { expect, it, vi } from 'vitest';
import { createAuth } from './auth.ts';
import { loadConfig } from './config.ts';
import type { Database } from './db/client.ts';

// Real (in-memory) budgets, so sign-in and account deletion share the same storage.
const auth = createAuth(
  loadConfig({
    NODE_ENV: 'test',
    PUBLIC_URL: 'https://example.com',
    DATABASE_URL: 'unused',
    AUTH_SECRET: 'test-secret-test-secret-test-secret',
  }),
  {} as Database,
);
const victim = { id: 'victim', email: 'victim@example.com' };
const signIn = (source: number) => ({
  path: '/sign-in/email',
  request: new Request('https://example.com/api/auth/sign-in/email'),
  body: { email: victim.email, password: 'guess' },
  headers: new Headers({ 'x-inkadra-client-ip': `198.51.${source}.1` }),
  context: {},
  getCookie: () => undefined,
  setCookie: vi.fn(),
  setHeader: vi.fn(),
});

it("does not let failed sign-ins for an address block that person's account deletion", async () => {
  // Failed sign-ins keep their reservation, so 50 from unknown devices spend the address budget.
  for (let source = 0; source < 50; source++)
    await auth.options.hooks?.before?.(signIn(source) as never);
  await expect(auth.options.hooks?.before?.(signIn(50) as never)).rejects.toMatchObject({
    statusCode: 429,
  });

  const verify = vi.spyOn(auth.api, 'verifyPassword').mockResolvedValue({ status: true } as never);
  const headers = new Headers({ 'x-inkadra-client-ip': '203.0.113.9' });
  expect(await auth.confirmPassword(victim, 'right', headers)).toBe('ok');
  verify.mockRestore();
  await auth.closeSecurity();
});
