import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Auth } from '../auth.ts';
import { createAuth } from '../auth.ts';
import { loadConfig } from '../config.ts';
import { createDatabase, runMigrations } from '../db/client.ts';
import { user } from '../db/schema.ts';
import { testDeps } from '../test-deps.ts';
import { createApp } from './app.ts';

const url = process.env.DATABASE_URL;
const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

/** Google and an OIDC provider, configured as docs/self-hosting/sign-in.md says. */
describe.skipIf(!url)('sign-in providers (needs DATABASE_URL)', () => {
  let issuer: Server;
  let issuerUrl = '';
  let app: Awaited<ReturnType<typeof createApp>>;
  let auth: Auth;
  let db: ReturnType<typeof createDatabase>['db'];
  let close = async () => {};

  beforeAll(async () => {
    // A stand-in identity provider that only serves its discovery document.
    issuer = createServer((req, res) => {
      if (req.url !== '/.well-known/openid-configuration') {
        res.writeHead(404).end();
        return;
      }
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          issuer: issuerUrl,
          authorization_endpoint: `${issuerUrl}/authorize`,
          token_endpoint: `${issuerUrl}/token`,
          userinfo_endpoint: `${issuerUrl}/userinfo`,
          jwks_uri: `${issuerUrl}/jwks`,
        }),
      );
    });
    await new Promise<void>((resolve) => issuer.listen(0, '127.0.0.1', resolve));
    issuerUrl = `http://127.0.0.1:${(issuer.address() as AddressInfo).port}`;

    const config = loadConfig({
      NODE_ENV: 'test',
      PUBLIC_URL: 'https://inkadra.example.com',
      DATABASE_URL: url ?? 'postgres://unused',
      AUTH_SECRET: 'test-secret-test-secret-test-secret-0123',
      GOOGLE_CLIENT_ID: 'google-client.apps.googleusercontent.com',
      GOOGLE_CLIENT_SECRET: 'google-secret',
      GOOGLE_ALLOWED_DOMAINS: 'studio.example.com',
      OIDC_NAME: 'Authentik',
      OIDC_DISCOVERY_URL: `${issuerUrl}/.well-known/openid-configuration`,
      OIDC_CLIENT_ID: 'inkadra',
      OIDC_CLIENT_SECRET: 'oidc-secret',
    });
    const log = pino({ level: 'silent' });
    const { db: database, sql: client } = createDatabase(config.DATABASE_URL, 2);
    await runMigrations(config.DATABASE_URL, migrationsFolder);
    db = database;
    auth = createAuth(config, db);
    app = await createApp({ config, db, auth, log, ...testDeps(db, log) });
    close = async () => {
      await app.close();
      await client.end();
    };
  });

  afterAll(async () => {
    await close();
    await new Promise((r) => issuer.close(r));
  });

  async function start(provider: string) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/social',
      headers: { origin: 'https://inkadra.example.com' },
      payload: { provider, callbackURL: '/' },
    });
    expect(res.statusCode).toBe(200);
    return new URL(res.json().url);
  }

  it('lists both providers on the instance', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/instance' });
    expect(res.json().auth).toMatchObject({
      google: true,
      oidc: [{ id: 'oidc', name: 'Authentik' }],
    });
  });

  it('sends people to Google with the documented redirect and the allowed domain', async () => {
    const to = await start('google');
    expect(to.origin).toBe('https://accounts.google.com');
    expect(to.searchParams.get('redirect_uri')).toBe(
      'https://inkadra.example.com/api/auth/callback/google',
    );
    expect(to.searchParams.get('hd')).toBe('studio.example.com');
  });

  it('sends people to the OIDC provider with the documented redirect and PKCE', async () => {
    const to = await start('oidc');
    expect(`${to.origin}${to.pathname}`).toBe(`${issuerUrl}/authorize`);
    expect(to.searchParams.get('client_id')).toBe('inkadra');
    expect(to.searchParams.get('redirect_uri')).toBe(
      'https://inkadra.example.com/api/auth/callback/oidc',
    );
    expect(to.searchParams.get('code_challenge_method')).toBe('S256');
    expect(to.searchParams.get('scope')).toContain('openid');
  });
  it.each(['google', 'oidc'])('requires a second factor after the %s callback', async (id) => {
    const email = `${randomUUID()}@studio.example.com`;
    const [owner] = await db
      .insert(user)
      .values({ name: 'Second factor', email, emailVerified: true, twoFactorEnabled: true })
      .returning();
    if (!owner) throw new Error('Missing fixture');
    const context = await auth.$context;
    const provider = context.socialProviders.find((p) => p.id === id);
    if (!provider) throw new Error('Missing provider');
    const info = vi.spyOn(provider, 'getUserInfo').mockResolvedValue({
      user: { email, name: owner.name, emailVerified: true },
      data: { sub: owner.id },
    });
    const exchange = vi.spyOn(provider, 'validateAuthorizationCode').mockResolvedValue({});
    try {
      const start = await app.inject({
        method: 'POST',
        url: '/api/auth/sign-in/social',
        headers: { origin: 'https://inkadra.example.com' },
        payload: { provider: id, callbackURL: '/' },
      });
      const state = new URL(start.json().url).searchParams.get('state');
      const cookie = start.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
      const callback = await app.inject({
        url: `/api/auth/callback/${id}?code=test&state=${state}`,
        headers: { cookie },
      });
      expect(callback.statusCode).toBe(302);
      expect(callback.headers.location).toBe('/login?twoFactor=true');
      const challenge = callback.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
      expect(callback.cookies.some((c) => c.name.endsWith('two_factor') && c.value)).toBe(true);
      const session = await auth.api.getSession({ headers: new Headers({ cookie: challenge }) });
      expect(session).toBeNull();
      const invalid = await app.inject({
        method: 'POST',
        url: '/api/auth/two-factor/verify-totp',
        headers: { cookie: challenge, origin: 'https://inkadra.example.com' },
        payload: { code: '000000' },
      });
      expect(invalid.statusCode).toBeGreaterThanOrEqual(400);
    } finally {
      info.mockRestore();
      exchange.mockRestore();
    }
  });
});
