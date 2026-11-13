import { expect, it } from 'vitest';
import type { DiagnosticCheck, ServerProblem, ServerStatus } from '@inkadra/shared';
import {
  cpuScale,
  diskCompresses,
  duration,
  healthOf,
  memoryScale,
  niceMax,
  sortedProblems,
  speedVerdict,
  storageVerdict,
} from './format.ts';

const storage = {
  driver: 'local' as const,
  location: '/data',
  total: 1000e9,
  free: 500e9,
  used: 500e9,
  originals: 300e9,
  copies: 50e9,
  previews: 10e9,
  growthPerMonth: 50e9,
  monthsLeft: 10,
};

it('reads speed and space in plain words', () => {
  expect([speedVerdict(null), speedVerdict(120), speedVerdict(800), speedVerdict(3000)]).toEqual([
    'idle',
    'fast',
    'slow',
    'verySlow',
  ]);
  expect(storageVerdict(storage)).toEqual({ key: 'months', months: 10 });
  expect(storageVerdict({ ...storage, monthsLeft: 40 })).toEqual({ key: 'years' });
  expect(storageVerdict({ ...storage, free: 40e9 })).toEqual({ key: 'almostFull' });
  // S3: no total, so nothing about what is left.
  expect(
    storageVerdict({ ...storage, driver: 's3', total: null, free: null, monthsLeft: null }),
  ).toEqual({ key: 'unknown' });
});

it('tells when the local disk compresses the files', () => {
  expect(diskCompresses(storage)).toBe(false);
  expect(diskCompresses({ ...storage, used: 300e9 })).toBe(true);
  // S3 reports what the files take, never less.
  expect(diskCompresses({ ...storage, driver: 's3', total: null, free: null, used: 300e9 })).toBe(
    false,
  );
});

it('says how long in the largest unit that fits', () => {
  expect(duration(6 * 86_400_000 + 3_600_000, 'en')).toBe('6 days');
  expect(duration(5 * 3_600_000, 'en')).toBe('5 hours');
  expect(duration(12 * 60_000, 'en')).toBe('12 minutes');
  expect(duration(40_000, 'en')).toBe('40 seconds');
  expect([niceMax(0), niceMax(3.2), niceMax(180), niceMax(4e9)]).toEqual([1, 5, 200, 5e9]);
});

it('scales the CPU to its peak, never under 10 %', () => {
  expect(cpuScale([0.4, 1, null, 3])).toBe(10);
  expect(cpuScale([])).toBe(10);
  expect(cpuScale([12, 31])).toBe(50);
  expect(cpuScale([96])).toBe(100);
});

it('scales the memory to its peak, and to the limit past half of it', () => {
  // 490 MB of a 33 GB limit: the peak, rounded up, and no limit line.
  expect(memoryScale([3e8, 4.9e8], 33.39e9)).toEqual({ max: 5e8, limit: false });
  // 1.68 GB of 2 GB: the limit, drawn.
  expect(memoryScale([1.5e9, 1.68e9], 2e9)).toEqual({ max: 2e9, limit: true });
  // Just under half: still the peak, which stays under the limit.
  expect(memoryScale([0.59e9], 1.2e9)).toEqual({ max: 1e9, limit: false });
  // No limit known: the peak.
  expect(memoryScale([2.2e9], null)).toEqual({ max: 2.5e9, limit: false });
  expect(memoryScale([], null)).toEqual({ max: 1, limit: false });
});

const services = (down?: string): ServerStatus['services'] =>
  (['web', 'collab', 'worker', 'database', 'queue', 'configuration'] as const).map((id) => ({
    id,
    status: id === down ? 'down' : 'ok',
    since: null,
    detail: null,
  }));
const health = (patch: Partial<ServerStatus>, checks: DiagnosticCheck[] = []) =>
  healthOf(
    {
      services: services(),
      storage,
      backup: { enabled: true, lastAt: null, lastStatus: 'ready', size: null, nextAt: null },
      ...patch,
    } as ServerStatus,
    checks,
  );

it('turns orange when it works but something needs fixing, red when a service stopped', () => {
  expect(health({})).toEqual({ level: 'ok' });
  const failed = { enabled: true, lastAt: null, lastStatus: 'failed' as const, size: null, nextAt: null };
  expect(health({ backup: failed })).toEqual({ level: 'warn', reason: 'backup' });
  const check: DiagnosticCheck = { id: 'storage', status: 'warning', expected: null, actual: null };
  expect(health({}, [check])).toEqual({ level: 'warn', reason: 'check', check });
  // The space almost full comes first: uploads stop.
  expect(health({ backup: failed, storage: { ...storage, free: 40e9 } }, [check])).toEqual({
    level: 'warn',
    reason: 'space',
  });
  // A stopped service is red, whatever else; a configuration that warns is not a service.
  expect(health({ backup: failed, services: services('worker') })).toMatchObject({
    level: 'bad',
    service: { id: 'worker' },
  });
  expect(health({ services: services('configuration') })).toEqual({ level: 'ok' });
});

it('puts the problem the orange card names on top, the others newest first', () => {
  const problem = (id: string, kind: ServerProblem['kind'], seen = false) =>
    ({ id, kind, seen }) as ServerProblem;
  const list = [
    problem('a', 'video_failed'),
    problem('b', 'email_failed'),
    problem('c', 'backup_failed'),
    problem('d', 'backup_failed', true),
  ];
  expect(sortedProblems(list, { level: 'warn', reason: 'backup' }).map((p) => p.id)).toEqual([
    'c',
    'a',
    'b',
  ]);
  expect(sortedProblems(list, { level: 'ok' }).map((p) => p.id)).toEqual(['a', 'b', 'c']);
});
