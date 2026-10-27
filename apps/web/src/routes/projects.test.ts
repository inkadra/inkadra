import type { Project } from '@inkadra/shared';
import { afterEach, expect, it, vi } from 'vitest';
import { projectLanding } from '../board/project-landing.ts';
import { api } from '../lib/api.ts';
import {
  getCachedProjects,
  loadProjects,
  refreshProjects,
  renameProject,
  setCachedProjects,
  subscribeProjects,
  updateProjectAppearance,
} from './projects.ts';

afterEach(() => {
  vi.restoreAllMocks();
  setCachedProjects(null);
});

it('opens a member project beyond the first page without treating it as missing', async () => {
  const first = Array.from({ length: 50 }, (_, i) => ({ id: `p${i}`, rootBoardId: `b${i}` }));
  const get = vi
    .spyOn(api, 'get')
    .mockResolvedValueOnce({ items: first, nextCursor: 'next/+=' })
    .mockResolvedValueOnce({ items: [{ id: 'p50', rootBoardId: 'b50' }], nextCursor: null });
  const projects = await loadProjects();
  expect(get.mock.calls).toEqual([['/projects'], ['/projects?cursor=next%2F%2B%3D']]);
  expect(projects).toHaveLength(51);
  expect(projectLanding('p50', projects, [])).toEqual({ kind: 'board', boardId: 'b50' });
});

it('renames a project and updates the cached projects list', async () => {
  const initial: Project = {
    id: 'p1',
    name: 'Old Project',
    rootBoardId: 'b1',
    icon: { shape: 'circle', color: 'neutral' },
    position: 'a0',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    archivedAt: null,
    myRole: 'owner',
  };
  setCachedProjects([initial]);

  const updated: Project = { ...initial, name: 'New Project Name' };
  const patch = vi.spyOn(api, 'patch').mockResolvedValueOnce(updated);

  let notified = false;
  const unsubscribe = subscribeProjects(() => {
    notified = true;
  });

  const res = await renameProject('p1', 'New Project Name');
  expect(patch).toHaveBeenCalledWith('/projects/p1', { name: 'New Project Name' });
  expect(res.name).toBe('New Project Name');
  expect(getCachedProjects()).toEqual([updated]);
  expect(notified).toBe(true);

  unsubscribe();
});

it('deduplicates concurrent refreshProjects calls', async () => {
  const items = [{ id: 'p1', name: 'Project 1', rootBoardId: 'b1' } as Project];
  const get = vi.spyOn(api, 'get').mockResolvedValue({ items, nextCursor: null });

  const [res1, res2] = await Promise.all([refreshProjects(), refreshProjects()]);
  expect(get).toHaveBeenCalledTimes(1);
  expect(res1).toEqual(items);
  expect(res2).toEqual(items);
  expect(getCachedProjects()).toEqual(items);
});

it('does not let a pending list overwrite a successful rename', async () => {
  const old = { id: 'race', name: 'Before' } as Project;
  const renamed = { ...old, name: 'After' };
  setCachedProjects([old]);
  let resolve!: (page: unknown) => void;
  vi.spyOn(api, 'get').mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  vi.spyOn(api, 'patch').mockResolvedValueOnce(renamed);
  const pending = refreshProjects();
  await renameProject('race', 'After');
  resolve({ items: [old], nextCursor: null });
  await pending;
  expect(getCachedProjects()).toEqual([renamed]);
});

it('does not repopulate a signed-out session from a pending project request', async () => {
  let resolve!: (page: unknown) => void;
  vi.spyOn(api, 'get').mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const pending = refreshProjects();
  setCachedProjects(null);
  resolve({ items: [{ id: 'private-project' }], nextCursor: null });
  await pending;
  expect(getCachedProjects()).toBeNull();
});

it('does not let an older project list overwrite saved appearance', async () => {
  const old = { id: 'appearance-race', icon: { shape: 'circle', color: 'neutral' } } as Project;
  const icon = { shape: 'square' as const, color: 'green' as const, emoji: '🎬' };
  const updated = { ...old, icon };
  setCachedProjects([old]);
  let resolve!: (page: unknown) => void;
  vi.spyOn(api, 'get').mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  vi.spyOn(api, 'patch').mockResolvedValueOnce(updated);
  const pending = refreshProjects();
  await updateProjectAppearance(old.id, icon);
  resolve({ items: [old], nextCursor: null });
  await pending;
  expect(getCachedProjects()).toEqual([updated]);
});
