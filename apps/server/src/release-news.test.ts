import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, runMigrations } from './db/client.ts';
import {
  instanceSetting,
  releaseAnnouncement,
  releaseDelivery,
  user,
  userPreference,
} from './db/schema.ts';
import { memoryMailer, noMailer } from './mailer.ts';
import {
  enqueueReleaseNews,
  newerRelease,
  releaseNewsMail,
  sendReleaseNews,
} from './release-news.ts';

it.each([
  ['1.10.0', '1.9.0', true],
  ['1.0.0', '1.0.0-rc.2', true],
  ['1.0.0-rc.10', '1.0.0-rc.2', true],
  ['1.0.0-rc.1', '1.0.0', false],
  ['1.0.0+foo', '1.0.0+bar', false],
  ['edge', '1.0.0', false],
  ['1.0.0-01', '0.9.0', false],
  ['1.0.0-a', '1.0.0-1', true],
  ['1.0.0-rc.1', '1.0.0-rc', true],
  ['0.9.0', '1.0.0', false],
])('compares %s with %s', (a, b, result) => expect(newerRelease(a, b)).toBe(result));

it('renders localised fallback with only the project release URL', async () => {
  for (const locale of ['it', 'en']) {
    const mail = await releaseNewsMail({ email: 'news@example.com', locale }, '99.0.0');
    expect(mail.subject).toContain(locale === 'it' ? 'Novità' : 'news');
    expect(mail.html).not.toContain('<img');
    expect(mail.html?.match(/href="[^"]+"/g)).toEqual([
      'href="https://github.com/inkadra/inkadra/releases/tag/v99.0.0"',
    ]);
  }
});

const url = process.env.DATABASE_URL;
describe.skipIf(!url)('release outbox with test mailer', () => {
  const { db, sql: client } = createDatabase(url ?? 'postgres://unused');
  const ids = [randomUUID(), randomUUID(), randomUUID()];
  const mailer = memoryMailer();
  beforeAll(async () => {
    await runMigrations(url!, fileURLToPath(new URL('../drizzle', import.meta.url)));
    await db.insert(user).values(
      ids.map((id, i) => ({
        id,
        name: 'News test',
        email: `${id}@example.com`,
        deactivatedAt: i === 2 ? new Date() : null,
      })),
    );
    await db
      .insert(userPreference)
      .values(ids.map((userId, i) => ({ userId, preferences: { releaseNews: i !== 1 } })));
    await db
      .insert(instanceSetting)
      .values({ key: 'administration', value: { releaseNews: true } })
      .onConflictDoUpdate({ target: instanceSetting.key, set: { value: { releaseNews: true } } });
  });
  afterAll(async () => {
    for (const id of ids) await db.delete(user).where(eq(user.id, id));
    await db.delete(releaseDelivery).where(inArray(releaseDelivery.version, ['99.0.0', '99.0.1']));
    await db
      .delete(releaseAnnouncement)
      .where(inArray(releaseAnnouncement.version, ['99.0.0', '99.0.1']));
    await client.end();
  });
  it('claims concurrent starts once, filters opt-in, resumes, and respects SMTP/admin off', async () => {
    const queued = new Set<string>();
    const enqueue = async (v: string) => {
      queued.add(v);
    };
    await enqueueReleaseNews(db, '99.0.0', noMailer, enqueue);
    expect(queued.size).toBe(0);
    await Promise.all([
      enqueueReleaseNews(db, '99.0.0', mailer, enqueue),
      enqueueReleaseNews(db, '99.0.0', mailer, enqueue),
    ]);
    expect([...queued]).toEqual(['99.0.0']);
    await db
      .update(instanceSetting)
      .set({ value: { releaseNews: false } })
      .where(eq(instanceSetting.key, 'administration'));
    await sendReleaseNews(db, mailer, '99.0.0');
    expect(mailer.sent).toHaveLength(0);
    await db
      .update(instanceSetting)
      .set({ value: { releaseNews: true } })
      .where(eq(instanceSetting.key, 'administration'));
    await Promise.all([
      sendReleaseNews(db, mailer, '99.0.0'),
      sendReleaseNews(db, mailer, '99.0.0'),
    ]);
    await enqueueReleaseNews(db, '99.0.0', mailer, enqueue);
    await sendReleaseNews(db, mailer, '99.0.0');
    expect(mailer.sent.filter((m) => ids.some((id) => m.to === `${id}@example.com`))).toHaveLength(
      1,
    );
    await db
      .update(userPreference)
      .set({ preferences: { releaseNews: true } })
      .where(eq(userPreference.userId, ids[1] ?? ''));
    await enqueueReleaseNews(db, '99.0.1', mailer, enqueue);
    const failing = {
      enabled: true,
      async send() {
        throw new Error('SMTP delivery ambiguous');
      },
    };
    await expect(sendReleaseNews(db, failing, '99.0.1')).rejects.toThrow('SMTP delivery ambiguous');
    await sendReleaseNews(db, mailer, '99.0.1');
    await sendReleaseNews(db, mailer, '99.0.1');
    // The failed/ambiguous attempt is not repeated; the remaining recipient still receives it.
    expect(mailer.sent.filter((m) => ids.some((id) => m.to === `${id}@example.com`))).toHaveLength(
      2,
    );
  });
});
