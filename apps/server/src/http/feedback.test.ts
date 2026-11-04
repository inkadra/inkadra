import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import pino from 'pino';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAuth } from '../auth.ts';
import { loadConfig } from '../config.ts';
import { createDatabase, runMigrations } from '../db/client.ts';
import { feedbackAttachment, feedbackReport } from '../db/schema.ts';
import { testDeps } from '../test-deps.ts';
import { createApp } from './app.ts';

const url = process.env.DATABASE_URL;
describe.skipIf(!url)('feedback security and durable delivery', () => {
  const config = loadConfig({
    NODE_ENV: 'test',
    REGISTRATION: 'open',
    PUBLIC_URL: 'http://localhost:3000',
    DATABASE_URL: url ?? 'postgres://unused',
    AUTH_SECRET: 'feedback-test-secret-feedback-test-secret-338',
    FEEDBACK_GITHUB_TOKEN: 'fake-test-credential',
  });
  const { db, sql: client } = createDatabase(config.DATABASE_URL, 5);
  let app: Awaited<ReturnType<typeof createApp>>;
  const logged: string[] = [];
  const log = pino({ level: 'trace' }, { write: (line: string) => logged.push(line) });
  let cookie = '';
  let issueCount = 0;
  let commentCount = 0;
  let privateRepo = true;
  let body = '';
  let issueStatus = 200;
  let dropWrites = false;
  const fake = createServer(async (req, res) => {
    let input = '';
    for await (const chunk of req) input += chunk;
    res.setHeader('content-type', 'application/json');
    if (req.method === 'POST' && dropWrites) {
      // The connection dies while GitHub may already have done the write.
      req.socket.destroy();
      return;
    }
    if (req.method === 'POST' && issueStatus !== 200) {
      res.statusCode = issueStatus;
      res.end('{"message":"refused, credential fake-test-credential echoed"}');
      return;
    }
    if (req.method === 'POST') {
      body = input;
      if (req.url?.endsWith('/comments')) commentCount++;
      else issueCount++;
      res.end(JSON.stringify({ number: 142 }));
    } else
      res.end(
        JSON.stringify(
          req.url?.includes('/issues/')
            ? { state: 'open' }
            : { full_name: 'test/feedback', private: privateRepo },
        ),
      );
  });
  const headers = () => ({ cookie, origin: config.PUBLIC_URL });
  const submit = (overrides = {}) => ({
    requestId: randomUUID(),
    type: 'bug',
    area: 'board',
    title: '@maintainer [click](https://evil.test)',
    description: '<img src=x> #42',
    diagnostics: { console: 'TypeError: unique338 broken at 42\nCookie: topsecret' },
    attachments: [],
    ...overrides,
  });
  beforeAll(async () => {
    await runMigrations(
      config.DATABASE_URL,
      fileURLToPath(new URL('../../drizzle', import.meta.url)),
    );
    await new Promise<void>((resolve) => fake.listen(0, '127.0.0.1', resolve));
    app = await createApp({
      config,
      db,
      auth: createAuth(config, db),
      log,
      ...testDeps(db, log),
      feedbackGitHubUrl: `http://127.0.0.1:${(fake.address() as AddressInfo).port}`,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { origin: config.PUBLIC_URL },
      payload: {
        email: `feedback-${randomUUID()}@example.com`,
        password: 'correct-horse-battery',
        name: 'Giulia Bianchi',
      },
    });
    cookie = res.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  });
  afterAll(async () => {
    await app?.close();
    await client.end();
    await new Promise<void>((resolve) => fake.close(() => resolve()));
  });
  it('requires authentication, defaults off, refuses public GitHub and cross-site writes', async () => {
    expect((await app.inject('/api/v1/feedback/status')).statusCode).toBe(401);
    expect(
      (await app.inject({ url: '/api/v1/feedback/status', headers: headers() })).json(),
    ).toMatchObject({ enabled: false });
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/feedback',
          headers: headers(),
          payload: submit(),
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: '/api/v1/feedback/settings',
          headers: { ...headers(), origin: 'https://evil.test' },
          payload: { destination: 'inbox', repository: null, guests: false },
        })
      ).statusCode,
    ).toBe(403);
    privateRepo = false;
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: '/api/v1/feedback/settings',
          headers: headers(),
          payload: { destination: 'github', repository: 'test/feedback', guests: false },
        })
      ).statusCode,
    ).toBe(400);
    privateRepo = true;
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: '/api/v1/feedback/settings',
          headers: headers(),
          payload: { destination: 'github', repository: 'test/feedback', guests: false },
        })
      ).statusCode,
    ).toBe(200);
  });
  it('sniffs attachments, binds uploads, accepts once, deduplicates errors, expires bearer links and rate limits', async () => {
    const bad = await app.inject({
      method: 'POST',
      url: '/api/v1/feedback/attachments?kind=screenshot&name=bad.png',
      headers: { ...headers(), 'content-type': 'application/octet-stream' },
      payload: Buffer.from('<script>not an image</script>'),
    });
    expect(bad.statusCode).toBe(400);
    const image = await sharp({
      create: { width: 12, height: 12, channels: 3, background: 'white' },
    })
      .png()
      .toBuffer();
    const upload = await app.inject({
      method: 'POST',
      url: '/api/v1/feedback/attachments?kind=screenshot&name=test.png',
      headers: { ...headers(), 'content-type': 'application/octet-stream' },
      payload: image,
    });
    expect(upload.statusCode).toBe(201);
    const attachment = upload.json();
    const link = `/api/v1/feedback/attachments/${attachment.id}`;
    expect((await app.inject(link)).statusCode).toBe(404);
    const input = submit({ attachments: [attachment] });
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/feedback',
      headers: headers(),
      payload: input,
    });
    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({ reference: '#142', duplicate: false });
    expect(first.json().issueUrl).toBe('https://github.com/test/feedback/issues/142');
    expect(issueCount).toBe(1);
    expect(body).not.toContain('@maintainer');
    expect(body).not.toContain('topsecret');
    expect(body).not.toContain('Bianchi');
    expect(body).not.toContain('@example.com');
    expect(JSON.parse(body).body).toContain('Giulia B\\. \\(admin\\) · instance');
    expect(JSON.parse(body).labels).toEqual(['from-app', 'bug', 'area:board']);
    const repeat = await app.inject({
      method: 'POST',
      url: '/api/v1/feedback',
      headers: headers(),
      payload: input,
    });
    expect(repeat.json().id).toBe(first.json().id);
    expect(issueCount).toBe(1);
    const served = await app.inject(link);
    expect(served.statusCode).toBe(200);
    expect(served.headers['cache-control']).toContain('no-store');
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/feedback',
      headers: headers(),
      payload: submit(),
    });
    expect(second.statusCode).toBe(201);
    expect(second.json()).toMatchObject({ reference: '#142', duplicate: true });
    expect(commentCount).toBe(1);
    expect(issueCount).toBe(1);
    expect(JSON.parse(body).body).toContain('Same error reported again');
    await db
      .update(feedbackAttachment)
      .set({ expiresAt: new Date(0) })
      .where(eq(feedbackAttachment.id, attachment.id));
    expect((await app.inject(link)).statusCode).toBe(404);
    for (let i = 0; i < 3; i++)
      await app.inject({
        method: 'POST',
        url: '/api/v1/feedback',
        headers: headers(),
        payload: submit({ type: 'idea' }),
      });
    const limited = await app.inject({
      method: 'POST',
      url: '/api/v1/feedback',
      headers: headers(),
      payload: submit(),
    });
    expect(limited.statusCode).toBe(429);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    const reports = (
      await app.inject({ url: '/api/v1/feedback/reports', headers: headers() })
    ).json();
    expect(reports.items.length).toBeGreaterThanOrEqual(5);
    const [saved] = await db
      .select()
      .from(feedbackReport)
      .where(eq(feedbackReport.id, first.json().id));
    expect(saved?.report.diagnostics.console).not.toContain('topsecret');
  });
  it('never returns or logs the server token, and retries only what GitHub refused', async () => {
    const settings = await app.inject({ url: '/api/v1/feedback/settings', headers: headers() });
    expect(settings.body).not.toContain('fake-test-credential');
    expect(settings.json()).toMatchObject({ tokenConfigured: true, retentionDays: 90 });
    // Fresh reporter: the rate limit of the first one is spent.
    const created = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { origin: config.PUBLIC_URL },
      payload: {
        email: `feedback-delivery-${randomUUID()}@example.com`,
        password: 'correct-horse-battery',
        name: 'Delivery Person',
      },
    });
    const reporter = {
      origin: config.PUBLIC_URL,
      cookie: created.cookies.map((c) => `${c.name}=${c.value}`).join('; '),
    };
    const send = () =>
      app.inject({
        method: 'POST',
        url: '/api/v1/feedback',
        headers: reporter,
        payload: submit({ type: 'idea', diagnostics: {} }),
      });
    issueStatus = 503;
    const refused = await send();
    issueStatus = 200;
    // Saved and accepted although GitHub refused; it stays in the queue, nothing is uncertain.
    expect(refused.statusCode).toBe(201);
    expect(refused.json()).toMatchObject({ delivery: 'pending', issueUrl: null });
    expect(refused.json().reference).toMatch(/^#local-\d+$/);
    const [waiting] = await db
      .select()
      .from(feedbackReport)
      .where(eq(feedbackReport.id, refused.json().id));
    expect(waiting?.attempts).toBe(1);
    expect(waiting?.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
    dropWrites = true;
    const lost = await send();
    dropWrites = false;
    expect(lost.statusCode).toBe(201);
    expect(lost.json().delivery).toBe('uncertain');
    expect(logged.join('')).not.toContain('fake-test-credential');
    expect(logged.join('')).not.toContain('Bearer');
  });
  it('keeps reports waiting locally while the destination is GitHub without a token', async () => {
    const noToken = loadConfig({
      NODE_ENV: 'test',
      REGISTRATION: 'open',
      PUBLIC_URL: 'http://localhost:3000',
      DATABASE_URL: config.DATABASE_URL,
      AUTH_SECRET: 'feedback-test-secret-feedback-test-secret-338',
    });
    const second = await createApp({
      config: noToken,
      db,
      auth: createAuth(noToken, db),
      log: pino({ level: 'silent' }),
      ...testDeps(db, pino({ level: 'silent' })),
      feedbackGitHubUrl: 'http://127.0.0.1:9',
    });
    try {
      const saved = await second.inject({
        method: 'PUT',
        url: '/api/v1/feedback/settings',
        headers: headers(),
        payload: { destination: 'github', repository: 'test/feedback', guests: false },
      });
      expect(saved.statusCode).toBe(200);
      expect(saved.json().tokenConfigured).toBe(false);
      const status = await second.inject({ url: '/api/v1/feedback/status', headers: headers() });
      expect(status.json()).toMatchObject({ enabled: true, destination: 'github' });
      expect(
        (
          await second.inject({
            method: 'PUT',
            url: '/api/v1/feedback/settings',
            headers: headers(),
            payload: { destination: 'github', repository: null, guests: false },
          })
        ).statusCode,
      ).toBe(400);
    } finally {
      await second.close();
    }
  });
  it('keeps member receipts private and restricts live guest sessions to text and screenshot', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { origin: config.PUBLIC_URL },
      payload: {
        email: `feedback-member-${randomUUID()}@example.com`,
        password: 'correct-horse-battery',
        name: 'Member Person',
      },
    });
    expect(created.statusCode).toBe(200);
    const memberHeaders = {
      origin: config.PUBLIC_URL,
      cookie: created.cookies.map((c) => `${c.name}=${c.value}`).join('; '),
    };
    expect(
      (await app.inject({ url: '/api/v1/feedback/reports', headers: memberHeaders })).statusCode,
    ).toBe(403);
    const sent = await app.inject({
      method: 'POST',
      url: '/api/v1/feedback',
      headers: memberHeaders,
      payload: submit({ diagnostics: {}, attachments: [] }),
    });
    expect(sent.statusCode).toBe(201);
    expect(sent.json().issueUrl).toBeNull();
    const project = (
      await app.inject({
        method: 'POST',
        url: '/api/v1/projects',
        headers: headers(),
        payload: { name: 'Feedback guest fixture' },
      })
    ).json();
    const link = (
      await app.inject({
        method: 'POST',
        url: `/api/v1/boards/${project.rootBoardId}/share-links`,
        headers: headers(),
        payload: {},
      })
    ).json();
    const token = link.url.split('/s/')[1];
    const opened = await app.inject({
      method: 'POST',
      url: `/api/v1/guest/links/${link.id}/session`,
      headers: { origin: config.PUBLIC_URL },
      payload: { token },
    });
    expect(opened.statusCode).toBe(200);
    const guestHeaders = {
      origin: config.PUBLIC_URL,
      cookie: opened.cookies.map((c) => `${c.name}=${c.value}`).join('; '),
    };
    const prefix = `/api/v1/guest/links/${link.id}/feedback`;
    expect(
      (await app.inject({ url: `${prefix}/status`, headers: guestHeaders })).json().enabled,
    ).toBe(false);
    await app.inject({
      method: 'PUT',
      url: '/api/v1/feedback/settings',
      headers: headers(),
      payload: { destination: 'inbox', repository: null, guests: true },
    });
    expect(
      (
        await app.inject({
          method: 'POST',
          url: prefix,
          headers: guestHeaders,
          payload: submit({ diagnostics: { console: 'forbidden' } }),
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `${prefix}/attachments?kind=video&name=bad.webm`,
          headers: { ...guestHeaders, 'content-type': 'application/octet-stream' },
          payload: Buffer.from('bad'),
        })
      ).statusCode,
    ).toBe(403);
    for (let i = 0; i < 2; i++)
      expect(
        (
          await app.inject({
            method: 'POST',
            url: prefix,
            headers: guestHeaders,
            payload: submit({ guestName: 'Guest Person', diagnostics: { page: '/guest/[id]' } }),
          })
        ).statusCode,
      ).toBe(201);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: prefix,
          headers: guestHeaders,
          payload: submit({ diagnostics: {} }),
        })
      ).statusCode,
    ).toBe(429);
    const inbox = (
      await app.inject({ url: '/api/v1/me/notifications', headers: headers() })
    ).json();
    expect(inbox.items.some((n: { type: string }) => n.type === 'feedback_received')).toBe(true);
  });
});
