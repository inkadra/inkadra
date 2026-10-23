import { Queue, Worker } from 'bullmq';
import { and, eq, lt } from 'drizzle-orm';
import IORedis from 'ioredis';
import type { Logger } from 'pino';
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
} as const;

export type JobPayloads = {
  'maintenance:ping': { at: number };
  'maintenance:delete-files': { keys: string[] };
  'maintenance:purge-uploads': Record<string, never>;
  'media:process': { assetId: string };
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
