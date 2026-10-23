import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import type { Logger } from 'pino';

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
};

export function createRedis(url: string) {
  return new IORedis(url, { maxRetriesPerRequest: null, lazyConnect: true });
}

export function createQueues(url: string) {
  const connection = createRedis(url);
  return {
    connection,
    maintenance: new Queue(QUEUES.maintenance, { connection }),
  };
}

export function startWorkers(url: string, log: Logger) {
  const connection = createRedis(url);
  const maintenance = new Worker(
    QUEUES.maintenance,
    async (job) => {
      if (job.name === 'ping') return { pong: Date.now() };
      throw new Error(`Unknown job ${job.name}`);
    },
    { connection, concurrency: 2 },
  );
  for (const w of [maintenance]) {
    w.on('failed', (job, err) => log.error({ queue: w.name, job: job?.id, err }, 'job failed'));
  }
  return {
    async close() {
      await Promise.all([maintenance.close()]);
      connection.disconnect();
    },
  };
}
