import type { BoardNotice } from '@inkadra/doc-schema';
import type { BackupSettings, BoardColumn } from '@inkadra/shared';
import { Queue, QueueEvents, Worker } from 'bullmq';
import { and, eq, lt } from 'drizzle-orm';
import IORedis from 'ioredis';
import type { Logger } from 'pino';
import { sweepAccessExpiry } from './access-expiry.ts';
import {
  type BackupDeps,
  backupCron,
  readBackupSettings,
  reapStaleBackups,
  runBackup,
  STARTUP_STALE_MS,
  serverTimeZone,
  startBackup,
  sweepPartialBackups,
} from './backup.ts';
import type { BoardReader, StoredElement } from './board-content.ts';
import { type BoardNotifier, NOTICE_TTL_MS } from './board-notices.ts';
import {
  type AddCard,
  type AddCardResult,
  BoardEditNotStarted,
  type BoardWriter,
} from './board-writer.ts';
import type { Database } from './db/client.ts';
import { asset } from './db/schema.ts';
import type { Jobs } from './jobs.ts';
import { type Mailer, noMailer } from './mailer.ts';
import { type MediaDeps, markFailed, processAsset } from './media/process.ts';
import { purgeNotifications, sendDigests, sendImmediateEmails } from './notifications.ts';
import { clearExpiredGuestNames } from './share-links.ts';
import { type Storage, UPLOAD_EXPIRY_MS } from './storage.ts';
import { runTransfer, sweepTransfers } from './transfers/service.ts';
import {
  applyVersionRetention,
  type RestoreVersion,
  type RestoreVersionResult,
  type SaveVersion,
  type SaveVersionResult,
  type VersionWriter,
} from './versions.ts';

/**
 * Background job queues. Producers live in the web process, consumers in `inkadra worker`.
 * Job names and payloads are part of the contract between those two processes.
 */
export const QUEUES = {
  /** Thumbnails, WebP, EXIF, palette, video posters (wave 1). */
  media: 'media',
  /** Outgoing email (wave 2). */
  email: 'email',
  /** Housekeeping: trash purge, upload cleanup, backups (wave 3). */
  maintenance: 'maintenance',
  /**
   * Cards the web role adds to board documents, named versions and restores, applied by
   * `inkadra collab` (split mode).
   */
  collab: 'collab',
  /** Project exports and imports, one at a time (decision 0037). */
  transfers: 'transfers',
} as const;

export type JobPayloads = {
  'maintenance:ping': { at: number };
  'maintenance:delete-files': { keys: string[] };
  'maintenance:purge-uploads': Record<string, never>;
  'maintenance:anonymise-guests': Record<string, never>;
  'media:process': { assetId: string };
  'collab:read-element': { boardId: string; elementId: string; expiresAt: number };
  'collab:read-columns': { boardId: string; expiresAt: number };
  'collab:add-card': AddCard & { expiresAt: number };
  'collab:save-version': SaveVersion & { expiresAt: number };
  'collab:restore-version': RestoreVersion & { expiresAt: number };
  'maintenance:version-retention': Record<string, never>;
  /** A stateless message for the open clients of a board (comments, reviews). */
  'collab:notice': { boardId: string; notice: BoardNotice; sentAt: number };
  'maintenance:purge-notifications': Record<string, never>;
  /** Warns about and removes ended memberships and grants (decision 0041), every minute. */
  'maintenance:access-expiry': Record<string, never>;
  /** A backup started from the settings; the nightly one carries no id. */
  'maintenance:backup': { backupId?: string };
  'maintenance:transfer-sweep': Record<string, never>;
  'transfers:run': { transferId: string };
  /** Grouped `immediate` notification emails, every minute. */
  'email:notifications': Record<string, never>;
  /** `daily` digests, checked every hour. */
  'email:digest': Record<string, never>;
};

const ATTEMPTS = { attempts: 3, backoff: { type: 'exponential', delay: 10_000 } } as const;
const KEEP = { removeOnComplete: { age: 3600, count: 1000 }, removeOnFail: { age: 7 * 86400 } };

export function createRedis(url: string) {
  return new IORedis(url, { maxRetriesPerRequest: null, lazyConnect: true });
}

