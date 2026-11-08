import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DemoInfo, DemoRefusalReason, DemoSandbox } from '@inkadra/shared';
import { and, count, eq, inArray, like, lt, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import type { Config } from './config.ts';
import type { Database } from './db/client.ts';
import { project, projectMember, projectTransfer, shootingDay, user } from './db/schema.ts';
import { HttpError } from './http/errors.ts';
import { projectFiles } from './http/projects-routes.ts';
import type { Jobs } from './jobs.ts';
import { safeFetch } from './safe-fetch.ts';
import type { Storage } from './storage.ts';
import { importProject } from './transfers/import.ts';
import { transferFile } from './transfers/service.ts';

/**
 * The public demo (decision 0084). A sandbox is an account without email or password, made by
 * "Try the demo" with a copy of the sample project, and removed with its files after DEMO_TTL:
 * the only data Inkadra ever deletes on its own. Sandboxes are told apart by their address, on
 * a reserved domain no mail can reach, so the schema has nothing of the demo.
 */
export const DEMO_DOMAIN = 'demo.invalid';
export const isSandbox = (email: string) => email.endsWith(`@${DEMO_DOMAIN}`);
const sandboxes = and(like(user.email, `%@${DEMO_DOMAIN}`), eq(user.role, 'member'));

const here = dirname(fileURLToPath(import.meta.url));
/** The archive of the sample project "Last Train"; in the image next to dist/, as drizzle/. */
export const DEMO_SEED = process.env.DEMO_SEED ?? join(here, '..', 'demo', 'last-train.inkadra');

export type DemoConfig = Pick<
  Config,
  | 'DEMO_TTL'
  | 'DEMO_STORAGE'
  | 'DEMO_MAX_SANDBOXES'
  | 'UPLOAD_MAX_SIZE'
  | 'IMPORT_MAX_SIZE'
  | 'STORAGE_LIMIT'
  | 'STORAGE_LIMIT_PER_USER'
  | 'DATA_DIR'
  | 'TURNSTILE_SITE_KEY'
  | 'TURNSTILE_SECRET'
>;

export interface DemoDeps {
  db: Database;
  storage: Storage;
  jobs: Pick<Jobs, 'processAsset' | 'deleteFiles'>;
  config: DemoConfig;
  log?: Logger;
  /** Tests: another archive than DEMO_SEED. */
  seed?: string;
}

export const refuse = (code: 'forbidden' | 'rate_limited', reason: DemoRefusalReason) =>
  new HttpError(code, `Demo refused: ${reason}.`, { reason });

export async function openSandboxes(db: Pick<Database, 'select'>): Promise<number> {
  const [row] = await db.select({ n: count() }).from(user).where(sandboxes);
  return row?.n ?? 0;
}

export async function demoInfo(db: Database, config: DemoConfig): Promise<DemoInfo> {
  return {
    ttlSeconds: Math.round(config.DEMO_TTL / 1000),
    storageBytes: config.DEMO_STORAGE,
    fileBytes: config.UPLOAD_MAX_SIZE,
    maxSandboxes: config.DEMO_MAX_SANDBOXES,
    full: (await openSandboxes(db)) >= config.DEMO_MAX_SANDBOXES,
    turnstileSiteKey: config.TURNSTILE_SITE_KEY ?? null,
  };
}

/**
 * Asks Cloudflare whether the visitor passed the Turnstile check, through the same guarded
 * fetch as link previews. Any doubt (no answer, a bad one) is a refusal.
 */
export async function verifyTurnstile(
  secret: string,
  token: string | undefined,
  remoteIp: string,
  fetcher: typeof safeFetch = safeFetch,
): Promise<boolean> {
  if (!token) return false;
  const body = new URLSearchParams({ secret, response: token, remoteip: remoteIp });
  try {
    const res = await fetcher('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: body.toString(),
      bodyType: 'application/x-www-form-urlencoded',
      accept: ['application/json'],
      maxBytes: 16 * 1024,
      timeoutMs: 8000,
      maxRedirects: 0,
    });
    const answer = JSON.parse(res.body.toString('utf8')) as { success?: unknown };
    return answer.success === true;
  } catch {
    return false;
  }
}

/**
 * Makes a sandbox: the account under the instance-wide cap, then the sample project. The cap
 * is counted under a lock, so a burst of visitors cannot pass it together.
 */
