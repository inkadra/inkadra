import { InstanceRelease, type InstanceUpdates, z } from '@inkadra/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { VERSION } from './config.ts';
import type { Database } from './db/client.ts';
import { instanceSetting, notification, user } from './db/schema.ts';
import { LANGUAGES } from './mail-texts.ts';
import { newerRelease, plainLine, semver } from './release-news.ts';
import { safeFetch } from './safe-fetch.ts';

/**
 * Update check (#515, decision 0080): the server reads the releases of Inkadra from GitHub every
 * 6 hours, sending nothing about the instance, and keeps the answer in `instance_setting`.
 * Release notes come from outside: only plain text lines leave this module. The hand-written
 * notes of each language are the `release-notes.<lang>.md` assets of the release.
 */

// UPDATE_CHECK_URL is for the end-to-end tests only, which must not reach GitHub.
const RELEASES_URL =
  process.env.UPDATE_CHECK_URL ??
  'https://api.github.com/repos/inkadra/inkadra/releases?per_page=30';
export const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
/** After a failed check GitHub is asked again this soon; the job runs this often. */
export const RETRY_MS = 15 * 60 * 1000;
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

/** The newest releases whose hand-written notes are read: the page shows no older ones. */
const NOTES_RELEASES = 10;

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
  /** A `release-notes.<lang>.md` asset; the address is built here, never taken from the answer. */
  async fetchNotes(version: string, lang: string): Promise<string> {
    const res = await safeFetch(
      `https://github.com/inkadra/inkadra/releases/download/v${version}/release-notes.${lang}.md`,
      {
        maxBytes: 256 * 1024,
        accept: ['application/octet-stream', 'text/'],
        timeoutMs: 10_000,
      },
    );
    // Downloads redirect to GitHub's storage; nothing else is read.
    const host = new URL(res.url).hostname;
    if (host !== 'github.com' && !host.endsWith('.githubusercontent.com'))
      throw new Error(`Release notes redirected to ${host}`);
    return res.body.toString('utf8');
  },
};

/** Section headings of the notes in the languages they are written in. */
const HIGHLIGHTS =
  /^#{2,6}\s+(?:highlights|what'?s new|novità|novedades|neuigkeiten|nouveautés|novidades)\s*$/i;
const BEFORE_UPDATING =
  /^#{2,6}\s.*(?:before (?:upgrading|updating)|prima di aggiornare|antes de (?:actualizar|atualizar)|vor dem (?:update|aktualisieren)|avant (?:de mettre à jour|la mise à jour))/i;

/** The lines under the first heading matching `heading`, as plain text. */
function section(lines: string[], heading: RegExp, limit: number): string[] {
  const start = lines.findIndex((l) => /^#{2,6}\s/.test(l) && heading.test(l));
  if (start < 0) return [];
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^#{1,6}\s/.test(l) || /^-{3,}\s*$/.test(l));
  return (end >= 0 ? rest.slice(0, end) : rest)
    .filter((l) => /^\s*(?:[-*+] |\d+[.)] )/.test(l))
    .map((l) => plainLine(l, 4000))
    .filter(Boolean)
    .map((l) => (l.length > 280 ? `${l.slice(0, 279).trimEnd()}…` : l))
    .slice(0, limit);
}

/** The news of release notes in Markdown, reduced to plain text. */
export function parseNotes(markdown: string): { highlights: string[]; beforeUpdating: string[] } {
  const lines = markdown
    .slice(0, 64_000)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .split(/\r?\n/);
  return {
    highlights: section(lines, HIGHLIGHTS, 5),
    beforeUpdating: section(lines, BEFORE_UPDATING, 10),
  };
}

type Parsed = InstanceRelease & { noteLangs: string[] };

/**
 * The releases of a GitHub answer, newest first, reduced to plain text. Pull request titles
 * ("What's Changed") are never used: they are written for developers.
 */