export function createQueues(url: string, opts: { prefix?: string } = {}) {
  const connection = createRedis(url);
  const media = new Queue(QUEUES.media, { connection, prefix: opts.prefix });
  const maintenance = new Queue(QUEUES.maintenance, { connection, prefix: opts.prefix });
  const transfers = new Queue(QUEUES.transfers, { connection, prefix: opts.prefix });
  const jobs: Jobs = {
    async processAsset(assetId) {
      // The job id makes a second enqueue of the same asset a no-op while the first is waiting.
      await media.add(
        'process',
        { assetId },
        { jobId: `process-${assetId}`, ...ATTEMPTS, ...KEEP },
      );
    },
    async deleteFiles(keys) {
      for (let i = 0; i < keys.length; i += 500)
        await maintenance.add(
          'delete-files',
          { keys: keys.slice(i, i + 500) },
          { ...ATTEMPTS, ...KEEP },
        );
    },
    async runTransfer(transferId) {
      // Not retried: a failure is written to the row and the person starts again.
      await transfers.add('run', { transferId }, { jobId: `transfer-${transferId}`, ...KEEP });
    },
    async runBackup(backupId) {
      await maintenance.add('backup', { backupId }, { jobId: `backup-${backupId}`, ...KEEP });
    },
    async scheduleBackups(settings) {
      await scheduleBackups(maintenance, settings);
    },
  };
  return {
    connection,
    jobs,
    async close() {
      await Promise.all([media.close(), maintenance.close(), transfers.close()]);
      connection.disconnect();
    },
  };
}

/**
 * Removes uploads that never finished and re-queues finished ones that were never processed
 * (for example when Redis was down at the time).
 *
 * This is not a cleanup of unused files: a finished upload is kept whether or not a card
 * shows it. Anything that ever removes files no card uses must also look inside board
 * versions (`board_version`), because restoring a version brings its cards and their files
 * back (decision 0013).
 */
export async function purgeUploads(db: Database, storage: Storage, jobs: Jobs) {
  const stale = await db
    .select({ id: asset.id, key: asset.storageKey, size: asset.size })
    .from(asset)
    .where(
      and(
        eq(asset.status, 'pending'),
        lt(asset.createdAt, new Date(Date.now() - UPLOAD_EXPIRY_MS)),
      ),
    );
  let removed = 0;
  for (const row of stale) {
    if ((await storage.size(row.key)) === row.size) {
      await jobs.processAsset(row.id);
      continue;
    }
    await storage.remove([row.key]);
    await db.delete(asset).where(eq(asset.id, row.id));
    removed += 1;
  }
  return { removed, requeued: stale.length - removed };
}

/** The nightly backup at the time of the settings, in the server's time zone. */
async function scheduleBackups(queue: Queue, settings: BackupSettings) {
  if (!settings.enabled) {
    await queue.removeJobScheduler('backup-nightly');
    return;
  }
  await queue.upsertJobScheduler(
    'backup-nightly',
    { pattern: backupCron(settings), tz: serverTimeZone() },
    { name: 'backup', data: {}, opts: KEEP },
  );
}

/** What exports, imports and backups need besides the media dependencies. */
export interface TransferWorkerDeps {
  dataDir: string;
  uploadMaxSize: number;
  importMaxSize: number;
  migrationsFolder: string;
  /** Files live in S3: copy backups to the bucket too. */
  bucket: boolean;
  /** Backups dump the database over a connection of their own. */
  databaseUrl: string;
}

/** Runs a backup job: the nightly one starts its own row, skipped while another runs. */
export async function backupJob(deps: BackupDeps, backupId?: string) {
  const row = backupId ? { id: backupId } : await startBackup(deps.db, 'scheduled', null);
  if (!row) return { skipped: 'running' as const };
  const done = await runBackup(deps, row.id);
  return { status: done?.status ?? 'gone' };
}

