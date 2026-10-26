import { afterEach, describe, expect, it, vi } from 'vitest';
import { filterTagSuggestions, loadTagsForProjects, mergeTagCounts } from '../board/tags.tsx';
import { api } from '../lib/api.ts';
import { parseQuery } from './SearchDialog.tsx';

afterEach(() => vi.restoreAllMocks());

describe('tag suggestions and merging', () => {
  it('merges tag counts across projects, summing counts and sorting by popularity', () => {
    const list1 = [
      { tag: 'notte', count: 3 },
      { tag: 'neon', count: 1 },
    ];
    const list2 = [
      { tag: 'notte', count: 2 },
      { tag: 'esterno', count: 4 },
    ];
    const merged = mergeTagCounts([list1, list2]);
    expect(merged).toEqual([
      { tag: 'notte', count: 5 },
      { tag: 'esterno', count: 4 },
      { tag: 'neon', count: 1 },
    ]);
  });

  it('shows most used tags when only # is typed', () => {
    const tags = [
      { tag: 'neon', count: 1 },
      { tag: 'notte', count: 5 },
      { tag: 'esterno', count: 4 },
    ];
    const suggestions = filterTagSuggestions(tags, '#');
    expect(suggestions.map((s) => s.tag)).toEqual(['notte', 'esterno', 'neon']);
  });

  it('ranks prefix matches before substring matches and sorts by count', () => {
    const tags = [
      { tag: 'finestra', count: 10 },
      { tag: 'esterno', count: 2 },
      { tag: 'estate', count: 5 },
    ];
    // Both 'esterno' and 'estate' start with 'est'. 'finestra' contains 'est'.
    const suggestions = filterTagSuggestions(tags, '#est');
    expect(suggestions.map((s) => s.tag)).toEqual(['estate', 'esterno', 'finestra']);
  });

  it('loads tags for multiple projects via the API endpoint', async () => {
    const get = vi
      .spyOn(api, 'get')
      .mockResolvedValueOnce({
        items: [
          { tag: 'notte', count: 2 },
          { tag: 'neon', count: 1 },
        ],
      })
      .mockResolvedValueOnce({
        items: [{ tag: 'notte', count: 3 }],
      });
    const tags = await loadTagsForProjects(['p1', 'p2']);
    expect(get.mock.calls).toEqual([['/projects/p1/tags'], ['/projects/p2/tags']]);
    expect(tags).toEqual([
      { tag: 'notte', count: 5 },
      { tag: 'neon', count: 1 },
    ]);
  });
});

describe('search query parsing', () => {
  it('preserves a selected multiword tag, including when adding free text', () => {
    expect(parseQuery('#blue hour', 'blue hour')).toEqual({ tag: 'blue hour' });
    expect(parseQuery('#blue hour station', 'blue hour')).toEqual({
      tag: 'blue hour',
      q: 'station',
    });
  });
  it('parses queries with tag and text', () => {
    expect(parseQuery('#notte stazione')).toEqual({ tag: 'notte', q: 'stazione' });
    expect(parseQuery('#notte')).toEqual({ tag: 'notte' });
    expect(parseQuery('stazione')).toEqual({ q: 'stazione' });
    expect(parseQuery('#')).toEqual({});
  });
});

it('does not offer cached tags when access is revoked', async () => {
  const get = vi.spyOn(api, 'get').mockResolvedValueOnce({ items: [{ tag: 'private', count: 1 }] });
  await loadTagsForProjects(['revoked']);
  get.mockRejectedValueOnce(new Error('Not found'));
  expect(await loadTagsForProjects(['revoked'])).toEqual([]);
});
