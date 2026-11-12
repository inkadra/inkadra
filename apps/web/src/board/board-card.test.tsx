// @vitest-environment happy-dom
import { createElement } from '@inkadra/canvas-core';
import { createBoardDoc, type Element, readElement, roots } from '@inkadra/doc-schema';
import type { Board, BoardPreview } from '@inkadra/shared';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RequestError } from '../lib/api.ts';
import { cardView, showsPreview } from './BoardCardPreview.tsx';
import { resetBoardPreviews } from './board-previews.ts';
import { Card } from './cards.tsx';
import { BoardContext, type BoardContextValue, GuestModeContext } from './context.ts';
import { BoardStore } from './store.ts';

const get = vi.hoisted(() => vi.fn());
vi.mock('react-i18next', () => {
  const t = (key: string, o?: { count?: number }) =>
    o?.count === undefined ? key : `${key}:${o.count}`;
  return { useTranslation: () => ({ t, i18n: { language: 'en' } }) };
});
vi.mock('../lib/api.ts', async (actual) => ({
  ...(await actual<typeof import('../lib/api.ts')>()),
  api: { get },
}));

const FILM = '00000000-0000-4000-8000-0000000000f1';
const board = (kind: Board['kind'], views: Board['views']) =>
  ({
    id: FILM,
    projectId: 'p',
    parentBoardId: 'root',
    kind,
    title: 'Film',
    position: 'a0',
    coverAssetId: null,
    icon: null,
    views,
    docSchemaVersion: 1,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
  }) as Board;

const storyboard: BoardPreview = {
  assetIds: [],
  excerpts: [],
  elementCount: 9,
  drawing: [],
  frames: ['1A', '1B', '1C', '1D'].map((label) => ({
    label,
    shot: 'free size',
    lens: '35mm',
    ratio: 16 / 9,
    drawing: [],
  })),
  review: { approved: 2, changes: 1, total: 6 },
};