export async function startWorkers(
  url: string,
  log: Logger,
  deps: MediaDeps & {
    db: Database;
    storage: Storage;
    /** Exports, imports and backups; off without it. */
    transfers?: TransferWorkerDeps;
    /** Notification emails; off without it. */
    mailer?: Mailer;
    publicUrl?: string;
    instanceName?: string;
  },
  opts: { prefix?: string } = {},
) {
  const connection = createRedis(url);
  const queues = createQueues(url, opts);
  const backupDeps: BackupDeps | undefined = deps.transfers && {
    db: deps.db,
    storage: deps.storage,
    dataDir: deps.transfers.dataDir,
    migrationsFolder: deps.transfers.migrationsFolder,
    bucket: deps.transfers.bucket,
    databaseUrl: deps.transfers.databaseUrl,
    log,
  };

  const maintenance = new Worker(
    QUEUES.maintenance,
    async (job) => {
      if (job.name === 'ping') return { pong: Date.now() };
      if (job.name === 'delete-files') {
        const { keys } = job.data as JobPayloads['maintenance:delete-files'];
        await deps.storage.remove(keys);
        return { removed: keys.length };
      }
      if (job.name === 'purge-uploads') return purgeUploads(deps.db, deps.storage, queues.jobs);
      if (job.name === 'version-retention') return applyVersionRetention(deps.db);
      if (job.name === 'purge-notifications') return purgeNotifications(deps.db);
      if (job.name === 'access-expiry') return sweepAccessExpiry(deps.db);
      if (job.name === 'anonymise-guests') return clearExpiredGuestNames(deps.db);
      if (job.name === 'backup' && backupDeps)
        return backupJob(backupDeps, (job.data as JobPayloads['maintenance:backup']).backupId);
      if (job.name === 'transfer-sweep' && deps.transfers) {
        await reapStaleBackups(deps.db);
        await sweepPartialBackups(deps.transfers.dataDir);
        return sweepTransfers({
          db: deps.db,
          dataDir: deps.transfers.dataDir,
          jobs: queues.jobs,
        });
      }
      throw new Error(`Unknown job ${job.name}`);
    },
    { connection, concurrency: 2, prefix: opts.prefix },
  );

  // Image work is CPU and memory heavy: two at a time keeps a small server responsive.
  const media = new Worker(
    QUEUES.media,
    async (job) => {
      if (job.name !== 'process') throw new Error(`Unknown job ${job.name}`);
      const { assetId } = job.data as JobPayloads['media:process'];
      return processAsset({ ...deps, log }, assetId);
    },
    { connection, concurrency: 2, prefix: opts.prefix },
  );
  media.on('failed', (job) => {
    if (job && job.attemptsMade >= (job.opts.attempts ?? 1))
      void markFailed(deps.db, (job.data as JobPayloads['media:process']).assetId).catch((e) =>
        log.error({ err: e }, 'could not mark asset failed'),
      );
  });

  // Notification emails check access again when they are sent. One at a time, so a slow SMTP
  // server cannot have two runs pick the same person.
  const mailDeps = {
    db: deps.db,
    mailer: deps.mailer ?? noMailer,
    log,
    publicUrl: deps.publicUrl ?? '',
    instanceName: deps.instanceName ?? 'Inkadra',
  };
  const email = new Worker(
    QUEUES.email,
    async (job) => {
      if (job.name === 'notifications') return sendImmediateEmails(mailDeps);
      if (job.name === 'digest') return sendDigests(mailDeps);
      throw new Error(`Unknown job ${job.name}`);
    },
    { connection, concurrency: 1, prefix: opts.prefix },
  );

  const scheduler = new Queue(QUEUES.maintenance, { connection, prefix: opts.prefix });
  await scheduler.upsertJobScheduler(
    'purge-uploads',
    { every: 60 * 60 * 1000 },
    { name: 'purge-uploads', data: {}, opts: KEEP },
  );
  await scheduler.upsertJobScheduler(
    'version-retention',
    { every: 60 * 60 * 1000 },
    { name: 'version-retention', data: {}, opts: KEEP },
  );
  await scheduler.upsertJobScheduler(
    'purge-notifications',
    { every: 24 * 60 * 60 * 1000 },
    { name: 'purge-notifications', data: {}, opts: KEEP },
  );
  await scheduler.upsertJobScheduler(
    'access-expiry',
    { every: 60 * 1000 },
    {
      name: 'access-expiry',
      data: {},
      opts: { ...KEEP, removeOnComplete: { age: 600, count: 100 } },
    },
  );
  const mailScheduler = new Queue(QUEUES.email, { connection, prefix: opts.prefix });
  const QUIET = { removeOnComplete: { age: 600, count: 100 }, removeOnFail: { age: 86400 } };
  await mailScheduler.upsertJobScheduler(
    'notifications',
    { every: 60 * 1000 },
    { name: 'notifications', data: {}, opts: QUIET },
  );
  await mailScheduler.upsertJobScheduler(
    'digest',
    { every: 60 * 60 * 1000 },
    { name: 'digest', data: {}, opts: QUIET },
  );

  await scheduler.upsertJobScheduler(
    'anonymise-guests',
    { every: 60 * 60 * 1000 },
    { name: 'anonymise-guests', data: {}, opts: KEEP },
  );

  // Exports and imports read and write whole projects: one at a time.
  const transfers = new Worker(
    QUEUES.transfers,
    async (job) => {
      if (job.name !== 'run' || !deps.transfers) throw new Error(`Unknown job ${job.name}`);
      const { transferId } = job.data as JobPayloads['transfers:run'];
      await runTransfer(
        { ...deps.transfers, db: deps.db, storage: deps.storage, jobs: queues.jobs, log },
        transferId,
      );
    },
    // Big archives take long: keep the lock alive well past the default 30 seconds.
    { connection, concurrency: 1, prefix: opts.prefix, lockDuration: 5 * 60 * 1000 },
  );
  if (deps.transfers) {
    await scheduler.upsertJobScheduler(
      'transfer-sweep',
      { every: 60 * 60 * 1000 },
      { name: 'transfer-sweep', data: {}, opts: KEEP },
    );
    // Backups run only in workers: one left running by a worker that died is over.
    const reaped = await reapStaleBackups(deps.db, STARTUP_STALE_MS);
    if (reaped) log.warn({ reaped }, 'backups left running by a stopped worker marked interrupted');
    await scheduleBackups(scheduler, await readBackupSettings(deps.db));
  }

  for (const w of [maintenance, media, email, transfers]) {
    w.on('failed', (job, err) => log.error({ queue: w.name, job: job?.id, err }, 'job failed'));
  }
  return {
    async close() {
      await Promise.all([
        maintenance.close(),
        media.close(),
        email.close(),
        transfers.close(),
        scheduler.close(),
        mailScheduler.close(),
        queues.close(),
      ]);
      connection.disconnect();
    },
  };
}

