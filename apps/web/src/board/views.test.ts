import type { Board } from '@inkadra/shared';
import { describe, expect, it } from 'vitest';
import {
  askedView,
  headerViews,
  isBoardView,
  pickerViews,
  projectHasStoryboard,
  storyboardOf,
  VIEWS,
  viewDestination,
  viewHref,
  viewIcon,
} from './views.ts';

const makeBoard = (
  id: string,
  kind: Board['kind'],
  parentBoardId: string | null = null,
): Board => ({
  id,
  projectId: 'p1',
  parentBoardId,
  kind,
  title: id,
  position: 'a0',
  coverAssetId: null,
  docSchemaVersion: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  myRole: 'owner',
});

const root = makeBoard('root', 'board');
const storyboard = makeBoard('sb', 'storyboard', 'root');
const boards = [root, storyboard, makeBoard('child', 'board', 'root')];
const current = { boardId: root.id, kind: root.kind, rootBoardId: root.id };
const onStoryboard = { boardId: storyboard.id, kind: storyboard.kind, rootBoardId: root.id };

describe('header views', () => {
  it('offers canvas and moodboard on an ordinary board, nothing while the kind loads', () => {
    expect(headerViews('board', 'canvas')).toEqual(['canvas', 'moodboard']);
    expect(headerViews('board', 'moodboard')).toEqual(['canvas', 'moodboard']);
    expect(headerViews(undefined, 'moodboard')).toEqual([]);
  });

  it('offers the film views on a storyboard', () => {
    expect(headerViews('storyboard', 'storyboard')).toEqual([
      'canvas',
      'storyboard',
      'shotlist',
      'schedule',
      'review',
    ]);
    expect(headerViews('storyboard', 'moodboard')).toContain('moodboard');
  });

  it('leaves the moodboard out of the phone picker on a storyboard only', () => {
    expect(pickerViews('storyboard', 'storyboard')).not.toContain('moodboard');
    expect(pickerViews('board', 'canvas')).toHaveLength(6);
    expect(pickerViews(undefined, null)).toHaveLength(6);
  });

  it('keeps the film views reachable while one of them is open', () => {
    expect(headerViews('board', 'shotlist')).toContain('shotlist');
    expect(headerViews('board', 'shotlist')).toHaveLength(6);
  });

  it('keeps the icon of every view', () => {
    expect(VIEWS.map((v) => v.view)).toEqual([
      'storyboard',
      'shotlist',
      'schedule',
      'review',
      'moodboard',
      'canvas',
    ]);
    expect(viewIcon('review')).toBe('people');
    expect(viewIcon('canvas')).toBe('board');
  });
});

describe('view destination', () => {
  it('opens the film views on the project storyboard from an ordinary board', () => {
    expect(viewDestination('shotlist', current, storyboard.id)).toEqual({
      boardId: storyboard.id,
      view: 'shotlist',
      kind: 'storyboard',
    });
    expect(viewDestination('storyboard', current, storyboard.id)).toEqual({
      boardId: storyboard.id,
      view: 'storyboard',
      kind: 'storyboard',
    });
  });

  it('stays on the open board for canvas and moodboard', () => {
    expect(viewDestination('canvas', current, storyboard.id)).toEqual({
      boardId: null,
      view: 'canvas',
    });
    expect(viewDestination('moodboard', current, storyboard.id)).toEqual({
      boardId: null,
      view: 'moodboard',
    });
  });

  it('stays when a film view is already showing the storyboard', () => {
    expect(viewDestination('shotlist', onStoryboard, storyboard.id)).toEqual({
      boardId: null,
      view: 'shotlist',
    });
  });

  it('opens film views on the root board when the project has no storyboard', () => {
    expect(viewDestination('shotlist', current, null)).toEqual({
      boardId: null,
      view: 'shotlist',
    });
    const onChild = { boardId: 'child', kind: 'board' as const, rootBoardId: root.id };
    const toRoot = viewDestination('storyboard', onChild, null);
    expect(toRoot).toEqual({ boardId: root.id, view: 'storyboard', kind: 'board' });
    expect(
      viewHref('p1', toRoot, { boardId: 'child', rootBoardId: root.id, kind: 'board' }),
    ).toMatch(/\?view=storyboard$/);
  });

  it('builds addresses with and without the view', () => {
    expect(viewHref('p1', { boardId: storyboard.id, view: 'shotlist' }, current)).toBe(
      '/p/p1/b/sb?view=shotlist',
    );
    expect(viewHref('p1', { boardId: storyboard.id, view: 'storyboard' }, current)).toBe(
      '/p/p1/b/sb',
    );
    expect(viewHref('p1', { boardId: null, view: 'canvas' }, current)).toBe('/p/p1');
    expect(viewHref('p1', { boardId: null, view: 'moodboard' }, current)).toBe(
      '/p/p1?view=moodboard',
    );
  });
});

describe('reading the address', () => {
  it('knows the views it can show', () => {
    for (const view of ['canvas', 'storyboard', 'shotlist', 'schedule', 'review', 'moodboard']) {
      expect(isBoardView(view)).toBe(true);
    }
    expect(isBoardView('timeline')).toBe(false);
    expect(isBoardView(null)).toBe(false);
  });

  it('falls back to the default view of the board', () => {
    expect(askedView(null, 'storyboard')).toBe('storyboard');
    expect(askedView(null, 'board')).toBe('canvas');
    expect(askedView('review', 'board')).toBe('review');
    expect(askedView('timeline', 'board')).toBe('canvas');
  });

  it('finds the project storyboard', () => {
    expect(storyboardOf(boards)).toBe('sb');
    expect(storyboardOf([root])).toBeNull();
    expect(storyboardOf(null)).toBeNull();
  });
});

describe('projectHasStoryboard', () => {
  const none = new Map<string, { frameCount: number }>();
  it('is false for a project of plain boards, and while its boards are unknown', () => {
    expect(projectHasStoryboard([makeBoard('a', 'board'), makeBoard('b', 'board')], none)).toBe(
      false,
    );
    expect(projectHasStoryboard(null, none)).toBe(false);
    expect(projectHasStoryboard(undefined, none)).toBe(false);
    expect(projectHasStoryboard([], none)).toBe(false);
  });

  it('is true with a storyboard board, or as soon as any board holds frames', () => {
    expect(
      projectHasStoryboard([makeBoard('a', 'board'), makeBoard('s', 'storyboard')], none),
    ).toBe(true);
    const framed = new Map([['a', { frameCount: 1 }]]);
    expect(projectHasStoryboard([makeBoard('a', 'board')], framed)).toBe(true);
    // The last frame going away takes the links away again.
    expect(
      projectHasStoryboard([makeBoard('a', 'board')], new Map([['a', { frameCount: 0 }]])),
    ).toBe(false);
  });
});