describe('the card of a sub-board (decision 0121)', () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    get.mockReset();
    get.mockImplementation(async (path: string) => {
      if (path.endsWith('/preview')) return structuredClone(storyboard);
      throw new RequestError(404, 'not_found', 'none');
    });
    resetBoardPreviews();
    localStorage.clear();
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  let doc = createBoardDoc('boardAAAAAAAA');
  let id = '';
  async function show(
    b: Board,
    size: { w: number; h?: number },
    { guest = false, again = false, others = [] as Board[] } = {},
  ): Promise<HTMLElement> {
    // `again` draws the same card: what this person chose is kept per card.
    if (!again) {
      doc = createBoardDoc('boardAAAAAAAA');
      id = createElement(
        doc,
        'board',
        { x: 0, y: 0 },
        { boardId: FILM, ...size },
        { userId: null },
      ).id;
    }
    const context = {
      store: new BoardStore(doc),
      readOnly: false,
      projectId: 'p',
      userId: 'me',
      boards: [b, ...others],
      boardCounts: new Map([
        [FILM, { boardId: FILM, elementCount: 9, frameCount: 6, framesToShoot: 6 }],
      ]),
      editing: null,
      setEditing: vi.fn(),
      scale: 1,
    } as unknown as BoardContextValue;
    await act(async () =>
      root.render(
        <GuestModeContext.Provider value={guest}>
          <BoardContext.Provider value={context}>
            <Card element={readElement(roots(doc).elements.get(id)!) as Element} selected={false} />
          </BoardContext.Provider>
        </GuestModeContext.Provider>,
      ),
    );
    return host;
  }

  it('previews tall cards only, and picks a view the board still has', () => {
    expect(showsPreview({})).toBe(false);
    expect(showsPreview({ h: 66 })).toBe(false);
    expect(showsPreview({ h: 260 })).toBe(true);
    expect(cardView(['storyboard', 'shotlist'], 'shotlist')).toBe('shotlist');
    expect(cardView(['storyboard', 'shotlist'], 'review')).toBe('storyboard');
    expect(cardView(['canvas'], null)).toBe('canvas');
  });

  it('shows the first frames, +N, and remembers the chosen tab', async () => {
    const film = board('storyboard', ['shotlist', 'review']);
    const card = await show(film, { w: 320, h: 260 });
    await vi.waitFor(() => expect(card.querySelectorAll('.board-card__frame')).toHaveLength(3));
    expect(get).toHaveBeenCalledWith(`/boards/${FILM}/preview`);
    expect(card.querySelector('.board-card__more')?.textContent).toBe('board.board.more:3');
    const tabs = [...card.querySelectorAll<HTMLButtonElement>('[role=tab]')];
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      'film.views.storyboard',
      'film.views.shotlist',
      'film.views.review',
    ]);
    await act(async () => tabs[1]?.click());
    expect(card.querySelectorAll('.board-card__table tbody tr')).toHaveLength(4);
    // Another visit on this device opens on the same view.
    await act(async () => root.unmount());
    root = createRoot(host);
    await show(film, { w: 320, h: 260 }, { again: true });
    expect(card.querySelector('[aria-selected=true]')?.textContent).toBe('film.views.shotlist');
    await act(async () => card.querySelectorAll<HTMLButtonElement>('[role=tab]')[2]?.click());
    expect(card.querySelector('[role=progressbar]')?.getAttribute('aria-valuenow')).toBe('2');
    expect(card.querySelector('.board-card__changes')?.textContent).toBe('board.board.changes:1');
  });

  it('says while the preview loads and when it cannot be shown', async () => {
    get.mockReturnValue(new Promise(() => {}));
    const loading = await show(board('board', []), { w: 320, h: 260 });
    expect(loading.querySelector('.board-card__note')?.textContent).toBe('board.board.loading');
    await act(async () => root.unmount());
    root = createRoot(host);
    resetBoardPreviews();
    get.mockRejectedValue(new RequestError(404, 'not_found', 'none'));
    const card = await show(board('board', []), { w: 320, h: 260 });
    await vi.waitFor(() =>
      expect(card.querySelector('.board-card__note')?.textContent).toBe('board.board.unavailable'),
    );
    expect(card.querySelector('[role=tablist]')).toBeNull();
  });

  it('keeps old cards and guests on the name only, without asking for a preview', async () => {
    const film = board('storyboard', ['shotlist']);
    expect((await show(film, { w: 180 })).querySelector('.card__board')).not.toBeNull();
    expect(
      (await show(film, { w: 320, h: 260 }, { guest: true })).querySelector('.board-card'),
    ).toBeNull();
    expect(get).not.toHaveBeenCalledWith(`/boards/${FILM}/preview`);
  });

  describe('of a Production board (decision 0123)', () => {
    const TEASER = '00000000-0000-4000-8000-0000000000a1';
    const GONE = '00000000-0000-4000-8000-0000000000a2';
    const teaser = { ...board('storyboard', []), id: TEASER, title: 'Teaser' } as Board;
    const production: BoardPreview = {
      assetIds: [],
      excerpts: [],
      elementCount: 0,
      drawing: [],
      dayCount: 3,
      crewCount: 6,
      nextDay: {
        number: 2,
        date: '2026-11-17',
        callTime: '19:00',
        location: 'Deposito treni',
        blocks: [
          { start: '19:00', type: 'shot', title: 'Marta sale', boardId: TEASER, label: '2A' },
          { start: '20:00', type: 'scene', title: '', boardId: GONE, label: '3' },
          { start: '21:00', type: 'break', title: '', boardId: null, label: null },
        ],
      },
      crew: [
        { name: 'Matteo M.', role: 'Regia' },
        { name: 'Sara B.', role: 'Fotografia' },
        { name: 'Luca R.', role: '1° AC' },
        { name: 'Giulia T.', role: 'Suono' },
      ],
    };
    const answer = (preview: BoardPreview) =>
      get.mockImplementation(async () => structuredClone(preview));

    it('shows the next day with dots and labels, then the troupe', async () => {
      answer(production);
      const card = await show(board('production', null), { w: 320, h: 260 }, { others: [teaser] });
      await vi.waitFor(() => expect(card.querySelectorAll('.board-card__block')).toHaveLength(3));
      expect(card.querySelector('.board-card__meta')?.textContent).toBe('board.board.days:3');
      expect(card.querySelector('.board-card__day span')?.textContent).toBe(
        'Deposito treni · schedule.callAt',
      );
      const rows = [...card.querySelectorAll('.board-card__block')];
      expect(rows.map((r) => r.querySelector('.board-card__what')?.textContent)).toEqual([
        '2A · Marta sale',
        'schedule.sceneShort',
        'schedule.types.break',
      ]);
      // The dot is named by its storyboard, grey when it cannot be read; none for a break.
      expect(rows[0]?.querySelector('[role=img]')?.getAttribute('aria-label')).toBe('Teaser');
      expect(rows[1]?.querySelector('[role=img]')?.getAttribute('aria-label')).toBe(
        'schedule.unavailable',
      );
      expect(rows[2]?.querySelector('[role=img]')).toBeNull();
      expect(card.querySelector('.board-card__more')?.textContent).toBe('board.board.moreDays:2');
      // The day comes from the preview only: no storyboard document is asked for.
      expect(get.mock.calls.map(([path]) => path)).toEqual([`/boards/${FILM}/preview`]);

      await act(async () => card.querySelectorAll<HTMLButtonElement>('[role=tab]')[1]?.click());
      expect(card.querySelector('.board-card__meta')?.textContent).toBe('board.board.people:6');
      expect([...card.querySelectorAll('.board-card__person')].map((p) => p.textContent)).toEqual([
        'MMMatteo M.Regia',
        'SBSara B.Fotografia',
        'LRLuca R.1° AC',
        'GTGiulia T.Suono',
      ]);
      expect(card.querySelector('.board-card__more')?.textContent).toBe('board.board.morePeople:2');
    });

    it('says when there is no day, no one, or the troupe is not shown', async () => {
      answer({ ...production, dayCount: 0, nextDay: undefined, crewCount: 0, crew: [] });
      const card = await show(board('production', null), { w: 320, h: 260 });
      await vi.waitFor(() =>
        expect(card.querySelector('.board-card__empty')?.textContent).toBe(
          'board.board.empty.schedule',
        ),
      );
      await act(async () => card.querySelectorAll<HTMLButtonElement>('[role=tab]')[1]?.click());
      expect(card.querySelector('.board-card__empty')?.textContent).toBe(
        'board.board.empty.troupe',
      );
      // Someone outside the project: the crew is not sent.
      await act(async () => root.unmount());
      root = createRoot(host);
      resetBoardPreviews();
      const { crew: _crew, crewCount: _count, ...granted } = production;
      answer(granted);
      await show(board('production', null), { w: 320, h: 260 }, { again: true });
      await vi.waitFor(() =>
        expect(card.querySelector('.board-card__empty')?.textContent).toBe(
          'board.board.empty.troupeHidden',
        ),
      );
      expect(card.querySelector('.board-card__meta')?.textContent).toBe('');
    });
  });
});