/** How long the web role waits for the collaboration server to apply a card. */
const ADD_CARD_TIMEOUT_MS = 10_000;
/**
 * Extra wait for a job that was already running at the deadline: it checked the deadline
 * before writing, so its answer comes within an in-memory edit.
 */
const ADD_CARD_GRACE_MS = 5_000;
/** Queued cards carry what the person wrote: keep failed ones only long enough to debug. */
const ADD_CARD_KEEP = { removeOnComplete: { age: 3600 }, removeOnFail: { age: 3600 } };

/** The card may or may not be on the board: the collaboration server never answered. */
export class CardOutcomeUnknown extends Error {}

const WAITING = new Set(['waiting', 'wait', 'delayed', 'prioritized']);
const timedOut = (err: unknown) => err instanceof Error && /timed out/.test(err.message);
/** A job that stalled may have written its card before its worker stopped answering. */
const unknownIfStalled = (err: unknown) =>
  err instanceof Error && /stalled/i.test(err.message)
    ? new CardOutcomeUnknown('The collaboration server stopped while making the change.')
    : err;

/**
 * How long a request waits to queue background work. A queue that went away after connecting
 * never fails an add: it waits for the connection to come back.
 */
export const ENQUEUE_TIMEOUT_MS = 2_000;

/** `promise`, or a rejection with `message` after `ms`. The work itself is not stopped. */
export function within<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), Math.max(1, ms));
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Board edits from a web role that has no collaboration server of its own: they go through
 * the `collab` queue to the one that has the document open (decision 0014). Cards, named
 * versions and restores (decision 0013) share the same rules.
 *
 * An edit must never land after the client was told it failed. The job carries a deadline
 * that the worker checks right before writing, and is neither retried nor re-run when stalled.
 * A job not started by the deadline is removed (and would be refused anyway); one already
 * running gets a short grace to answer, and if it still does not, the outcome is reported as
 * unknown rather than as a failure.
 */