export function parseReleases(json: unknown): Parsed[] {
  if (!Array.isArray(json)) return [];
  const out: Parsed[] = [];
  for (const raw of json.slice(0, 100)) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    if (r.draft === true || typeof r.tag_name !== 'string') continue;
    const version = r.tag_name.replace(/^v/, '');
    const parts = semver.exec(version);
    if (!parts || version.length > 64 || version.includes('+')) continue;
    const published = typeof r.published_at === 'string' ? new Date(r.published_at) : null;
    const noteLangs = (Array.isArray(r.assets) ? r.assets : [])
      .map((a) => /^release-notes\.([a-z]{2})\.md$/.exec(String(a?.name ?? ''))?.[1])
      .filter((l): l is string => !!l && LANGUAGES.includes(l));
    out.push({
      version,
      publishedAt: published && !Number.isNaN(published.getTime()) ? published.toISOString() : null,
      prerelease: !!parts[4],
      // Built from the version, never taken from the answer.
      url: `https://github.com/inkadra/inkadra/releases/tag/v${version}`,
      ...parseNotes(typeof r.body === 'string' ? r.body : ''),
      noteLangs: [...new Set(noteLangs)],
    });
  }
  return out.sort((a, b) =>
    newerRelease(a.version, b.version) ? -1 : newerRelease(b.version, a.version) ? 1 : 0,
  );
}

/**
 * The hand-written notes of the newest releases, in every language the server speaks that has
 * an asset. A missing or failed language is left out and asked again at the next check.
 * shortcut: notes already cached for a version are not read again, so an asset replaced after
 * the release shows only after the cache is cleared; compare the asset's `updated_at` if that
 * ever matters.
 */
export async function withNotes(
  releases: Parsed[],
  cached: InstanceRelease[],
): Promise<InstanceRelease[]> {
  return Promise.all(
    releases.map(async ({ noteLangs, ...release }, i) => {
      const known = cached.find((c) => c.version === release.version)?.notes ?? {};
      const notes: NonNullable<InstanceRelease['notes']> = {};
      await Promise.all(
        (i < NOTES_RELEASES ? noteLangs : []).map(async (lang) => {
          const cachedNotes = known[lang];
          if (cachedNotes) {
            notes[lang] = cachedNotes;
            return;
          }
          try {
            notes[lang] = parseNotes(await updateSource.fetchNotes(release.version, lang));
          } catch {
            // Asked again at the next check.
          }
        }),
      );
      return Object.keys(notes).length ? { ...release, notes } : release;
    }),
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

/** Whether the stored answer is recent enough; a failure is retried after `RETRY_MS`. */
function fresh(stored: Stored, maxAge: number): boolean {
  if (!stored.checkedAt) return false;
  const age = Date.now() - Date.parse(stored.checkedAt);
  return age < (stored.failed ? Math.min(maxAge, RETRY_MS) : maxAge);
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
      if (!settings.enabled || fresh(await readStored(db), maxAge)) return;
      await db.transaction(async (tx) => {
        // Web and worker processes take turns: whoever waited finds the answer and asks nothing.
        await tx.execute(sql`select pg_advisory_xact_lock(377, 3)`);
        const stored = await readStored(tx);
        if (fresh(stored, maxAge)) return;
        let releases: InstanceRelease[] | null = null;
        try {
          releases = await withNotes(
            parseReleases(await updateSource.fetchReleases()),
            stored.releases,
          );
        } catch {
          releases = null;
        }
        const next: Stored = releases
          ? { ...stored, checkedAt: new Date().toISOString(), failed: false, releases }
          : { ...stored, checkedAt: new Date().toISOString(), failed: true };
        const available = availableRelease(next.releases, VERSION, settings.channel);
        // Newer than the last announced one: going back from previews to stable stays quiet.
        if (
          releases &&
          available &&
          (!stored.notified || newerRelease(available.version, stored.notified))
        ) {
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

/** What the Updates page shows. A running version that is not SemVer (edge) is never compared. */
export function updatesView(
  stored: Stored,
  settings: { enabled: boolean; channel: Channel },
  current: string,
): InstanceUpdates {
  const edge = !semver.test(current);
  return {
    current,
    edge,
    checkEnabled: settings.enabled,
    channel: settings.channel,
    checkedAt: stored.checkedAt,
    failed: stored.failed,
    available:
      settings.enabled && !edge
        ? availableRelease(stored.releases, current, settings.channel)
        : null,
    earlier: edge
      ? []
      : stored.releases
          .filter(
            (r) => !newerRelease(r.version, current) && (!r.prerelease || r.version === current),
          )
          .slice(0, 6),
  };
}

export async function readUpdates(db: Database): Promise<InstanceUpdates> {
  return updatesView(await readStored(db), await readSettings(db), VERSION);
}

export { CHECK_NOW_MS };
