import { describe, expect, it } from 'vitest';
import { renderMetrics } from './metrics.ts';
import { StoreRecorder } from './sampler.ts';

describe('renderMetrics (#817)', () => {
  it('writes the Prometheus text format, escaping labels and skipping empty metrics', () => {
    const text = renderMetrics([
      {
        name: 'inkadra_queue_jobs',
        help: 'Jobs in the queue, by state.',
        values: [
          { labels: { queue: 'media', state: 'waiting' }, value: 3 },
          { labels: { queue: 'a"b\\c\nd', state: 'active' }, value: 0 },
        ],
      },
      { name: 'inkadra_data_disk_free_bytes', help: 'Free bytes.', values: [] },
      { name: 'inkadra_database_up', help: 'Up.', values: [{ value: 1 }] },
    ]);
    expect(text).toBe(
      [
        '# HELP inkadra_queue_jobs Jobs in the queue, by state.',
        '# TYPE inkadra_queue_jobs gauge',
        'inkadra_queue_jobs{queue="media",state="waiting"} 3',
        'inkadra_queue_jobs{queue="a\\"b\\\\c\\nd",state="active"} 0',
        '# HELP inkadra_database_up Up.',
        '# TYPE inkadra_database_up gauge',
        'inkadra_database_up 1',
        '',
      ].join('\n'),
    );
  });
});

describe('StoreRecorder (#902)', () => {
  it('sums up the board saves since the last take, then starts over', () => {
    const stores = new StoreRecorder();
    expect(stores.take()).toBeUndefined();
    for (let i = 1; i <= 20; i++) stores.record(i === 7 ? 30 : 1, i * 10);
    expect(stores.take()).toEqual({ n: 20, p95: 190, max: 200, waitMax: 30 });
    expect(stores.take()).toBeUndefined();
  });
});
