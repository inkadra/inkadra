import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createDatabase, runMigrations } from './db/client.ts';
import { instanceSetting, notification, user } from './db/schema.ts';
import {
  availableRelease,
  checkForUpdates,
  parseReleases,
  readUpdates,
  updateSource,
  updatesView,
} from './updates.ts';

const body = [
  'Image: `ghcr.io/inkadra/inkadra:1.1.0`. Install: [docs](https://example.com/docs).',
  '',
  '## Highlights',
  '',
  '- **Phones:** Inkadra in the [browser](https://example.com/b) <img src=x onerror=alert(1)>',
  '- Crew confirm <script>alert(1)</script>from their phone https://evil.example/x',
  '',
  '## Read before upgrading',
  '',
  '- **Reports:** set `FEEDBACK_RELAY_URL=` first.',
  '',
  '---',
  '',
  "## What's Changed",
  '* Ignored when there are highlights by @someone in https://github.com/inkadra/inkadra/pull/1',
].join('\n');

const github = [
  {
    tag_name: 'v1.0.0',
    published_at: '2026-11-01T10:00:00Z',
    body: "## What's Changed\n* feat(web): Fix uploads by @a in https://github.com/x/pull/2\n* build(deps): Bump vite by @dependabot[bot] in https://x",
  },
  { tag_name: 'v1.1.0-rc.1', prerelease: true, published_at: '2026-11-05T10:00:00Z', body },
  { tag_name: 'v1.1.0', published_at: 'not a date', body, html_url: 'https://evil.example' },
  { tag_name: 'v2.0.0', draft: true, body },
  { tag_name: 'nightly', body },
  'garbage',
];

describe('releases from GitHub (#515)', () => {
  it('keep plain text only, newest first, with links built from the version', () => {
    const releases = parseReleases(github);
    expect(releases.map((r) => r.version)).toEqual(['1.1.0', '1.1.0-rc.1', '1.0.0']);
    const [latest, rc, old] = releases;
    expect(latest).toEqual({
      version: '1.1.0',
      publishedAt: null,
      prerelease: false,
      url: 'https://github.com/inkadra/inkadra/releases/tag/v1.1.0',
      highlights: ['Phones: Inkadra in the browser', 'Crew confirm from their phone'],
      beforeUpdating: ['Reports: set FEEDBACK_RELAY_URL= first.'],
    });
    expect(rc?.prerelease).toBe(true);
    expect(rc?.publishedAt).toBe('2026-11-05T10:00:00.000Z');
    // Older notes have no highlights: the merged pull requests, without bumps and authors.
    expect(old?.highlights).toEqual(['Fix uploads']);
    expect(parseReleases({ message: 'rate limited' })).toEqual([]);
    const long = parseReleases([
      { tag_name: 'v3.0.0', body: `## Highlights\n- ${'word '.repeat(80)}` },
    ]);
    expect(long[0]?.highlights[0]).toMatch(/^.{1,279}…$/);
  });

  it('announce stable releases only, unless the channel takes previews', () => {
    const releases = parseReleases(github);
    expect(availableRelease(releases, '1.0.0', 'stable')?.version).toBe('1.1.0');
    expect(availableRelease(releases.slice(1), '1.0.0', 'stable')).toBeNull();
    expect(availableRelease(releases.slice(1), '1.0.0', 'preview')?.version).toBe('1.1.0-rc.1');
    expect(availableRelease(releases, '1.1.0', 'preview')).toBeNull();
    // Edge builds are not compared.
    expect(availableRelease(releases, 'edge', 'preview')).toBeNull();
  });

  it('list no earlier versions and no update for an edge build', () => {
    const stored = { checkedAt: null, failed: false, releases: parseReleases(github), notified: null };
    const settings = { enabled: true, channel: 'stable' as const };
    const edge = updatesView(stored, settings, 'edge');
    expect(edge).toMatchObject({ edge: true, available: null, earlier: [] });
    const release = updatesView(stored, settings, '1.0.0');
    expect(release.edge).toBe(false);
    expect(release.available?.version).toBe('1.1.0');
    expect(release.earlier.map((r) => r.version)).toEqual(['1.0.0']);
  });
});

