import pino from 'pino';
import { afterEach, expect, it, vi } from 'vitest';
import type { Database } from './db/client.ts';
import { officeConverterInstalled } from './media/office.ts';
import { processAsset } from './media/process.ts';
import { startWorkers } from './queues.ts';
import { clearExpiredGuestNames } from './share-links.ts';
import type { Storage } from './storage.ts';

const harness = vi.hoisted(() => ({
  processors: new Map<string, (job: { name: string }) => Promise<unknown>>(),
  schedule: vi.fn(),
  add: vi.fn(),
}));

vi.mock('bullmq', () => ({
  Queue: class {
    constructor(readonly name: string) {}
    upsertJobScheduler = harness.schedule;
    add = (...args: unknown[]) => harness.add(this.name, ...args);
    getJob = vi.fn();
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
vi.mock('./media/office.ts', async (original) => ({
  ...(await original<typeof import('./media/office.ts')>()),
  officeConverterInstalled: vi.fn(),
}));
vi.mock('./media/process.ts', async (original) => ({
  ...(await original<typeof import('./media/process.ts')>()),
  processAsset: vi.fn(),
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it('schedules anonymisation separately and isolates it from upload purge failures', async () => {
  const pendingUploads = vi.fn().mockResolvedValue([]);
  const db = {
    // The stuck copies of videos are read with `.limit()` too (decision 0128): none here.
    select: () => ({
      from: () => ({
        where: (...args: unknown[]) =>
          Object.assign(pendingUploads(...args), { limit: async () => [] }),
      }),
    }),
    delete: () => ({ where: vi.fn().mockResolvedValue(undefined) }),
  } as unknown as Database;
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
    await expect(run({ name: 'purge-uploads' })).resolves.toEqual({
      removed: 0,
      requeued: 0,
      proxies: 0,
    });
    pendingUploads.mockRejectedValueOnce(new Error('Purge failed'));
    await expect(run({ name: 'purge-uploads' })).rejects.toThrow('Purge failed');
    vi.mocked(clearExpiredGuestNames).mockResolvedValueOnce(undefined);
    await expect(run({ name: 'anonymise-guests' })).resolves.toBeUndefined();
    expect(clearExpiredGuestNames).toHaveBeenCalledTimes(2);
  } finally {
    await workers.close();
  }
});

it('registers the recurring jobs again, for a Valkey that lost them (#798)', async () => {
  vi.useFakeTimers();
  const deps = { db: {} as Database, storage: {} as Storage, tmpDir: '/unused', heic: false };
  const workers = await startWorkers('redis://unused', pino({ level: 'silent' }), deps);
  try {
    const digests = () => harness.schedule.mock.calls.filter(([id]) => id === 'digest').length;
    const before = digests();
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(digests()).toBe(before + 1);
  } finally {
    await workers.close();
    vi.useRealTimers();
  }
});

it('routes Office documents to the office queue, read only by workers with LibreOffice', async () => {
  const deps = { db: {} as Database, storage: {} as Storage, tmpDir: '/unused', heic: false };
  const log = pino({ level: 'silent' });
  const depsOf = (call: number) => vi.mocked(processAsset).mock.calls[call]?.[0];
  const start = async (env: string | undefined, installed: boolean) => {
    harness.processors.clear();
    vi.mocked(processAsset).mockClear();
    vi.stubEnv('OFFICE_PREVIEWS', env);
    vi.mocked(officeConverterInstalled).mockResolvedValue(installed);
    const workers = await startWorkers('redis://unused', log, deps);
    await harness.processors.get('media')?.({ name: 'process', data: { assetId: 'a1' } } as never);
    return workers;
  };

  // Off everywhere: the media worker reads the document itself (grids, icon) and nothing
  // ever waits on the office queue.
  let workers = await start(undefined, true);
  expect(depsOf(0)?.enqueueOffice).toBeUndefined();
  expect(harness.processors.has('office')).toBe(false);
  await workers.close();

  // `all` with OFFICE_PREVIEWS=true but no LibreOffice: it queues, and never converts.
  workers = await start('true', false);
  expect(harness.processors.has('office')).toBe(false);
  await depsOf(0)?.enqueueOffice?.('a1');
  expect(harness.add).toHaveBeenCalledWith(
    'office',
    'convert',
    { assetId: 'a1' },
    expect.objectContaining({ jobId: 'office-a1' }),
  );
  await workers.close();

  // The -office worker reads the queue and converts there, without queueing again.
  workers = await start('true', true);
  const convert = harness.processors.get('office');
  if (!convert) throw new Error('Office worker missing');
  await convert({ name: 'convert', data: { assetId: 'a1' } } as never);
  expect(vi.mocked(processAsset)).toHaveBeenLastCalledWith(
    expect.not.objectContaining({ enqueueOffice: expect.anything() }),
    'a1',
  );
  await workers.close();
});
