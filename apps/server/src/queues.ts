import { Queue, QueueEvents, Worker } from 'bullmq';
import { and, eq, lt } from 'drizzle-orm';
import IORedis from 'ioredis';
import type { Logger } from 'pino';
import type { AddCard, AddCardResult, BoardWriter } from './board-writer.ts';
import type { Database } from './db/client.ts';
import { asset } from './db/schema.ts';
import type { Jobs } from './jobs.ts';
import { type MediaDeps, markFailed, processAsset } from './media/process.ts';
import { type Storage, UPLOAD_EXPIRY_MS } from './storage.ts';

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
  /** Cards the web role adds to board documents, applied by `inkadra collab` (split mode). */
  collab: 'collab',
} as const;

export type JobPayloads = {
  'maintenance:ping': { at: number };
  'maintenance:delete-files': { keys: string[] };
  'maintenance:purge-uploads': Record<string, never>;
  'media:process': { assetId: string };
  'collab:add-card': AddCard & { expiresAt: number };
};

const ATTEMPTS = { attempts: 3, backoff: { type: 'exponential', delay: 10_000 } } as const;
const KEEP = { removeOnComplete: { age: 3600, count: 1000 }, removeOnFail: { age: 7 * 86400 } };

export function createRedis(url: string) {
  return new IORedis(url, { maxRetriesPerRequest: null, lazyConnect: true });
}

export function createQueues(url: string) {
  const connection = createRedis(url);
  const media = new Queue(QUEUES.media, { connection });
  const maintenance = new Queue(QUEUES.maintenance, { connection });
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
  };
  return {
    connection,
    jobs,
    async close() {
      await Promise.all([media.close(), maintenance.close()]);
      connection.disconnect();
    },
  };
}

/**
 * Removes uploads that never finished and re-queues finished ones that were never processed
 * (for example when Redis was down at the time).
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

export async function startWorkers(
  url: string,
  log: Logger,
  deps: MediaDeps & { db: Database; storage: Storage },
) {
  const connection = createRedis(url);
  const queues = createQueues(url);

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
      throw new Error(`Unknown job ${job.name}`);
    },
    { connection, concurrency: 2 },
  );

  // Image work is CPU and memory heavy: two at a time keeps a small server responsive.
  const media = new Worker(
    QUEUES.media,
    async (job) => {
      if (job.name !== 'process') throw new Error(`Unknown job ${job.name}`);
      const { assetId } = job.data as JobPayloads['media:process'];
      return processAsset(deps, assetId);
    },
    { connection, concurrency: 2 },
  );
  media.on('failed', (job) => {
    if (job && job.attemptsMade >= (job.opts.attempts ?? 1))
      void markFailed(deps.db, (job.data as JobPayloads['media:process']).assetId).catch((e) =>
        log.error({ err: e }, 'could not mark asset failed'),
      );
  });

  const scheduler = new Queue(QUEUES.maintenance, { connection });
  await scheduler.upsertJobScheduler(
    'purge-uploads',
    { every: 60 * 60 * 1000 },
    { name: 'purge-uploads', data: {}, opts: KEEP },
  );

  for (const w of [maintenance, media]) {
    w.on('failed', (job, err) => log.error({ queue: w.name, job: job?.id, err }, 'job failed'));
  }
  return {
    async close() {
      await Promise.all([maintenance.close(), media.close(), scheduler.close(), queues.close()]);
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
    ? new CardOutcomeUnknown('The collaboration server stopped while adding the card.')
    : err;

function within<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), Math.max(1, ms));
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Board edits from a web role that has no collaboration server of its own: they go through
 * the `collab` queue to the one that has the document open (decision 0014).
 *
 * A card must never appear after the client was told it failed. The job carries a deadline
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
  const writer: BoardWriter = {
    async addCard(input) {
      const expiresAt = Date.now() + timeoutMs;
      const left = () => expiresAt - Date.now();
      // With Valkey down these would wait forever. A job added after the deadline is refused
      // by the worker, so giving up here cannot lead to a late card.
      const job = await within(
        events
          .waitUntilReady()
          .then(() =>
            queue.add('add-card', { ...input, expiresAt }, { attempts: 1, ...ADD_CARD_KEEP }),
          ),
        left(),
        'The collaboration queue is unreachable.',
      );
      try {
        return (await job.waitUntilFinished(events, Math.max(1, left()))) as AddCardResult;
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
        return (await job.waitUntilFinished(events, graceMs)) as AddCardResult;
      } catch (err) {
        if (timedOut(err))
          throw new CardOutcomeUnknown('The collaboration server did not answer in time.');
        throw unknownIfStalled(err);
      }
    },
  };
  return {
    writer,
    async close() {
      await Promise.all([queue.close(), events.close()]);
      connection.disconnect();
    },
  };
}

/** Run by `inkadra collab`: applies the cards queued by web roles to the live documents. */
export function startBoardWorker(
  url: string,
  writer: BoardWriter,
  log: Logger,
  opts: { prefix?: string } = {},
) {
  const connection = createRedis(url);
  const worker = new Worker(
    QUEUES.collab,
    async (job) => {
      if (job.name !== 'add-card') throw new Error(`Unknown job ${job.name}`);
      const input = job.data as JobPayloads['collab:add-card'];
      // Checked again inside the write; this one spares opening the document.
      if (Date.now() > input.expiresAt) return { ok: false, reason: 'expired' };
      return writer.addCard(input);
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
export function inlineJobs(deps: MediaDeps, log: Logger): Jobs & { idle(): Promise<void> } {
  const running = new Set<Promise<unknown>>();
  const track = (work: Promise<unknown>) => {
    const p = work
      .catch((err) => log.error({ err }, 'background job failed'))
      .finally(() => running.delete(p));
    running.add(p);
  };
  return {
    async processAsset(assetId) {
      track(
        processAsset(deps, assetId).catch(async (err) => {
          await markFailed(deps.db, assetId);
          throw err;
        }),
      );
    },
    async deleteFiles(keys) {
      track(deps.storage.remove(keys));
    },
    async idle() {
      while (running.size > 0) await Promise.all(running);
    },
  };
}
