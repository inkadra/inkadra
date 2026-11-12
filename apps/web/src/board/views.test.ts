import type { Board } from '@inkadra/shared';
import { describe, expect, it } from 'vitest';
import {
  boardViews,
  defaultView,
  hasOutsideCards,
  headerViews,
  isBoardView,
  kindIcon,
  openView,
  VIEWS,
  viewHref,
  viewIcon,
  viewLabelKey,
  viewsOn,
} from './views.ts';

const board = (kind: Board['kind'], views?: Board['views']) => ({ kind, views });

describe('the views of a board (decision 0121)', () => {
  it('gives each kind its own view, and only the optional views it allows', () => {
    expect(boardViews(board('board', []), undefined)).toEqual(['canvas']);
    expect(boardViews(board('board', ['moodboard']), undefined)).toEqual(['canvas', 'moodboard']);
    expect(boardViews(board('moodboard', []), undefined)).toEqual(['moodboard']);
    expect(boardViews(board('storyboard', ['shotlist']), undefined)).toEqual([
      'storyboard',
      'shotlist',
    ]);
    // A view another kind owns is never on, whatever is stored.
    expect(boardViews(board('moodboard', ['shotlist']), undefined)).toEqual(['moodboard']);
    expect(boardViews(board('board', ['review']), undefined)).toEqual(['canvas']);
  });

  it('has no Board view on a storyboard', () => {
    for (const views of [[], ['shotlist', 'schedule', 'troupe', 'review'], null] as const)
      expect(boardViews(board('storyboard', views ? [...views] : null), undefined)).not.toContain(
        'canvas',
      );
  });

  it('keeps the views of boards from before decision 0121', () => {
    // A storyboard keeps everything it had.
    expect(viewsOn(board('storyboard', null), undefined)).toEqual([
      'shotlist',
      'schedule',
      'troupe',
      'review',
    ]);
    // An ordinary board keeps its moodboard only when it holds images, links or colours.
    expect(viewsOn(board('board', null), { referenceCount: 3 })).toEqual(['moodboard']);
    expect(viewsOn(board('board', null), { referenceCount: 0 })).toEqual([]);
    expect(viewsOn(board('board', undefined), undefined)).toEqual([]);
    // A stored choice wins over the content.
    expect(viewsOn(board('board', []), { referenceCount: 3 })).toEqual([]);
  });

  it('opens on the view of its kind', () => {
    expect(defaultView('board')).toBe('canvas');
    expect(defaultView('moodboard')).toBe('moodboard');
    expect(defaultView('storyboard')).toBe('storyboard');
    expect(kindIcon('storyboard')).toBe('storyboard');
    expect(kindIcon('moodboard')).toBe('image');
    expect(kindIcon('board')).toBe('board');
  });
});

describe('reading the address', () => {
  it('opens the first view when the address asks for one that is off', () => {
    expect(openView('moodboard', board('board', []), undefined)).toBe('canvas');
    expect(openView('moodboard', board('board', ['moodboard']), undefined)).toBe('moodboard');
    expect(openView('review', board('storyboard', ['shotlist']), undefined)).toBe('storyboard');
    expect(openView('shotlist', board('storyboard', ['shotlist']), undefined)).toBe('shotlist');
    expect(openView('canvas', board('moodboard', []), undefined)).toBe('moodboard');
    expect(openView('timeline', board('board', []), undefined)).toBe('canvas');
    expect(openView(null, board('storyboard', []), undefined)).toBe('storyboard');
  });

  it('knows only a valid asked view while the board is unknown', () => {
    expect(openView('review', undefined, undefined)).toBe('review');
    expect(openView(null, undefined, undefined)).toBeNull();
    expect(openView('timeline', undefined, undefined)).toBeNull();
    expect(isBoardView('timeline')).toBe(false);
    expect(isBoardView(null)).toBe(false);
  });

  it('opens the cards outside a storyboard only while there are some', () => {
    const story = board('storyboard', ['shotlist']);
    expect(openView('canvas', story, { looseCount: 2 })).toBe('canvas');
    expect(openView('canvas', story, { looseCount: 0 })).toBe('storyboard');
    // Unknown counts keep the way open rather than bounce a link.
    expect(openView('canvas', story, undefined)).toBe('canvas');
    expect(hasOutsideCards(story, { looseCount: 0 })).toBe(false);
    expect(hasOutsideCards(board('board', []), { looseCount: 5 })).toBe(false);
  });
});

describe('the header, the sidebar and the phone', () => {
  it('lists the views of the open board, nothing while it loads', () => {
    expect(headerViews(undefined, undefined, 'canvas')).toEqual([]);
    expect(headerViews(board('board', []), undefined, 'canvas')).toEqual(['canvas']);
    expect(headerViews(board('storyboard', ['shotlist', 'review']), undefined, 'review')).toEqual([
      'storyboard',
      'shotlist',
      'review',
    ]);
  });

  it('adds the cards outside the storyboard while they are open, under their own name', () => {
    expect(headerViews(board('storyboard', []), { looseCount: 1 }, 'canvas')).toEqual([
      'storyboard',
      'canvas',
    ]);
    expect(viewLabelKey('canvas', 'storyboard')).toBe('board.outside.title');
    expect(viewLabelKey('canvas', 'board')).toBe('film.views.canvas');
  });

  it('builds addresses with and without the view', () => {
    const sb = { id: 'sb', kind: 'storyboard' as const };
    expect(viewHref('p1', sb, 'storyboard', 'root')).toBe('/p/p1/b/sb');
    expect(viewHref('p1', sb, 'shotlist', 'root')).toBe('/p/p1/b/sb?view=shotlist');
    expect(viewHref('p1', { id: 'root', kind: 'board' }, 'canvas', 'root')).toBe('/p/p1');
    expect(viewHref('p1', { id: 'root', kind: 'board' }, 'moodboard', 'root')).toBe(
      '/p/p1?view=moodboard',
    );
    expect(viewHref('p1', { id: 'm', kind: 'moodboard' }, 'moodboard', 'root')).toBe('/p/p1/b/m');
  });

  it('keeps the icon of every view', () => {
    expect(VIEWS.map((v) => v.view)).toEqual([
      'storyboard',
      'shotlist',
      'schedule',
      'troupe',
      'review',
      'moodboard',
      'canvas',
    ]);
    expect(viewIcon('review')).toBe('people');
    expect(viewIcon('canvas')).toBe('board');
  });
});
