import { describe, expect, it } from 'vitest';
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
        '/oauth2/callback/oidc',
        '/sign-in/social',
      ])
        expect(hook.matcher({ path } as Parameters<typeof hook.matcher>[0]), path).toBe(true);
    } finally {
      if ('closeSecurity' in auth && typeof auth.closeSecurity === 'function') auth.closeSecurity();
      await sql.end();
    }
  });
});
