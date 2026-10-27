import type { Project } from '@inkadra/shared';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../lib/api.ts';
import {
  archivedProjects,
  filterProjects,
  type ProjectOverview,
  projectOverview,
} from './projects-overview.ts';

afterEach(() => vi.restoreAllMocks());
const row = (id: string, overrides: Partial<Project> = {}): ProjectOverview => ({
  project: {
    id,
    name: id,
    type: 'short_film',
    archivedAt: null,
    pinned: false,
    createdAt: '2026-10-01',
    updatedAt: '2026-10-02',
    ...overrides,
  } as Project,
  boards: [],
  members: [],
  activity: '2026-10-02',
});
const query = { search: '', status: 'all', type: 'all', person: 'all', sort: 'activity' };
it('filters by search, status, type and real project membership', () => {
  const a = row('Film', { name: 'Last Run' });
  a.members = [
    { user: { id: 'giulia', name: 'Giulia', image: null }, role: 'editor', addedAt: '' },
  ];
  const b = row('Spot', { archivedAt: '2026-10-03', type: 'commercial' });
  expect(
    filterProjects([a, b], {
      ...query,
      search: ' LAST ',
      person: 'giulia',
      status: 'active',
      type: 'short_film',
    }),
  ).toEqual([a]);
  expect(filterProjects([a, b], { ...query, status: 'archived' })).toEqual([b]);
  expect(filterProjects([a, b], { ...query, person: 'stranger' })).toEqual([]);
});
it('puts personal pins first, then sorts without mutating input', () => {
  const a = row('A');
  const b = row('B', { pinned: true });
  const c = row('C');
  c.activity = '2026-10-24';
  const input = [a, b, c];
  expect(filterProjects(input, query).map((r) => r.project.id)).toEqual(['B', 'C', 'A']);
  expect(filterProjects(input, { ...query, sort: 'name' }).map((r) => r.project.id)).toEqual([
    'B',
    'A',
    'C',
  ]);
  expect(input).toEqual([a, b, c]);
});
it('loads every archived page without touching the active project cache', async () => {
  const get = vi
    .spyOn(api, 'get')
    .mockResolvedValueOnce({ items: [row('A').project], nextCursor: 'next/+=' })
    .mockResolvedValueOnce({ items: [row('B').project], nextCursor: null });
  expect(await archivedProjects()).toHaveLength(2);
  expect(get.mock.calls).toEqual([
    ['/projects?archived=true'],
    ['/projects?archived=true&cursor=next%2F%2B%3D'],
  ]);
});
it('uses document edits for last activity and propagates loading failures', async () => {
  vi.spyOn(api, 'get')
    .mockResolvedValueOnce({ items: [{ updatedAt: '2026-10-03', editedAt: '2026-10-24' }] })
    .mockResolvedValueOnce({ items: [] });
  expect((await projectOverview(row('A').project)).activity).toBe('2026-10-24');
  vi.mocked(api.get).mockRejectedValueOnce(new Error('offline'));
  await expect(projectOverview(row('B').project)).rejects.toThrow('offline');
});