const url = process.env.DATABASE_URL;
describe.skipIf(!url)('the update check', () => {
  const { db, sql: client } = createDatabase(url ?? 'postgres://unused');
  const admin = randomUUID();
  beforeAll(async () => {
    await runMigrations(url!, fileURLToPath(new URL('../drizzle', import.meta.url)));
    await db
      .insert(user)
      .values({ id: admin, name: 'Updates', email: `${admin}@example.com`, role: 'admin' });
    await db.delete(instanceSetting).where(eq(instanceSetting.key, 'updates'));
    await db.delete(instanceSetting).where(eq(instanceSetting.key, 'administration'));
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    await db.delete(user).where(eq(user.id, admin));
    await db.delete(instanceSetting).where(eq(instanceSetting.key, 'updates'));
    await db.delete(instanceSetting).where(eq(instanceSetting.key, 'administration'));
    await client.end();
  });

  it('caches the answer, notifies administrators once per version and survives a failure', async () => {
    const fetch = vi
      .spyOn(updateSource, 'fetchReleases')
      .mockResolvedValue([{ tag_name: 'v999.0.0', published_at: '2026-11-06T10:00:00Z', body }]);
    await checkForUpdates(db);
    await checkForUpdates(db);
    expect(fetch).toHaveBeenCalledTimes(1);
    fetch.mockRejectedValueOnce(new Error('offline'));
    await checkForUpdates(db, 0);
    const updates = await readUpdates(db);
    expect(updates.failed).toBe(true);
    expect(updates.available?.version).toBe('999.0.0');
    await checkForUpdates(db, 0);
    expect((await readUpdates(db)).failed).toBe(false);
    const sent = await db
      .select()
      .from(notification)
      .where(and(eq(notification.userId, admin), eq(notification.type, 'update_available')));
    expect(sent).toHaveLength(1);
    expect(sent[0]?.emailedAt).not.toBeNull();
  });

  const sentCount = async () =>
    (
      await db
        .select()
        .from(notification)
        .where(and(eq(notification.userId, admin), eq(notification.type, 'update_available')))
    ).length;
  const channel = (updateChannel: 'stable' | 'preview') =>
    db
      .insert(instanceSetting)
      .values({ key: 'administration', value: { updateChannel } })
      .onConflictDoUpdate({ target: instanceSetting.key, set: { value: { updateChannel } } });

  it('does not announce an older release again after the channel goes back to stable', async () => {
    vi.spyOn(updateSource, 'fetchReleases').mockResolvedValue([
      { tag_name: 'v999.0.0', body },
      { tag_name: 'v999.1.0-rc.1', prerelease: true, body },
    ]);
    const before = await sentCount();
    await channel('preview');
    await checkForUpdates(db, 0);
    expect(await sentCount()).toBe(before + 1);
    await channel('stable');
    await checkForUpdates(db, 0);
    expect((await readUpdates(db)).available?.version).toBe('999.0.0');
    expect(await sentCount()).toBe(before + 1);
  });

  it('retries a failed check after 15 minutes, not 6 hours', async () => {
    const fetch = vi.spyOn(updateSource, 'fetchReleases').mockRejectedValue(new Error('offline'));
    const failedAt = async (minutesAgo: number) => {
      await checkForUpdates(db, 0);
      await db.execute(
        sql`update instance_setting set value = jsonb_set(value, '{checkedAt}', to_jsonb(${new Date(Date.now() - minutesAgo * 60_000).toISOString()}::text)) where key = 'updates'`,
      );
      fetch.mockClear();
    };
    await failedAt(10);
    await checkForUpdates(db);
    expect(fetch).not.toHaveBeenCalled();
    await failedAt(16);
    await checkForUpdates(db);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
