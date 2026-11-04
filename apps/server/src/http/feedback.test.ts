import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import pino from 'pino';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAuth } from '../auth.ts';
import { loadConfig } from '../config.ts';
import { createDatabase, runMigrations } from '../db/client.ts';
import { feedbackAttachment, feedbackReport, instanceSetting, user } from '../db/schema.ts';
import { testDeps } from '../test-deps.ts';
import { createApp } from './app.ts';
import { sweepFeedback } from './feedback-routes.ts';

const url = process.env.DATABASE_URL;
describe.skipIf(!url)('feedback security and durable delivery', () => {
  const config = loadConfig({
    NODE_ENV: 'test',
    REGISTRATION: 'open',
    AUTH_RATE_LIMITS: 'off',
    PUBLIC_URL: 'http://localhost:3000',
    DATABASE_URL: url ?? 'postgres://unused',
    AUTH_SECRET: 'feedback-test-secret-feedback-test-secret-338',
    FEEDBACK_GITHUB_TOKEN: 'fake-test-credential',
    FEEDBACK_RELAY_URL: '',
  });
  const { db, sql: client } = createDatabase(config.DATABASE_URL, 5);
  let app: Awaited<ReturnType<typeof createApp>>;
  let sharedDeps: ReturnType<typeof testDeps>;
  const logged: string[] = [];
  const log = pino({ level: 'trace' }, { write: (line: string) => logged.push(line) });
  let cookie = '';
  let issueCount = 0;
  let commentCount = 0;
  let privateRepo = true;
  let body = '';
  let issueStatus = 200;
  let dropWrites = false;
  let relaySent = 0;
  const fake = createServer(async (req, res) => {
    let input = '';
    for await (const chunk of req) input += chunk;
    res.setHeader('content-type', 'application/json');
    if (req.url === '/challenge') {
      res.end(
        JSON.stringify({ ticket: 'fake', seed: 'seed', bits: 0, nbf: Date.now() + relayWait }),
      );
      return;
    }
    if (req.url === '/report') {
      body = input;
      relaySent += 1;
      res.statusCode = 201;
      res.end(JSON.stringify({ number: 901 }));
      return;
    }

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
  const newReporter = async (name: string) => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { origin: config.PUBLIC_URL },
      payload: {
        email: `feedback-${name}-${randomUUID()}@example.com`,
        password: 'correct-horse-battery',
        name: 'Test Person',
      },
    });
    return {
      origin: config.PUBLIC_URL,
      cookie: created.cookies.map((c) => `${c.name}=${c.value}`).join('; '),
    };
  };
  let relayWait = 0;
  const uploadOne = (reporter: Record<string, string>) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/feedback/attachments?kind=file&name=note.txt',
      headers: { ...reporter, 'content-type': 'application/octet-stream' },
      payload: Buffer.from('text'),
    });
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
    sharedDeps = testDeps(db, log);
    app = await createApp({
      config,
      db,
      auth: createAuth(config, db),
      log,
      ...sharedDeps,
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
    // The database is shared with other test files: this may not be the instance's first account.
    await db.update(user).set({ role: 'admin' }).where(eq(user.id, res.json().user.id));
  });
  afterAll(async () => {
    await app?.close();
    await client.end();
    await new Promise<void>((resolve) => fake.close(() => resolve()));
  });
  it('defaults to developers without credentials and preserves requestId through relay delivery', async () => {
    config.FEEDBACK_RELAY_URL = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;
    const token = config.FEEDBACK_GITHUB_TOKEN;
    config.FEEDBACK_GITHUB_TOKEN = undefined;
    try {
      expect(
        (await app.inject({ url: '/api/v1/feedback/status', headers: headers() })).json(),
      ).toMatchObject({ enabled: true, destination: 'relay' });
      const settings = (
        await app.inject({ url: '/api/v1/feedback/settings', headers: headers() })
      ).json();
      expect(settings.guests).toBe(false);
      const reporter = await newReporter('relay');
      const uploaded = await uploadOne(reporter);
      const input = submit({
        diagnostics: { console: 'password: hidden-value' },
        attachments: [uploaded.json()],
        expectedDestination: 'relay',
      });
      // A tab opened when the dialog said something else.
      const stale = await app.inject({
        method: 'POST',
        url: '/api/v1/feedback',
        headers: reporter,
        payload: { ...input, expectedDestination: 'inbox' },
      });
      expect(stale.statusCode).toBe(409);
      const silent = await app.inject({
        method: 'POST',
        url: '/api/v1/feedback',
        headers: reporter,
        payload: { ...input, expectedDestination: undefined },
      });
      expect(silent.statusCode).toBe(409);
      const first = await app.inject({
        method: 'POST',
        url: '/api/v1/feedback',
        headers: reporter,
        payload: input,
      });
      expect(first.statusCode).toBe(201);
      expect(first.json().delivery).toBe('delivered');
      const second = await app.inject({
        method: 'POST',
        url: '/api/v1/feedback',
        headers: reporter,
        payload: input,
      });
      expect(second.json().id).toBe(first.json().id);
      expect(body).not.toContain('hidden-value');
      expect(body).not.toContain('Giulia');
      expect(body).not.toContain(config.PUBLIC_URL);
      expect(body).toContain('name="attachment-1"; filename="file-1.txt"');
      expect(body).not.toContain('note.txt');
      expect(body).not.toContain('expectedDestination');

      // Far from its turn at the relay: it waits, with no failure and no longer backoff.
      relayWait = 300000;
      const queued = await app.inject({
        method: 'POST',
        url: '/api/v1/feedback',
        headers: reporter,
        payload: submit({ attachments: [], expectedDestination: 'relay' }),
      });
      expect(queued.json().delivery).toBe('pending');
      const [row] = await db
        .select()
        .from(feedbackReport)
        .where(eq(feedbackReport.id, queued.json().id));
      expect(row?.failure).toBeNull();
      expect(row?.attempts).toBe(0);
      expect((row?.nextAttemptAt.getTime() ?? 0) - Date.now()).toBeGreaterThan(200000);
      // When its turn comes it really goes.
      relayWait = 0;
      await db
        .update(feedbackReport)
        .set({ nextAttemptAt: new Date(0) })
        .where(eq(feedbackReport.id, queued.json().id));
      await sweepFeedback(app);
      const [sent] = await db
        .select()
        .from(feedbackReport)
        .where(eq(feedbackReport.id, queued.json().id));
      expect(sent?.delivery).toBe('delivered');

      // An answer that never came: an administrator can send it again from Settings.
      await db
        .update(feedbackReport)
        .set({ delivery: 'uncertain' })
        .where(eq(feedbackReport.id, queued.json().id));
      const retried = await app.inject({
        method: 'PUT',
        url: '/api/v1/feedback/settings',
        headers: headers(),
        payload: { destination: 'relay', repository: null, guests: false, retentionDays: 90 },
      });
      expect(retried.statusCode).toBe(200);
      const [again] = await db
        .select()
        .from(feedbackReport)
        .where(eq(feedbackReport.id, queued.json().id));
      expect(again?.delivery).toBe('pending');

      // Riprova: a member can't press it, too early it goes on waiting...
      const retry = (who: Record<string, string>) =>
        app.inject({
          method: 'POST',
          url: `/api/v1/feedback/reports/${queued.json().id}/retry`,
          headers: who,
          payload: {},
        });
      expect((await retry(reporter)).statusCode).toBe(403);
      relayWait = 300000;
      expect((await retry(headers())).json().delivery).toBe('pending');
      // ...and its turn sends it now, though the next attempt is minutes away, and only once.
      relayWait = 0;
      const sentBefore = relaySent;
      expect((await retry(headers())).json().delivery).toBe('delivered');
      expect(relaySent).toBe(sentBefore + 1);
      expect((await retry(headers())).json().delivery).toBe('delivered');
      expect(relaySent).toBe(sentBefore + 1);
      await db.delete(instanceSetting).where(eq(instanceSetting.key, 'feedback'));
    } finally {
      config.FEEDBACK_RELAY_URL = '';
      config.FEEDBACK_GITHUB_TOKEN = token;
    }
  });
  it('refuses to choose the relay when this server turned it off', async () => {
    const saved = await app.inject({
      method: 'PUT',
      url: '/api/v1/feedback/settings',
      headers: headers(),
      payload: { destination: 'relay', repository: null, guests: false, retentionDays: 90 },
    });
    expect(saved.statusCode).toBe(400);
    expect(saved.body).toContain('FEEDBACK_RELAY_URL');
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
    expect(served.headers['content-disposition']).toBe(
      'inline; filename="attachment"; filename*=UTF-8\'\'test.png',
    );
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
    issueStatus = 429;
    const limited = await send();
    issueStatus = 200;
    // Saved and accepted although GitHub said no; a 4xx created nothing, so it stays in the queue.
    expect(limited.statusCode).toBe(201);
    expect(limited.json()).toMatchObject({ delivery: 'pending', issueUrl: null });
    expect(limited.json().reference).toMatch(/^#local-\d+$/);
    const [waiting] = await db
      .select()
      .from(feedbackReport)
      .where(eq(feedbackReport.id, limited.json().id));
    expect(waiting?.attempts).toBe(1);
    expect(waiting?.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
    // A 5xx or a lost connection during the write may have created the issue: never sent twice.
    issueStatus = 503;
    const failed = await send();
    issueStatus = 200;
    expect(failed.json().delivery).toBe('uncertain');
    dropWrites = true;
    const lost = await send();
    dropWrites = false;
    expect(lost.statusCode).toBe(201);
    expect(lost.json().delivery).toBe('uncertain');
    expect(logged.join('')).not.toContain('fake-test-credential');
    expect(logged.join('')).not.toContain('Bearer');
  });
  it('stops at a permanent refusal, says why, and tries again once an administrator saves', async () => {
    const reporter = await newReporter('refused');
    const send = () =>
      app.inject({
        method: 'POST',
        url: '/api/v1/feedback',
        headers: reporter,
        payload: submit({ type: 'idea', diagnostics: {} }),
      });
    issueStatus = 422;
    const refused = await send();
    issueStatus = 200;
    expect(refused.json().delivery).toBe('refused');
    expect(logged.join('')).toContain('GitHub HTTP 422');
    const listed = (
      await app.inject({ url: '/api/v1/feedback/reports', headers: headers() })
    ).json();
    expect(listed.items.find((r: { id: string }) => r.id === refused.json().id)).toMatchObject({
      delivery: 'refused',
      failure: 'GitHub HTTP 422',
    });
    await app.inject({
      method: 'PUT',
      url: '/api/v1/feedback/settings',
      headers: headers(),
      payload: { destination: 'github', repository: 'test/feedback', guests: false },
    });
    const [again] = await db
      .select()
      .from(feedbackReport)
      .where(eq(feedbackReport.id, refused.json().id));
    expect(again).toMatchObject({ delivery: 'pending', failure: null });
    // A repository that turned public is refused too, and receives nothing.
    privateRepo = false;
    const before = issueCount;
    const notPrivate = await send();
    privateRepo = true;
    expect(notPrivate.json().delivery).toBe('refused');
    expect(issueCount).toBe(before);
  });
  it('sends nothing queued to a repository the administrator has left', async () => {
    const reporter = await newReporter('moved');
    issueStatus = 429;
    const queued = await app.inject({
      method: 'POST',
      url: '/api/v1/feedback',
      headers: reporter,
      payload: submit({ type: 'idea', diagnostics: {} }),
    });
    issueStatus = 200;
    expect(queued.json().delivery).toBe('pending');
    await app.inject({
      method: 'PUT',
      url: '/api/v1/feedback/settings',
      headers: headers(),
      payload: { destination: 'inbox', repository: null, guests: false },
    });
    await db
      .update(feedbackReport)
      .set({ nextAttemptAt: new Date(0) })
      .where(eq(feedbackReport.id, queued.json().id));
    const before = issueCount;
    await sweepFeedback(app);
    const [row] = await db
      .select()
      .from(feedbackReport)
      .where(eq(feedbackReport.id, queued.json().id));
    expect(row?.delivery).toBe('inbox');
    expect(issueCount).toBe(before);
    await app.inject({
      method: 'PUT',
      url: '/api/v1/feedback/settings',
      headers: headers(),
      payload: { destination: 'github', repository: 'test/feedback', guests: false },
    });
  });
  it('reads uploads as a stream, stops at the limit and leaves nothing behind', async () => {
    const reporter = await newReporter('stream');
    let produced = 0;
    const endless = Readable.from(
      (function* () {
        for (let i = 0; i < 100; i++) {
          produced += 1024 * 1024;
          yield Buffer.alloc(1024 * 1024, 65);
        }
      })(),
    );
    const temp = () =>
      readdir(tmpdir()).then((names) => names.filter((n) => n.startsWith('clip-feedback-')));
    const before = await temp();
    // No Content-Length: only the reading itself can tell.
    const big = await app.inject({
      method: 'POST',
      url: '/api/v1/feedback/attachments?kind=file&name=big.txt',
      headers: { ...reporter, 'content-type': 'application/octet-stream' },
      payload: endless,
    });
    expect(big.statusCode).toBe(413);
    expect(produced).toBeLessThan(30 * 1024 * 1024);
    expect(await temp()).toEqual(before);
    const exe = await app.inject({
      method: 'POST',
      url: '/api/v1/feedback/attachments?kind=file&name=x.exe',
      headers: { ...reporter, 'content-type': 'application/octet-stream' },
      payload: Buffer.from([0x4d, 0x5a, 0, 0, 1, 2, 3]),
    });
    expect(exe.statusCode).toBe(400);
  });
  it('takes the GPS out of a photo sent as a file, and keeps stored files sandboxed', async () => {
    const reporter = await newReporter('photo');
    const photo = await sharp({
      create: { width: 12, height: 12, channels: 3, background: 'white' },
    })
      .withExif({ IFD3: { GPSLatitude: '45/1 0/1 0/1' } })
      .jpeg()
      .toBuffer();
    expect((await sharp(photo).metadata()).exif).toBeDefined();
    const uploaded = await app.inject({
      method: 'POST',
      url: '/api/v1/feedback/attachments?kind=file&name=foto.jpg',
      headers: { ...reporter, 'content-type': 'application/octet-stream' },
      payload: photo,
    });
    expect(uploaded.statusCode).toBe(201);
    expect(uploaded.json().mime).toBe('image/jpeg');
    await app.inject({
      method: 'POST',
      url: '/api/v1/feedback',
      headers: reporter,
      payload: submit({ type: 'idea', diagnostics: {}, attachments: [uploaded.json()] }),
    });
    const enforcing = loadConfig({
      NODE_ENV: 'test',
      REGISTRATION: 'open',
      AUTH_RATE_LIMITS: 'off',
      PUBLIC_URL: 'http://localhost:3000',
      DATABASE_URL: config.DATABASE_URL,
      AUTH_SECRET: 'feedback-test-secret-feedback-test-secret-338',
      CSP_ENFORCE: 'true',
    });
    const strict = await createApp({
      config: enforcing,
      db,
      auth: createAuth(enforcing, db),
      log: pino({ level: 'silent' }),
      ...sharedDeps,
    });
    try {
      const served = await strict.inject(`/api/v1/feedback/attachments/${uploaded.json().id}`);
      expect(served.statusCode).toBe(200);
      expect((await sharp(served.rawPayload).metadata()).exif).toBeUndefined();
      expect(served.headers['content-security-policy']).toContain('sandbox');
    } finally {
      await strict.close();
    }
  });
  it('tells a person over the upload budget when to come back', async () => {
    const reporter = await newReporter('budget');
    let last = await uploadOne(reporter);
    for (let i = 0; i < 30 && last.statusCode !== 429; i++) last = await uploadOne(reporter);
    expect(last.statusCode).toBe(429);
    expect(Number(last.headers['retry-after'])).toBeGreaterThan(0);
  });
  it('keeps reports waiting locally while the destination is GitHub without a token', async () => {
    const noToken = loadConfig({
      NODE_ENV: 'test',
      REGISTRATION: 'open',
      AUTH_RATE_LIMITS: 'off',
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
    const shot = await app.inject({
      method: 'POST',
      url: `${prefix}/attachments?kind=screenshot&name=guest.png`,
      headers: { ...guestHeaders, 'content-type': 'application/octet-stream' },
      payload: await sharp({
        create: { width: 12, height: 12, channels: 3, background: 'white' },
      })
        .png()
        .toBuffer(),
    });
    expect(shot.statusCode).toBe(201);
    const withShot = await app.inject({
      method: 'POST',
      url: prefix,
      headers: guestHeaders,
      payload: submit({
        guestName: 'Guest Person',
        diagnostics: { page: '/guest/[id]' },
        attachments: [shot.json()],
      }),
    });
    expect(withShot.statusCode).toBe(201);
    const [fromGuest] = await db
      .select()
      .from(feedbackReport)
      .where(eq(feedbackReport.id, withShot.json().id));
    expect(fromGuest?.reporter).toBe('Guest P. (guest)');
    expect(
      (
        await app.inject({
          method: 'POST',
          url: prefix,
          headers: guestHeaders,
          payload: submit({ diagnostics: { page: '/guest/[id]' } }),
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