export function queuedBoardWriter(
  url: string,
  opts: { prefix?: string; timeoutMs?: number; graceMs?: number } = {},
) {
  const timeoutMs = opts.timeoutMs ?? ADD_CARD_TIMEOUT_MS;
  const graceMs = opts.graceMs ?? ADD_CARD_GRACE_MS;
  const connection = createRedis(url);
  const queue = new Queue(QUEUES.collab, { connection, prefix: opts.prefix });
  // QueueEvents blocks on its connection: it needs one of its own.
  const events = new QueueEvents(QUEUES.collab, {
    connection: createRedis(url),
    prefix: opts.prefix,
  });

  async function run<T>(
    name: CollabJob,
    input: object,
  ): Promise<T | { ok: false; reason: 'expired' }> {
    const expiresAt = Date.now() + timeoutMs;
    const left = () => expiresAt - Date.now();
    // Readiness alone cannot write. Once add is attempted, a missing acknowledgement may
    // hide a job already applied by collab: the deadline only prevents future writes.
    let submitted = false;
    const adding = events.waitUntilReady().then(() => {
      if (left() <= 0) throw new BoardEditNotStarted('The collaboration queue is unreachable.');
      submitted = true;
      return queue.add(name, { ...input, expiresAt }, { attempts: 1, ...ADD_CARD_KEEP });
    });
    const job = await within(adding, left(), 'The collaboration queue is unreachable.').catch(
      (err) => {
        adding.then((late) => late.remove()).catch(() => {});
        if (submitted)
          throw new CardOutcomeUnknown('The collaboration queue is unreachable.', { cause: err });
        throw new BoardEditNotStarted('The collaboration queue is unreachable.', { cause: err });
      },
    );
    try {
      return (await job.waitUntilFinished(events, Math.max(1, left()))) as T;
    } catch (err) {
      if (!timedOut(err)) throw unknownIfStalled(err);
    }
    const state = await within(job.getState(), graceMs, 'state').catch(() => 'unknown');
    if (WAITING.has(state)) {
      // Past the deadline the worker refuses it anyway; removing it keeps it from running.
      // Removal fails if a worker took it meanwhile: then it answers below.
      const removed = await within(job.remove(), graceMs, 'remove').then(
        () => true,
        () => false,
      );
      if (removed) return { ok: false, reason: 'expired' };
    }
    try {
      return (await job.waitUntilFinished(events, graceMs)) as T;
    } catch (err) {
      if (timedOut(err))
        throw new CardOutcomeUnknown('The collaboration server did not answer in time.');
      throw unknownIfStalled(err);
    }
  }

  const writer: BoardWriter = {
    addCard: (input) => run<AddCardResult>('add-card', input),
  };
  const versions: VersionWriter = {
    save: (input) => run<SaveVersionResult>('save-version', input),
    restore: (input) => run<RestoreVersionResult>('restore-version', input),
  };
  return {
    writer,
    versions,
    reader: {
      async element(boardId: string, elementId: string) {
        const result = await run<{ element: StoredElement | null }>('read-element', {
          boardId,
          elementId,
        });
        if ('ok' in result) throw new Error('The collaboration read expired.');
        return result.element;
      },
      async columns(boardId: string) {
        const result = await run<{ columns: BoardColumn[] }>('read-columns', { boardId });
        if ('ok' in result) throw new Error('The collaboration read expired.');
        return result.columns;
      },
    } satisfies BoardReader,
    async close() {
      await Promise.all([queue.close(), events.close()]);
      connection.disconnect();
    },
  };
}

type CollabJob = 'read-element' | 'read-columns' | 'add-card' | 'save-version' | 'restore-version';

/**
 * Run by `inkadra collab`: applies the edits queued by web roles to the live documents, and
 * passes their notices on to open boards. Without `versions`, version jobs fail.
 */
