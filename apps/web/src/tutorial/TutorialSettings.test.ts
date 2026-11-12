import { describe, expect, it } from 'vitest';
import { tourGroups } from './TutorialSettings.tsx';
import { toursFor } from './tours.ts';

describe('tourGroups', () => {
  const tours = toursFor(true, false, []);
  const all = tourGroups(tours, new Set(), 'all');

  it('counts the seen tours of each group', () => {
    const [first] = all;
    const seen = new Set(first?.tours.map((tour) => tour.id));
    const groups = tourGroups(tours, seen, 'all');
    expect(groups[0]).toMatchObject({ seen: first?.total, total: first?.total });
    expect(groups.slice(1).every((group) => group.seen === 0)).toBe(true);
  });

  it('keeps only what is left to watch, hiding the groups seen in full', () => {
    const [first, second] = all;
    const watched = second?.tours[0]?.id ?? '';
    const seen = new Set([...(first?.tours.map((tour) => tour.id) ?? []), watched]);
    const groups = tourGroups(tours, seen, 'unseen');
    expect(groups.map((group) => group.group)).not.toContain(first?.group);
    expect(groups[0]?.group).toBe(second?.group);
    expect(groups[0]?.tours.map((tour) => tour.id)).not.toContain(watched);
    expect(groups[0]).toMatchObject({ seen: 1, total: second?.total });
  });

  it('lists nothing to watch when every tour was seen', () => {
    const seen = new Set(tours.map((tour) => tour.id));
    expect(tourGroups(tours, seen, 'unseen')).toEqual([]);
    expect(tourGroups(tours, seen, 'all')).toHaveLength(all.length);
  });
});
