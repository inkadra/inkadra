import type { Project } from '@inkadra/shared';
import { describe, expect, it } from 'vitest';
import { editableProjects, lastDay, localDate } from './home-data.ts';

describe('home data', () => {
  it('asks for the local calendar date, not the UTC one', () => {
    expect(localDate(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05');
    expect(localDate(new Date(2026, 11, 31, 0, 5))).toBe('2026-12-31');
  });

  it('keeps the last 24 hours of activity, newest first and capped', () => {
    const now = new Date('2026-10-26T12:00:00Z');
    const at = (iso: string) => ({ createdAt: iso });
    const items = [
      at('2026-10-25T11:59:00Z'),
      at('2026-10-26T11:00:00Z'),
      at('2026-10-25T12:00:00Z'),
      at('2026-10-26T09:00:00Z'),
    ];
    expect(lastDay(items, now).map((n) => n.createdAt)).toEqual([
      '2026-10-26T11:00:00Z',
      '2026-10-26T09:00:00Z',
      '2026-10-25T12:00:00Z',
    ]);
    expect(lastDay(items, now, 1)).toEqual([at('2026-10-26T11:00:00Z')]);
  });

  it('offers new boards only in projects the person can edit, most recent first', () => {
    const project = (id: string, myRole: Project['myRole'], updatedAt: string) =>
      ({ id, myRole, updatedAt }) as Project;
    expect(
      editableProjects([
        project('viewer', 'viewer', '2026-10-26T00:00:00Z'),
        project('old', 'owner', '2026-10-01T00:00:00Z'),
        project('new', 'editor', '2026-10-20T00:00:00Z'),
        project('commenter', 'commenter', '2026-10-25T00:00:00Z'),
      ]).map((p) => p.id),
    ).toEqual(['new', 'old']);
    expect(editableProjects(null)).toEqual([]);
  });
});
