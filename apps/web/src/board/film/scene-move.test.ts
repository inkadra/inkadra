// @vitest-environment happy-dom
import type { Element } from '@inkadra/doc-schema';
import type { Board } from '@inkadra/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../lib/api.ts';
import {
  loadLastStoryboard,
  loadScenesNoticeAnswered,
  saveLastStoryboard,
  saveScenesNoticeAnswered,
} from '../canvas-prefs.ts';
import { defaultStoryboard, serverHolds, storyboardName } from './scene-move.ts';

const board = (id: string, kind: Board['kind']) => ({ id, kind }) as Board;
const section = (title: string, x: number, y: number) =>
  ({
    id: title,
    type: 'section',
    title,
    x,
    y,
    w: 600,
    z: 'a0',
    parent: null,
  }) as unknown as Element;

describe('scenes live in storyboards (decision 0140)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('chooses the storyboard opened last, else the first', () => {
    const storyboards = [board('a', 'storyboard'), board('b', 'storyboard')];
    expect(defaultStoryboard(storyboards, 'b')).toBe('b');
    expect(defaultStoryboard(storyboards, 'gone')).toBe('a');
    expect(defaultStoryboard([], null)).toBeNull();
    saveLastStoryboard('u1', 'p1', 'b');
    expect(loadLastStoryboard('u1', 'p1')).toBe('b');
    expect(loadLastStoryboard('u2', 'p1')).toBeNull();
  });

  it('names a new storyboard after the section heading right above the scenes', () => {
    const els = [
      section('Far away', 60, -900),
      section('Act one', 60, 6),
      section('Beside', 2000, 6),
    ];
    expect(storyboardName(els, { x: 60, y: 46 }, 'Storyboard')).toBe('Act one');
    expect(storyboardName(els, { x: 60, y: -2000 }, 'Storyboard')).toBe('Storyboard');
  });

  it('shows the notice once per board, once answered', () => {
    expect(loadScenesNoticeAnswered('u1', 'board1')).toBe(false);
    saveScenesNoticeAnswered('u1', 'board1');
    expect(loadScenesNoticeAnswered('u1', 'board1')).toBe(true);
    expect(loadScenesNoticeAnswered('u1', 'board2')).toBe(false);
  });

  it('holds the cards the server keeps something about, and those shooting days point at', async () => {
    vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path.endsWith('/comment-counts'))
        return {
          items: [
            { elementId: 'f1', open: 0, resolved: 2 },
            { elementId: 'f0', open: 0, resolved: 0 },
            { elementId: null, open: 3, resolved: 0 },
          ],
        };
      if (path.endsWith('/reviews')) return { items: [{ elementId: 'f2' }] };
      if (path.endsWith('/reactions')) return { items: [{ elementId: 'f3', reactions: [{}] }] };
      if (path.endsWith('/share-links')) return { items: [{ id: 'link' }] };
      if (path === '/share-links/link/picks') return { guests: [], items: [{ elementId: 'f4' }] };
      if (path === '/boards/prod/schedule')
        return {
          items: [
            {
              id: 'd1',
              date: '2026-03-01',
              boardId: 'prod',
              blocks: [
                { type: 'scene', shotId: null, sceneId: 's1', sceneBoardId: 'b1' },
                { type: 'shot', shotId: 'f9', shotBoardId: 'other' },
              ],
            },
          ],
        };
      throw new Error(path);
    });
    const held = await serverHolds('b1', [board('b1', 'board'), board('prod', 'production')]);
    expect(Object.fromEntries(held)).toEqual({
      f1: 'server',
      f2: 'server',
      f3: 'server',
      f4: 'server',
      s1: 'days',
    });
  });

  it('moves nothing when the server cannot tell', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new Error('offline'));
    await expect(serverHolds('b1', [board('b1', 'board')])).rejects.toThrow();
  });
});