export function startBoardWorker(
  url: string,
  writer: BoardWriter,
  log: Logger,
  opts: {
    prefix?: string;
    versions?: VersionWriter;
    notices?: BoardNotifier;
    reader?: BoardReader;
  } = {},
) {
  const connection = createRedis(url);
  const worker = new Worker(
    QUEUES.collab,
    async (job) => {
      if (job.name === 'notice') {
        const { boardId, notice, sentAt } = job.data as JobPayloads['collab:notice'];
        if (Date.now() - sentAt > NOTICE_TTL_MS) return { sent: false };
        opts.notices?.notify(boardId, notice);
        return { sent: true };
      }
      const name = job.name as CollabJob;
      const input = job.data as { expiresAt: number };
      // Checked again inside the write; this one spares opening the document.
      if (Date.now() > input.expiresAt) return { ok: false, reason: 'expired' };
      if (name === 'read-element' && opts.reader) {
        const { boardId, elementId } = job.data as JobPayloads['collab:read-element'];
        return { element: await opts.reader.element(boardId, elementId) };
      }
      if (name === 'read-columns' && opts.reader) {
        const { boardId } = job.data as JobPayloads['collab:read-columns'];
        return { columns: await opts.reader.columns(boardId) };
      }
      if (name === 'add-card') return writer.addCard(job.data as JobPayloads['collab:add-card']);
      if (name === 'save-version' && opts.versions)
        return opts.versions.save(job.data as JobPayloads['collab:save-version']);
      if (name === 'restore-version' && opts.versions)
        return opts.versions.restore(job.data as JobPayloads['collab:restore-version']);
      throw new Error(`Unknown job ${job.name}`);
    },
    // A stalled job (crash, long block) is failed, not re-run: a re-run could add a second card.
    { connection, concurrency: 4, prefix: opts.prefix, maxStalledCount: 0 },
  );
  worker.on('failed', (job, err) =>
    log.error({ queue: worker.name, job: job?.id, err }, 'job failed'),
  );
  return {
    async close() {
      await worker.close();
      connection.disconnect();
    },
  };
}

/**
 * Runs jobs in the calling process, for installs and tests without Redis. Failures are
 * logged; nothing is retried.
 */
export function inlineJobs(
  deps: MediaDeps,
  log: Logger,
  transfers?: TransferWorkerDeps,
): Jobs & { idle(): Promise<void> } {
  const running = new Set<Promise<unknown>>();
  const track = (work: Promise<unknown>) => {
    const p = work
      .catch((err) => log.error({ err }, 'background job failed'))
      .finally(() => running.delete(p));
    running.add(p);
  };
  const self: Jobs & { idle(): Promise<void> } = {
    async processAsset(assetId) {
      track(
        processAsset({ ...deps, log }, assetId).catch(async (err) => {
          await markFailed(deps.db, assetId);
          throw err;
        }),
      );
    },
    async deleteFiles(keys) {
      track(deps.storage.remove(keys));
    },
    ...(transfers
      ? {
          async runTransfer(transferId: string) {
            track(runTransfer({ ...transfers, ...deps, jobs: self, log }, transferId));
          },
          async runBackup(backupId: string) {
            track(
              runBackup(
                {
                  db: deps.db,
                  storage: deps.storage,
                  dataDir: transfers.dataDir,
                  migrationsFolder: transfers.migrationsFolder,
                  databaseUrl: transfers.databaseUrl,
                  bucket: transfers.bucket,
                  log,
                },
                backupId,
              ),
            );
          },
          // Without a worker there is no schedule: backups run when asked for.
          async scheduleBackups() {},
        }
      : {}),
    async idle() {
      while (running.size > 0) await Promise.all(running);
    },
  };
  return self;
}

/**
 * From a web role without a collaboration server of its own (split mode): a `notice` job on the
 * `collab` queue, which `inkadra collab` turns into the message (decision 0014). Not retried
 * and dropped once stale: the next change or a reload brings clients up to date anyway.
 */
export function queuedBoardNotifier(url: string, log: Logger, opts: { prefix?: string } = {}) {
  const connection = new IORedis(url, {
    maxRetriesPerRequest: 1,
    lazyConnect: true,
    enableOfflineQueue: false,
  });
  const queue = new Queue(QUEUES.collab, { connection, prefix: opts.prefix });
  const notifier: BoardNotifier = {
    notify(boardId, notice) {
      if (connection.status !== 'ready') {
        log.warn({ boardId }, 'board notice dropped: Redis is not ready');
        return;
      }
      const adding = queue.add(
        'notice',
        { boardId, notice, sentAt: Date.now() },
        { attempts: 1, removeOnComplete: true, removeOnFail: { age: 3600 } },
      );
      within(adding, ENQUEUE_TIMEOUT_MS, 'The collaboration queue is unreachable.').catch((err) =>
        log.warn({ err, boardId }, 'board notice not queued'),
      );
    },
  };
  return {
    notifier,
    async close() {
      await queue.close();
      connection.disconnect();
    },
  };
}
