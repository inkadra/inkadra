import type { StorageFiles } from '@inkadra/shared';
import { describe, expect, it } from 'vitest';
import { filesSummary, filterCounts, filterFiles, typeBadge } from './largest-files.ts';

type Item = StorageFiles['items'][number];
const file = (id: string, bytes: number, projectId: string, kind?: Item['kind']): Item => ({
  id,
  filename: `${id}.bin`,
  bytes,
  projectId,
  projectName: projectId.toUpperCase(),
  createdAt: '2026-11-01T00:00:00.000Z',
  ...(kind && { kind, projectColor: 'blue' as const }),
});

describe('largest files', () => {
  const items = [
    file('a', 400, 'p', 'videos'),
    file('b', 300, 'q', 'videos'),
    file('c', 200, 'p', 'images'),
    file('d', 50, 'r', 'documents'),
    file('e', 30, 's', 'audio'),
    file('f', 20, 't'),
  ];

  it('sums the first three files and the largest projects, the rest from the total', () => {
    const summary = filesSummary(items, 1500);
    expect(summary.top).toEqual({ count: 3, bytes: 900 });
    expect(summary.projects.map((p) => [p.id, p.bytes])).toEqual([
      ['p', 600],
      ['q', 300],
      ['r', 50],
    ]);
    expect(summary.restBytes).toBe(1500 - 950);
    expect(filesSummary(items.slice(0, 1), 100).top).toEqual({ count: 1, bytes: 400 });
    // A total from before the files (or smaller than them) never goes negative.
    expect(filesSummary(items, 0).restBytes).toBe(0);
  });

  it('filters by type, with files of older servers among the others', () => {
    expect(filterCounts(items)).toEqual({ all: 6, videos: 2, images: 1, other: 3 });
    expect(filterFiles(items, 'videos').map((f) => f.id)).toEqual(['a', 'b']);
    expect(filterFiles(items, 'other').map((f) => f.id)).toEqual(['d', 'e', 'f']);
    expect(filterFiles(items, 'all')).toHaveLength(6);
  });

  it('names a file by its extension when it has no preview', () => {
    expect(typeBadge('loop.gif')).toBe('GIF');
    expect(typeBadge('Script v2.pdf')).toBe('PDF');
    expect(typeBadge('README')).toBeNull();
    expect(typeBadge('.env')).toBeNull();
    expect(typeBadge('archive.longext')).toBeNull();
  });
});
