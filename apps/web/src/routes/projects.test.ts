import { afterEach, expect, it, vi } from 'vitest';
import { projectLanding } from '../board/project-landing.ts';
import { api } from '../lib/api.ts';
import { loadProjects } from './projects.ts';

afterEach(() => vi.restoreAllMocks());

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
