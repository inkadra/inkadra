import type { Board, BoardDetail } from '@inkadra/shared';
import { describe, expect, it } from 'vitest';
import { breadcrumb } from './BoardPage.tsx';

const makeBoard = (id: string, parentBoardId: string | null, title: string): Board => ({
  id,
  projectId: 'p1',
  parentBoardId,
  kind: 'board',
  title,
  position: 'a0',
  coverAssetId: null,
  docSchemaVersion: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  myRole: 'owner',
});

const makeDetail = (
  id: string,
  parentBoardId: string | null,
  title: string,
  crumbs: Array<{ id: string; title: string }> = [],
): BoardDetail => ({
  ...makeBoard(id, parentBoardId, title),
  breadcrumb: crumbs,
});

describe('breadcrumb', () => {
  it('uses project name for the root board', () => {
    const rootId = 'root-1';
    const detail = makeDetail(rootId, null, 'Untitled');
    const crumbs = breadcrumb(rootId, rootId, 'Ultima corsa', detail, null);
    expect(crumbs).toEqual([{ id: rootId, title: 'Ultima corsa' }]);
  });

  it('reflects updated project name when the root board is renamed', () => {
    const rootId = 'root-1';
    const detail = makeDetail(rootId, null, 'Ultima corsa');
    const crumbs = breadcrumb(rootId, rootId, 'Ultima corsa - Definitivo', detail, null);
    expect(crumbs).toEqual([{ id: rootId, title: 'Ultima corsa - Definitivo' }]);
  });

  it('builds crumbs from detail and substitutes project name at root', () => {
    const rootId = 'root-1';
    const subId = 'sub-2';
    const detail = makeDetail(subId, rootId, 'Sopralluoghi', [{ id: rootId, title: 'Old root' }]);
    const crumbs = breadcrumb(subId, rootId, 'Ultima corsa', detail, null);
    expect(crumbs).toEqual([
      { id: rootId, title: 'Ultima corsa' },
      { id: subId, title: 'Sopralluoghi' },
    ]);
  });

  it('reflects updated project name at the root crumb when on child boards', () => {
    const rootId = 'root-1';
    const subId = 'sub-2';
    const detail = makeDetail(subId, rootId, 'Sopralluoghi', [{ id: rootId, title: 'Old root' }]);
    const crumbs = breadcrumb(subId, rootId, 'Ultima corsa - Definitivo', detail, null);
    expect(crumbs).toEqual([
      { id: rootId, title: 'Ultima corsa - Definitivo' },
      { id: subId, title: 'Sopralluoghi' },
    ]);
  });

  it('reflects live renamed board title from the boards cache over stale detail', () => {
    const rootId = 'root-1';
    const subId = 'sub-2';
    // Stale detail has old title
    const detail = makeDetail(subId, rootId, 'Old Title', [{ id: rootId, title: 'Root' }]);
    // Cached boards list has updated title from renameBoard
    const boards = [
      makeBoard(rootId, null, 'Root'),
      makeBoard(subId, rootId, 'New Location Scout'),
    ];
    const crumbs = breadcrumb(subId, rootId, 'Ultima corsa', detail, boards);
    expect(crumbs).toEqual([
      { id: rootId, title: 'Ultima corsa' },
      { id: subId, title: 'New Location Scout' },
    ]);
  });

  it('traverses parentBoardId chain when detail is not loaded', () => {
    const rootId = 'root-1';
    const childId = 'child-2';
    const grandChildId = 'grandchild-3';
    const boards = [
      makeBoard(rootId, null, 'Root Board'),
      makeBoard(childId, rootId, 'Parent Board'),
      makeBoard(grandChildId, childId, 'Current Board'),
    ];
    const crumbs = breadcrumb(grandChildId, rootId, 'Ultima corsa', null, boards);
    expect(crumbs).toEqual([
      { id: rootId, title: 'Ultima corsa' },
      { id: childId, title: 'Parent Board' },
      { id: grandChildId, title: 'Current Board' },
    ]);
  });
});
