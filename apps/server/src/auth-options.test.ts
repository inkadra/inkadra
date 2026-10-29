import { describe, expect, it, vi } from 'vitest';
import { createAuth } from './auth.ts';
import { loadConfig } from './config.ts';
import { createDatabase } from './db/client.ts';

// No connection is opened: inspecting configuration must not access the database.
const config = loadConfig({
  NODE_ENV: 'test',
  PUBLIC_URL: 'https://example.com',
  DATABASE_URL: 'postgres://unused',
  AUTH_SECRET: 'test-secret-test-secret-test-secret',
});

describe('auth security regressions', () => {
  it('revokes browser sessions on password reset and disables unvalidated user edits', async () => {
    const { db, sql } = createDatabase(config.DATABASE_URL);
    const auth = createAuth(config, db);
    try {
      expect(auth.options.emailAndPassword?.revokeSessionsOnPasswordReset).toBe(true);
      expect(auth.options.disabledPaths).toContain('/update-user');
      expect(auth.options.disabledPaths).toContain('/get-access-token');
      expect(auth.options).not.toHaveProperty('secondaryStorage');
    } finally {
      if ('closeSecurity' in auth && typeof auth.closeSecurity === 'function') auth.closeSecurity();
      await sql.end();
    }
  });
  it('matches browser callback sign-ins in the upstream second-factor challenge', async () => {
    const { db, sql } = createDatabase(config.DATABASE_URL);
    const auth = createAuth(config, db);
    try {
      const plugin = auth.options.plugins?.find((p) => p.id === 'two-factor');
      const hook = plugin?.hooks?.after?.[0];
      if (!hook) throw new Error('Missing two-factor hook');
      for (const path of [
        '/magic-link/verify',
        '/callback/google',
        '/callback/oidc',
        '/sign-in/social',
      ])
        expect(hook.matcher({ path } as Parameters<typeof hook.matcher>[0]), path).toBe(true);
    } finally {
      if ('closeSecurity' in auth && typeof auth.closeSecurity === 'function') auth.closeSecurity();
      await sql.end();
    }
  });
});

it('keeps session lookup and sign-out available when the limiter is down', async () => {
  const { db, sql } = createDatabase(config.DATABASE_URL);
  const auth = createAuth(
    {
      ...config,
      NODE_ENV: 'production',
      AUTH_RATE_LIMITS: 'off',
      REDIS_URL: 'redis://127.0.0.1:1',
    },
    db,
    { mailer: { enabled: true, send: async () => {} } },
  );
  const call = (path: string, method = 'GET', body?: unknown) =>
    auth.handler(
      new Request(`https://example.com/api/auth${path}`, {
        method,
        headers: { 'content-type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
    );
  try {
    expect((await call('/get-session')).status).toBe(200);
    expect((await call('/sign-out', 'POST', {})).status).toBe(200);
    expect(
      (
        await call('/sign-in/email', 'POST', {
          email: 'person@example.com',
          password: 'correct-password',
        })
      ).status,
    ).toBe(503);
    for (const path of [
      '/sign-in/magic-link',
      '/request-password-reset',
      '/two-factor/verify-totp',
    ])
      expect(
        (await call(path, 'POST', { email: 'person@example.com', code: '000000' })).status,
      ).toBe(503);
  } finally {
    auth.closeSecurity();
    await sql.end();
  }
});

it('checks verified provider domain claims for linked profiles too', async () => {
  const { db, sql } = createDatabase(config.DATABASE_URL);
  const auth = createAuth(
    {
      ...config,
      GOOGLE_CLIENT_ID: 'test',
      GOOGLE_CLIENT_SECRET: 'test',
      GOOGLE_ALLOWED_DOMAINS: ['example.com'],
    },
    db,
  );
  try {
    const google = auth.options.socialProviders?.google;
    if (!google || typeof google === 'function' || !google.mapProfileToUser)
      throw new Error('Missing Google mapping');
    const profile = { email: 'member@example.com' } as Parameters<
      typeof google.mapProfileToUser
    >[0];
    expect(() => google.mapProfileToUser?.(profile)).toThrow();
    expect(google.mapProfileToUser({ ...profile, hd: 'example.com' })).toEqual({});
    expect(auth.options.disabledPaths).toContain('/refresh-token');
  } finally {
    auth.closeSecurity();
    await sql.end();
  }
});

it('accepts verified OIDC email claims including Cognito string true and rejects other claims', async () => {
  const { db, sql } = createDatabase(config.DATABASE_URL);
  const auth = createAuth(
    {
      ...config,
      OIDC_CLIENT_ID: 'test',
      OIDC_CLIENT_SECRET: 'test',
      OIDC_DISCOVERY_URL: 'https://issuer.example/.well-known/openid-configuration',
      OIDC_ALLOWED_DOMAINS: ['example.com'],
    },
    db,
  );
  try {
    const plugin = auth.options.plugins?.find((p) => p.id === 'generic-oauth') as unknown as {
      options: {
        config: Array<{ mapProfileToUser: (profile: Record<string, unknown>) => unknown }>;
      };
    };
    const map = plugin.options.config[0]?.mapProfileToUser;
    if (!map) throw new Error('Missing OIDC mapping');
    for (const email_verified of [true, 'true'])
      expect(map({ email: 'member@example.com', email_verified })).toEqual({});
    for (const email_verified of [false, 'false', undefined, 1])
      expect(() => map({ email: 'member@example.com', email_verified })).toThrow();
    expect(() => map({ email: 'member@elsewhere.com', email_verified: true })).toThrow();
  } finally {
    auth.closeSecurity();
    await sql.end();
  }
});

it('preserves the provider authorization URL before any session exists', async () => {
  const { db, sql } = createDatabase(config.DATABASE_URL);
  const auth = createAuth(
    { ...config, GOOGLE_CLIENT_ID: 'test', GOOGLE_CLIENT_SECRET: 'test' },
    db,
  );
  vi.spyOn((await auth.$context).internalAdapter, 'createVerificationValue').mockResolvedValue(
    {} as never,
  );
  try {
    const response = await auth.handler(
      new Request('https://example.com/api/auth/sign-in/social', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider: 'google', callbackURL: '/' }),
      }),
    );
    expect(response.status).toBe(200);
    expect(Object.keys((await response.json()) as object)).toContain('url');
  } finally {
    auth.closeSecurity();
    await sql.end();
  }
});

it.each(['/change-password', '/change-email'])(
  'enforces the credential-change burst before authentication on %s',
  async (path) => {
    const { db, sql } = createDatabase(config.DATABASE_URL);
    const auth = createAuth(config, db);
    try {
      const call = () =>
        auth.handler(
          new Request(`https://example.com/api/auth${path}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              currentPassword: 'incorrect-password',
              newPassword: 'replacement-password',
              newEmail: 'new@example.com',
            }),
          }),
        );
      for (let i = 0; i < 3; i++) expect((await call()).status).not.toBe(429);
      const blocked = await call();
      expect(blocked.status).toBe(429);
      expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
    } finally {
      auth.closeSecurity();
      await sql.end();
    }
  },
);

it('limits generic HTTP auth traffic without blocking internal session lookup', async () => {
  const { db, sql } = createDatabase(config.DATABASE_URL);
  const auth = createAuth(config, db);
  const call = () => auth.handler(new Request('https://example.com/api/auth/get-session'));
  try {
    for (let i = 0; i < 100; i++) expect((await call()).status).toBe(200);
    expect((await call()).status).toBe(429);
    expect(await auth.api.getSession({ headers: new Headers() })).toBeNull();
  } finally {
    auth.closeSecurity();
    await sql.end();
  }
});
