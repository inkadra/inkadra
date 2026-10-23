import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAuth } from '../auth.ts';
import { loadConfig } from '../config.ts';
import { createDatabase, runMigrations } from '../db/client.ts';
import { testDeps } from '../test-deps.ts';
import { createApp } from './app.ts';

const url = process.env.DATABASE_URL;
const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

/** Google and an OIDC provider, configured as docs/self-hosting/sign-in.md says. */
describe.skipIf(!url)('sign-in providers (needs DATABASE_URL)', () => {
  let issuer: Server;
  let issuerUrl = '';
  let app: Awaited<ReturnType<typeof createApp>>;
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
    const { db, sql: client } = createDatabase(config.DATABASE_URL, 2);
    await runMigrations(config.DATABASE_URL, migrationsFolder);
    app = await createApp({ config, db, auth: createAuth(config, db), log, ...testDeps(db, log) });
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
});
