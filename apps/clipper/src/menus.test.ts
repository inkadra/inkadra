// SPDX-License-Identifier: MPL-2.0
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { menuItems, menuTitle, parseMenuId } from './menus.ts';

const board = (id: string, title = id) => ({ id, projectId: 'p', title, projectName: null });

beforeEach(() => {
  vi.stubGlobal('chrome', { i18n: { getMessage: (key: string) => key } });
});

describe('context menu construction', () => {
  it('keeps only the one-click items without boards', () => {
    expect(menuItems([]).map((item) => item.id)).toEqual([
      'save-image',
      'save-selection',
      'save-link',
      'save-page',
    ]);
  });

  it('has one top-level parent per context with at most 5 recent boards, newest first', () => {
    const items = menuItems(['a', 'b', 'c', 'd', 'e', 'f'].map((id) => board(id)));
    expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
    const topLevel = items.filter((item) => !item.parentId);
    expect(topLevel.map((item) => item.title)).toEqual([
      'menu_image_to',
      'menu_selection_to',
      'menu_link_to',
      'menu_page_to',
    ]);
    const children = items.filter((item) => item.parentId === 'save-to-selection');
    expect(children.map((item) => item.id)).toEqual(
      ['a', 'b', 'c', 'd', 'e'].map((id) => `save-to-selection:${id}`),
    );
    expect(children[0]?.contexts).toEqual(['selection']);
  });

  it('shows the access-key and selection markers of a board title literally', () => {
    expect(menuTitle('R&D & 100%s %%s')).toBe('R&&D && 100%​s %%​s');
    const [, child] = menuItems([board('a', 'A&B %s')]);
    expect(child?.title).toBe('A&&B %​s');
  });
});

describe('parseMenuId', () => {
  it('reads the context and the chosen board', () => {
    expect(parseMenuId('save-link')).toEqual({ context: 'link' });
    expect(parseMenuId('save-to-page:0193-a')).toEqual({ context: 'page', boardId: '0193-a' });
    expect(parseMenuId('other')).toBeNull();
  });
});