export async function createSandbox(deps: DemoDeps): Promise<string> {
  const { db, config } = deps;
  const id = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('demo-sandboxes'))`);
    if ((await openSandboxes(tx)) >= config.DEMO_MAX_SANDBOXES)
      throw refuse('rate_limited', 'demo_full');
    const [row] = await tx
      .insert(user)
      .values({
        name: 'Demo',
        email: `${randomUUID()}@${DEMO_DOMAIN}`,
        emailVerified: true,
        role: 'member',
        // The sample project is the only one: a sandbox cannot make more.
        canCreateProjects: false,
      })
      .returning({ id: user.id });
    if (!row) throw new Error('Sandbox insert returned nothing');
    return row.id;
  });
  try {
    const { projectId } = await importProject(
      {
        db,
        storage: deps.storage,
        jobs: deps.jobs,
        uploadMaxSize: config.UPLOAD_MAX_SIZE,
        importMaxSize: config.IMPORT_MAX_SIZE,
        storageEnv: config,
        ...(deps.log ? { log: deps.log } : {}),
      },
      deps.seed ?? DEMO_SEED,
      id,
    );
    // The shooting days of the sample start today, whenever the sandbox opens.
    await db.execute(sql`update ${shootingDay} set date = to_char(
        ${shootingDay.date}::date + (current_date - (select min(d.date)::date from ${shootingDay} d
          where d.project_id = ${projectId})), 'YYYY-MM-DD')
      where ${shootingDay.projectId} = ${projectId}`);
  } catch (err) {
    await endSandbox(deps, id);
    throw err;
  }
  return id;
}

/** The sandbox of a signed-in account, or null for any other account. */
export async function readSandbox(
  db: Database,
  config: DemoConfig,
  userId: string,
): Promise<DemoSandbox | null> {
  const [row] = await db
    .select({ email: user.email, createdAt: user.createdAt })
    .from(user)
    .where(eq(user.id, userId));
  if (!row || !isSandbox(row.email)) return null;
  const [own] = await db
    .select({ id: projectMember.projectId })
    .from(projectMember)
    .where(eq(projectMember.userId, userId))
    .limit(1);
  return {
    expiresAt: new Date(row.createdAt.getTime() + config.DEMO_TTL).toISOString(),
    projectId: own?.id ?? null,
    exportUsed: (await exportsOf(db, userId)) >= 1,
  };
}

/** Exports a sandbox made, failed ones aside. */
export async function exportsOf(db: Pick<Database, 'select'>, userId: string) {
  const [row] = await db
    .select({ n: count() })
    .from(projectTransfer)
    .where(
      and(
        eq(projectTransfer.userId, userId),
        eq(projectTransfer.kind, 'export'),
        sql`${projectTransfer.status} <> 'failed'`,
      ),
    );
  return row?.n ?? 0;
}

/**
 * Removes a sandbox: its projects with their files, its export archives, then the account,
 * whose sessions, memberships and notifications cascade. Only sandbox accounts are touched.
 */
export async function endSandbox(deps: Pick<DemoDeps, 'db' | 'jobs' | 'config'>, userId: string) {
  const { db } = deps;
  const archives = await db
    .select({ id: projectTransfer.id })
    .from(projectTransfer)
    .where(eq(projectTransfer.userId, userId));
  const keys = await db.transaction(async (tx) => {
    const [account] = await tx
      .select({ id: user.id })
      .from(user)
      .where(and(eq(user.id, userId), sandboxes));
    if (!account) return [];
    const own = await tx
      .select({ id: projectMember.projectId })
      .from(projectMember)
      .where(and(eq(projectMember.userId, userId), eq(projectMember.role, 'owner')));
    const ids = own.map((p) => p.id);
    const files = await projectFiles(tx, ids);
    if (ids.length > 0) await tx.delete(project).where(inArray(project.id, ids));
    await tx.delete(user).where(eq(user.id, userId));
    return files;
  });
  // Files after the rows, as for any project: a failure leaves orphan files, never rows.
  if (keys.length > 0) await deps.jobs.deleteFiles(keys);
  await Promise.all(
    archives.map((a) => rm(transferFile(deps.config.DATA_DIR, a.id), { force: true })),
  );
}

/** Removes every sandbox past DEMO_TTL; at start and then every minute. */
export async function sweepSandboxes(deps: Pick<DemoDeps, 'db' | 'jobs' | 'config' | 'log'>) {
  const expired = await deps.db
    .select({ id: user.id })
    .from(user)
    .where(and(sandboxes, lt(user.createdAt, new Date(Date.now() - deps.config.DEMO_TTL))));
  for (const row of expired) {
    try {
      await endSandbox(deps, row.id);
    } catch (err) {
      deps.log?.error({ err, userId: row.id }, 'demo sandbox not removed');
    }
  }
  return expired.length;
}

export function startSandboxSweep(deps: Pick<DemoDeps, 'db' | 'jobs' | 'config' | 'log'>) {
  const run = () =>
    sweepSandboxes(deps)
      .then((n) => n > 0 && deps.log?.info({ removed: n }, 'expired demo sandboxes removed'))
      .catch((err) => deps.log?.error({ err }, 'demo sweep failed'));
  void run();
  const timer = setInterval(run, 60_000);
  timer.unref();
  return () => clearInterval(timer);
}
