import { readFile } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { Database } from './db/client.ts';
import {
  instanceSetting,
  releaseAnnouncement,
  releaseDelivery,
  user,
  userPreference,
} from './db/schema.ts';
import { mailText } from './mail-texts.ts';
import { actionMail, type Mailer } from './mailer.ts';

// Strict SemVer, including numeric pre-release identifiers and build metadata.
const semver =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][\dA-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][\dA-Za-z-]*))*))?(?:\+[\dA-Za-z-]+(?:\.[\dA-Za-z-]+)*)?$/;
export function newerRelease(current: string, previous: string): boolean {
  const a = semver.exec(current);
  const b = semver.exec(previous);
  if (!a || !b) return false;
  for (let i = 1; i <= 3; i++) {
    if (BigInt(a[i] ?? '0') !== BigInt(b[i] ?? '0'))
      return BigInt(a[i] ?? '0') > BigInt(b[i] ?? '0');
  }
  if (!a[4] || !b[4]) return !a[4] && !!b[4];
  const x = a[4].split('.');
  const y = b[4].split('.');
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const l = x[i];
    const r = y[i];
    if (l === undefined || r === undefined) return r === undefined;
    if (l === r) continue;
    const ln = /^\d+$/.test(l);
    const rn = /^\d+$/.test(r);
    return ln && rn ? BigInt(l) > BigInt(r) : ln !== rn ? !ln : l > r;
  }
  return false;
}

export async function releaseNewsEnabled(db: Pick<Database, 'select'>) {
  const [row] = await db
    .select()
    .from(instanceSetting)
    .where(eq(instanceSetting.key, 'administration'));
  return row?.value.releaseNews !== false;
}

/** The DB is the outbox; enqueue is repeated after a crash between commit and Redis. */
export async function enqueueReleaseNews(
  db: Database,
  version: string,
  mailer: Mailer,
  enqueue: (version: string) => Promise<unknown>,
) {
  if (!semver.test(version) || !mailer.enabled || !(await releaseNewsEnabled(db))) return;
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(377, 1)`);
    const [last] = await tx
      .select()
      .from(releaseAnnouncement)
      .orderBy(desc(releaseAnnouncement.createdAt))
      .limit(1);
    if (last && !newerRelease(version, last.version)) return;
    await tx.insert(releaseAnnouncement).values({ version }).onConflictDoNothing();
    await tx.execute(sql`
      insert into release_delivery (version, user_id)
      select ${version}, u.id from "user" u join user_preference p on p.user_id = u.id
      where u.deactivated_at is null
        and p.preferences->'releaseNews' = 'true'::jsonb
      on conflict do nothing
    `);
  });
  for (const row of await db
    .select()
    .from(releaseAnnouncement)
    .where(isNull(releaseAnnouncement.completedAt))) {
    // An old stable container must not announce a pre-release from a rolling deployment.
    if (semver.exec(row.version)?.[4] && !semver.exec(version)?.[4]) continue;
    if (row.version === version || newerRelease(version, row.version)) await enqueue(row.version);
  }
}

export async function releaseNewsMail(
  person: { email: string; locale: string | null },
  version: string,
) {
  if (!semver.test(version)) throw new Error('Invalid release version');
  const t = mailText(person);
  const locale = person.locale?.startsWith('en') ? 'en' : 'it';
  let notes = '';
  // Plain text only: HTML/Markdown links from notes never become external email resources.
  for (const name of [`${version}.${locale}.md`, `${version}.md`]) {
    try {
      notes = await readFile(
        fileURLToPath(
          new URL(
            `${import.meta.url.endsWith('.ts') ? '../../../docs/releases/' : '../releases/'}${name}`,
            import.meta.url,
          ),
        ),
        'utf8',
      );
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }
  return actionMail(
    person.email,
    t.releaseSubject(version),
    [
      t.releaseIntro(version),
      ...(notes ? [notes.replace(/https?:\/\/\S+/g, '').slice(0, 4000)] : []),
      t.releaseConsent,
    ],
    { label: t.releaseAction, url: `https://github.com/inkadra/inkadra/releases/tag/v${version}` },
  );
}

/** One durable claim per person. A job retry resumes at the next unattempted recipient. */
export async function sendReleaseNews(db: Database, mailer: Mailer, version: string) {
  if (!mailer.enabled) return;
  while (await releaseNewsEnabled(db)) {
    const done = await db.transaction(async (tx) => {
      // Serialize sends across workers, including their rate limit; the claim survives crashes.
      await tx.execute(sql`select pg_advisory_xact_lock(377, 2)`);
      if (!(await releaseNewsEnabled(tx))) return null;
      const [row] = await tx
        .select({
          userId: releaseDelivery.userId,
          email: user.email,
          locale: user.locale,
          deactivated: user.deactivatedAt,
          preferences: userPreference.preferences,
        })
        .from(releaseDelivery)
        .innerJoin(user, eq(user.id, releaseDelivery.userId))
        .leftJoin(userPreference, eq(userPreference.userId, user.id))
        .where(and(eq(releaseDelivery.version, version), isNull(releaseDelivery.attemptedAt)))
        .limit(1);
      if (!row) {
        await tx
          .update(releaseAnnouncement)
          .set({ completedAt: new Date() })
          .where(eq(releaseAnnouncement.version, version));
        return null;
      }
      const mail =
        !row.deactivated && row.preferences?.releaseNews === true
          ? await releaseNewsMail(row, version)
          : null;
      await tx
        .update(releaseDelivery)
        .set({ attemptedAt: new Date() })
        .where(and(eq(releaseDelivery.version, version), eq(releaseDelivery.userId, row.userId)));
      if (mail) await setTimeout(1000);
      return { mail };
    });
    if (!done) return;
    if (done.mail) {
      // shortcut: SMTP has no idempotency key; an ambiguous failure is not retried (ADR 0058).
      await mailer.send(done.mail);
    }
  }
}
