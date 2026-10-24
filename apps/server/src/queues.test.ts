import pino from 'pino';
import { afterEach, expect, it, vi } from 'vitest';
import type { Database } from './db/client.ts';
import { startWorkers } from './queues.ts';
import { clearExpiredGuestNames } from './share-links.ts';
import type { Storage } from './storage.ts';

const harness = vi.hoisted(() => ({
  processors: new Map<string, (job: { name: string }) => Promise<unknown>>(),
  schedule: vi.fn(),
}));

vi.mock('bullmq', () => ({
  Queue: class {
    upsertJobScheduler = harness.schedule;
    close = vi.fn();
  },
  Worker: class {
    constructor(name: string, process: (job: { name: string }) => Promise<unknown>) {
      harness.processors.set(name, process);
    }
    on = vi.fn();
    close = vi.fn();
  },
}));
vi.mock('ioredis', () => ({
  default: class {
    disconnect = vi.fn();
  },
}));
vi.mock('./share-links.ts', () => ({ clearExpiredGuestNames: vi.fn() }));

afterEach(() => vi.restoreAllMocks());

it('schedules anonymisation separately and isolates it from upload purge failures', async () => {
  const pendingUploads = vi.fn().mockResolvedValue([]);
  const db = { select: () => ({ from: () => ({ where: pendingUploads }) }) } as unknown as Database;
  const workers = await startWorkers('redis://unused', pino({ level: 'silent' }), {
    db,
    storage: {} as Storage,
    tmpDir: '/unused',
    heic: false,
  });
  try {
    expect(harness.schedule).toHaveBeenCalledWith(
      'anonymise-guests',
      { every: 3600_000 },
      expect.objectContaining({ name: 'anonymise-guests' }),
    );
    expect(harness.schedule).toHaveBeenCalledWith(
      'purge-uploads',
      { every: 3600_000 },
      expect.objectContaining({ name: 'purge-uploads' }),
    );
    const run = harness.processors.get('maintenance');
    if (!run) throw new Error('Maintenance worker missing');
    vi.mocked(clearExpiredGuestNames).mockRejectedValueOnce(new Error('Anonymisation failed'));
    await expect(run({ name: 'anonymise-guests' })).rejects.toThrow('Anonymisation failed');
    await expect(run({ name: 'purge-uploads' })).resolves.toEqual({ removed: 0, requeued: 0 });
    pendingUploads.mockRejectedValueOnce(new Error('Purge failed'));
    await expect(run({ name: 'purge-uploads' })).rejects.toThrow('Purge failed');
    vi.mocked(clearExpiredGuestNames).mockResolvedValueOnce(undefined);
    await expect(run({ name: 'anonymise-guests' })).resolves.toBeUndefined();
    expect(clearExpiredGuestNames).toHaveBeenCalledTimes(2);
  } finally {
    await workers.close();
  }
});
