import { InstanceRelease, type InstanceUpdates, z } from '@inkadra/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { VERSION } from './config.ts';
import type { Database } from './db/client.ts';
import { instanceSetting, notification, user } from './db/schema.ts';
import { newerRelease, plainLine, semver } from './release-news.ts';
import { safeFetch } from './safe-fetch.ts';

/**
 * Update check (#515, decision 0079): the server reads the releases of Inkadra from GitHub every
 * 6 hours, sending nothing about the instance, and keeps the answer in `instance_setting`.
 * Release notes come from outside: only plain text lines leave this module.
 */

// UPDATE_CHECK_URL is for the end-to-end tests only, which must not reach GitHub.
const RELEASES_URL =
  process.env.UPDATE_CHECK_URL ??
  'https://api.github.com/repos/inkadra/inkadra/releases?per_page=30';
export const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
/** "Check now" asks GitHub at most this often. */
const CHECK_NOW_MS = 60 * 1000;

const Stored = z.object({
  checkedAt: z.string().nullable().catch(null),
  failed: z.boolean().catch(false),
  releases: z.array(InstanceRelease).catch([]),
  /** The release administrators were already notified about. */
  notified: z.string().nullable().catch(null),
});
type Stored = z.infer<typeof Stored>;

type Channel = 'stable' | 'preview';

/** Overridable in tests, which never reach GitHub. */
export const updateSource = {
  async fetchReleases(): Promise<unknown> {
    const res = await safeFetch(RELEASES_URL, {
      maxBytes: 4 * 1024 * 1024,
      accept: ['application/json'],
      timeoutMs: 10_000,
    });
    return JSON.parse(res.body.toString('utf8'));
  },
};

/** The lines under the first `##` heading matching `heading`, as plain text. */
function section(lines: string[], heading: RegExp, limit: number): string[] {
  const start = lines.findIndex((l) => /^#{2,6}\s/.test(l) && heading.test(l));
  if (start < 0) return [];
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^#{1,6}\s/.test(l) || /^-{3,}\s*$/.test(l));
  return (end >= 0 ? rest.slice(0, end) : rest)
    .filter((l) => /^\s*(?:[-*+] |\d+[.)] )/.test(l))
    .map((l) =>
      plainLine(l, 4000)
        .replace(/\s+by @[\w-]+(?:\[bot\])?\s+in\s*$/i, '')
        // Conventional commit prefixes ("feat(web): ") say nothing to the people reading.
        .replace(/^[a-z]+(?:\([\w-]+\))?!?:\s+/, ''),
    )
    .filter((l) => l && !/\bbump\b/i.test(l))
    .map((l) => (l.length > 280 ? `${l.slice(0, 279).trimEnd()}…` : l))
    .slice(0, limit);
}

/** The releases of a GitHub answer, newest first, reduced to plain text. */
export function parseReleases(json: unknown): InstanceRelease[] {
  if (!Array.isArray(json)) return [];
  const out: InstanceRelease[] = [];
  for (const raw of json.slice(0, 100)) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    if (r.draft === true || typeof r.tag_name !== 'string') continue;
    const version = r.tag_name.replace(/^v/, '');
    const parts = semver.exec(version);
    if (!parts || version.length > 64 || version.includes('+')) continue;
    const published = typeof r.published_at === 'string' ? new Date(r.published_at) : null;
    const lines = (typeof r.body === 'string' ? r.body : '')
      .slice(0, 64_000)
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
      .split(/\r?\n/);
    const news = section(lines, /highlights|novità|what'?s new/i, 5);
    out.push({
      version,
      publishedAt: published && !Number.isNaN(published.getTime()) ? published.toISOString() : null,
      prerelease: !!parts[4],
      // Built from the version, never taken from the answer.
      url: `https://github.com/inkadra/inkadra/releases/tag/v${version}`,
      highlights: news.length ? news : section(lines, /what'?s changed/i, 5),
      beforeUpdating: section(lines, /before (?:upgrading|updating)|prima di aggiornare/i, 10),
    });
  }
  return out.sort((a, b) =>
    newerRelease(a.version, b.version) ? -1 : newerRelease(b.version, a.version) ? 1 : 0,
  );
}

/** The newest release of the channel that is newer than the running one. */
export function availableRelease(
  releases: InstanceRelease[],
  current: string,
  channel: Channel,
): InstanceRelease | null {
  return (
    releases.find(
      (r) => (channel === 'preview' || !r.prerelease) && newerRelease(r.version, current),
    ) ?? null
  );
}

async function readSettings(db: Pick<Database, 'select'>) {
  const [row] = await db
    .select()
    .from(instanceSetting)
    .where(eq(instanceSetting.key, 'administration'));
  return {
    enabled: row?.value.updateCheck !== false,
    channel: (row?.value.updateChannel === 'preview' ? 'preview' : 'stable') as Channel,
  };
}

async function readStored(db: Pick<Database, 'select'>): Promise<Stored> {
  const [row] = await db.select().from(instanceSetting).where(eq(instanceSetting.key, 'updates'));
  return Stored.parse(row?.value ?? {});
}

let running: Promise<void> | null = null;

/**
 * Asks GitHub for the releases unless the answer is younger than `maxAge`, stores it and
 * notifies the active administrators once about a new release of the channel.
 */
export function checkForUpdates(db: Database, maxAge = CHECK_EVERY_MS): Promise<void> {
  running ??= (async () => {
    try {
      const settings = await readSettings(db);
      const before = await readStored(db);
      if (!settings.enabled) return;
      if (before.checkedAt && Date.now() - Date.parse(before.checkedAt) < maxAge) return;
      let releases: InstanceRelease[] | null = null;
      try {
        releases = parseReleases(await updateSource.fetchReleases());
      } catch {
        releases = null;
      }
      await db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(377, 3)`);
        const stored = await readStored(tx);
        const next: Stored = releases
          ? { ...stored, checkedAt: new Date().toISOString(), failed: false, releases }
          : { ...stored, checkedAt: new Date().toISOString(), failed: true };
        const available = availableRelease(next.releases, VERSION, settings.channel);
        if (releases && available && available.version !== stored.notified) {
          const admins = await tx
            .select({ id: user.id })
            .from(user)
            .where(and(eq(user.role, 'admin'), isNull(user.deactivatedAt)));
          if (admins.length)
            await tx.insert(notification).values(
              // In-app only: emailedAt keeps it out of the notification emails.
              admins.map((a) => ({
                userId: a.id,
                type: 'update_available' as const,
                emailedAt: new Date(),
              })),
            );
          next.notified = available.version;
        }
        await tx
          .insert(instanceSetting)
          .values({ key: 'updates', value: next })
          .onConflictDoUpdate({
            target: instanceSetting.key,
            set: { value: next, updatedAt: new Date() },
          });
      });
    } finally {
      running = null;
    }
  })();
  return running;
}

/** What the Updates page shows, from the stored answer. */
export async function readUpdates(db: Database): Promise<InstanceUpdates> {
  const settings = await readSettings(db);
  const stored = await readStored(db);
  return {
    current: VERSION,
    checkEnabled: settings.enabled,
    channel: settings.channel,
    checkedAt: stored.checkedAt,
    failed: stored.failed,
    available: settings.enabled
      ? availableRelease(stored.releases, VERSION, settings.channel)
      : null,
    earlier: stored.releases
      .filter((r) => !newerRelease(r.version, VERSION) && (!r.prerelease || r.version === VERSION))
      .slice(0, 6),
  };
}

export { CHECK_NOW_MS };
