import type { Project, ProjectGroup } from '@inkadra/shared';
import { expect, it } from 'vitest';
import { groupProjects } from './project-groups.ts';

const project = (id: string, group?: [string, string]) =>
  ({ id, group: group ? { id: group[0], position: group[1] } : null }) as Project;
const group = (id: string, position: string) =>
  ({ id, name: id, color: 'blue', position, collapsed: false }) as ProjectGroup;

it('splits loose projects from groups, each in its own order', () => {
  const list = [
    project('loose'),
    project('b', ['series', 'a1']),
    // Fractional indexes compare as plain strings: Zz comes before a0.
    project('a', ['series', 'Zz']),
    project('c', ['client', 'a0']),
    project('stale', ['gone', 'a0']),
  ];
  const result = groupProjects(list, [group('series', 'a1'), group('client', 'a0')], (p) => p);
  expect(result.loose.map((p) => p.id)).toEqual(['loose', 'stale']);
  expect(result.groups.map((g) => [g.group.id, g.items.map((p) => p.id)])).toEqual([
    ['client', ['c']],
    ['series', ['a', 'b']],
  ]);
  // The Projects page keeps its own sort inside groups.
  const sorted = groupProjects(list, [group('series', 'a1')], (p) => p, true);
  expect(sorted.groups[0]?.items.map((p) => p.id)).toEqual(['b', 'a']);
});
