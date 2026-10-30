import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAuth } from '../auth.ts';
import { loadConfig } from '../config.ts';
import { createDatabase } from '../db/client.ts';
import { testDeps } from '../test-deps.ts';
import { createApp } from './app.ts';

// The web app's files, as the installable app needs them. No request here reaches the database.
describe('web app files', () => {
  const { db, sql: client } = createDatabase('postgres://unused@127.0.0.1:1/unused', 1);
  const deps = testDeps(db, pino({ level: 'silent' }));
  const dist = join(deps.root, 'web');
  const config = loadConfig({
    NODE_ENV: 'test',
    PUBLIC_URL: 'https://inkadra.example.com',
    DATABASE_URL: 'postgres://unused@127.0.0.1:1/unused',
    AUTH_SECRET: 'test-secret-test-secret-test-secret-0123',
    DATA_DIR: deps.root,
    WEB_DIST: dist,
  });
  let app: Awaited<ReturnType<typeof createApp>>;
  const logs: string[] = [];

  beforeAll(async () => {
    mkdirSync(join(dist, 'assets'), { recursive: true });
    mkdirSync(join(dist, 'icons'));
    writeFileSync(join(dist, 'index.html'), '<!doctype html><title>Inkadra</title>');
    writeFileSync(join(dist, 'offline.html'), '<!doctype html><title>Offline</title>');
    writeFileSync(join(dist, 'manifest.webmanifest'), '{"name":"Inkadra"}');
    writeFileSync(join(dist, 'sw.js'), 'self.addEventListener("fetch", () => {});');
    writeFileSync(join(dist, 'icons', 'icon-192.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    writeFileSync(join(dist, 'assets', 'index-Bzm8OgW2.js'), 'export {};');
    app = await createApp({
      config,
      db,
      auth: createAuth(config, db),
      log: pino(
        { level: 'info' },
        {
          write: (line) => {
            logs.push(line);
          },
        },
      ),
      ...deps,
    });
  });

  afterAll(async () => {
    await app?.close();
    await client.end();
  });

  it('serves the manifest as a web app manifest, revalidated on each visit', async () => {
    const res = await app.inject('/manifest.webmanifest');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/manifest\+json/);
    expect(res.headers['cache-control']).toBe('no-cache');
  });

  it('serves the service worker from the root as JavaScript, never cached for long', async () => {
    const res = await app.inject('/sw.js');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/^(application|text)\/javascript/);
    // Browsers check for a new worker against this response: it must not be stale.
    expect(res.headers['cache-control']).toBe('no-cache');
  });

  it('serves the icons and the offline page', async () => {
    const icon = await app.inject('/icons/icon-192.png');
    expect(icon.statusCode).toBe(200);
    expect(icon.headers['content-type']).toBe('image/png');
    const offline = await app.inject('/offline.html');
    expect(offline.statusCode).toBe(200);
    expect(offline.headers['content-type']).toMatch(/^text\/html/);
  });

  it('keeps fingerprinted build files immutable', async () => {
    const res = await app.inject('/assets/index-Bzm8OgW2.js');
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  });

  it('answers app routes with the app, and missing build files with 404', async () => {
    const page = await app.inject('/join/abc');
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('<title>Inkadra</title>');
    expect((await app.inject('/assets/index-OLD.js')).statusCode).toBe(404);
    expect(page.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  });

  it('answers HEAD on app routes like GET, without a body', async () => {
    const root = await app.inject({ method: 'HEAD', url: '/' });
    expect(root.statusCode).toBe(200);
    expect(root.headers['content-type']).toMatch(/^text\/html/);
    expect(root.body).toBe('');
    expect((await app.inject({ method: 'HEAD', url: '/assets/index-OLD.js' })).statusCode).toBe(404);
  });

  it('keeps the token of a guest page out of referrers and search engines', async () => {
    const page = await app.inject('/s/abcdefghijklmnopqrstuvwxyz');
    expect(page.statusCode).toBe(200);
    expect(page.headers['referrer-policy']).toBe('no-referrer');
    expect(page.headers['x-robots-tag']).toBe('noindex, nofollow');
  });

  it('redacts guest page and preview tokens from request logs', async () => {
    await app.inject('/s/private-link');
    // Invalid short token: validation rejects it before reaching the unavailable database.
    expect((await app.inject('/api/v1/guest/by-token/private-link')).statusCode).toBe(400);
    expect(logs.join('')).not.toContain('private-link');
    expect(logs.join('')).toContain('/s/[redacted]');
    expect(logs.join('')).toContain('/api/v1/guest/by-token/[redacted]');
  });
});
