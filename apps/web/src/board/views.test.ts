import type { Board } from '@inkadra/shared';
import { describe, expect, it } from 'vitest';
import {
  boardViews,
  defaultView,
  hasOutsideCards,
  headerViews,
  isBoardView,
  kindIcon,
  movedView,
  offeredViews,
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
    expect(boardViews(board('board', ['review']), undefined)).toEqual(['canvas', 'review']);
    expect(boardViews(board('moodboard', ['review']), undefined)).toEqual(['moodboard']);
  });

  it('has no Board view on a storyboard', () => {
    for (const views of [[], ['shotlist', 'schedule', 'troupe', 'review'], null] as const)
      expect(boardViews(board('storyboard', views ? [...views] : null), undefined)).not.toContain(
        'canvas',
      );
  });

  it('keeps the views of boards from before decision 0121', () => {
    // A storyboard keeps everything it had, but Schedule and Troupe (decision 0123).
    expect(viewsOn(board('storyboard', null), undefined)).toEqual(['shotlist', 'review']);
    // An ordinary board keeps its moodboard only when it holds images, links or colours.
    expect(viewsOn(board('board', null), { referenceCount: 3 })).toEqual(['moodboard']);
    expect(viewsOn(board('board', null), { referenceCount: 0 })).toEqual([]);
    expect(viewsOn(board('board', undefined), undefined)).toEqual([]);
    // ... and its review while a guest review link is live.
    expect(viewsOn(board('board', null), { clientReview: true })).toEqual(['review']);
    expect(viewsOn(board('board', null), { referenceCount: 1, clientReview: true })).toEqual([
      'moodboard',
      'review',
    ]);
    expect(viewsOn(board('board', []), { clientReview: true })).toEqual([]);
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

describe('the views a module that is off leaves out (decision 0121)', () => {
  it('offers only the views of modules that are on, and keeps those already on', () => {
    expect(offeredViews(board('storyboard', ['shotlist']), undefined, [])).toEqual([
      'shotlist',
      'review',
    ]);
    // Off: not offered to turn on; a view that is on stays, to be turned off.
    expect(
      offeredViews(board('storyboard', ['shotlist', 'review']), undefined, ['storyboard', 'review']),
    ).toEqual(['shotlist', 'review']);
    expect(offeredViews(board('storyboard', []), undefined, ['storyboard', 'review'])).toEqual([]);
    expect(offeredViews(board('board', []), undefined, ['moodboard'])).toEqual(['review']);
    // The header still shows a view that is on, whatever the modules.
    expect(boardViews(board('board', ['moodboard']), undefined)).toContain('moodboard');
  });
});

describe('the Production board (decision 0123)', () => {
  it('always has Schedule and Crew, opens on Schedule and has no other view', () => {
    expect(boardViews(board('production', null), undefined)).toEqual(['schedule', 'troupe']);
    expect(boardViews(board('production', ['review']), undefined)).toEqual(['schedule', 'troupe']);
    expect(defaultView('production')).toBe('schedule');
    expect(openView(null, board('production', null), undefined)).toBe('schedule');
    expect(openView('troupe', board('production', null), undefined)).toBe('troupe');
    expect(offeredViews(board('production', null), undefined, [])).toEqual([]);
    expect(kindIcon('production')).toBe('film');
  });

  it('holds Schedule and Crew: a storyboard ignores them when stored', () => {
    const all = board('storyboard', ['shotlist', 'schedule', 'troupe']);
    expect(boardViews(all, undefined)).toEqual(['storyboard', 'shotlist']);
    expect(boardViews(board('storyboard', null), undefined)).toEqual([
      'storyboard',
      'shotlist',
      'review',
    ]);
    expect(offeredViews(all, undefined, [])).toEqual(['shotlist', 'review']);
    expect(openView('schedule', all, undefined)).toBe('storyboard');
    expect(headerViews(all, undefined, 'storyboard')).toEqual(['storyboard', 'shotlist']);
  });

  it("sends a storyboard's old Schedule and Troupe addresses to the Production board", () => {
    const story = board('storyboard', ['shotlist']);
    expect(movedView('schedule', story, true)).toBe('schedule');
    expect(movedView('troupe', story, true)).toBe('troupe');
    // Without one the person can see, the storyboard opens its first view.
    expect(movedView('schedule', story, false)).toBeNull();
    expect(movedView('shotlist', story, true)).toBeNull();
    expect(movedView('schedule', board('board', []), true)).toBeNull();
    expect(movedView('schedule', undefined, true)).toBeNull();
  });
});
