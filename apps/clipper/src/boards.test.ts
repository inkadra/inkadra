// SPDX-License-Identifier: MPL-2.0
import type { Board, Project, SearchHit } from '@inkadra/shared';
import { describe, expect, it } from 'vitest';
import type { InkadraApi } from './api.ts';
import { boardTree, searchBoards, startingBoards } from './boards.ts';

const NOW = '2026-10-01T10:00:00.000Z';

function board(id: string, parentBoardId: string | null, extra: Partial<Board> = {}): Board {
  return {
    id,
    projectId: 'p1',
    parentBoardId,
    kind: 'board',
    title: id,
    position: 'a0',
    coverAssetId: null,
    docSchemaVersion: 1,
    createdAt: NOW,
    updatedAt: NOW,
    myRole: 'editor',
    ...extra,
  };
}

function project(id: string, extra: Partial<Project> = {}): Project {
  return {
    id,
    name: `Project ${id}`,
    icon: { shape: 'circle', color: 'blue' },
    rootBoardId: `root-${id}`,
    position: 'a0',
    archivedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    myRole: 'owner',
    ...extra,
  };
}

describe('boards for the picker', () => {
  it('lists recent boards, then editable projects, then shared boards', async () => {
    const api = {
      projects: async () => [
        project('a'),
        project('b', { myRole: 'viewer' }),
        project('c', { archivedAt: NOW }),
      ],
      sharedBoards: async () => [board('s1', 'x'), board('s2', 'x', { myRole: 'commenter' })],
    } as unknown as InkadraApi;
    const recent = [{ id: 'r1', projectId: 'p1', title: 'Recent', projectName: 'Film' }];
    const options = await startingBoards(api, recent);
    expect(options.map((o) => [o.section, o.id, o.expandable])).toEqual([
      ['recent', 'r1', false],
      ['project', 'root-a', true],
      ['shared', 's1', true],
    ]);
  });

  it('builds the tree below a board, in position order, skipping read-only boards', () => {
    const boards = [
      board('root', null),
      board('b2', 'root', { position: 'a2' }),
      board('b1', 'root', { position: 'a1' }),
      board('b1a', 'b1'),
      board('ro', 'root', { position: 'a3', myRole: 'viewer' }),
      board('ro-child', 'ro'),
    ];
    expect(boardTree(boards, 'root', 'Film').map((o) => [o.id, o.depth])).toEqual([
      ['b1', 1],
      ['b1a', 2],
      ['b2', 1],
      ['ro-child', 2],
    ]);
  });

  it('puts boards matched by title before boards that contain matching cards', async () => {
    const hit = (kind: SearchHit['kind'], boardId: string | null): SearchHit => ({
      kind,
      projectId: 'p1',
      projectName: 'Film',
      boardId,
      boardTitle: boardId,
      boardKind: 'board',
      elementId: null,
      elementType: null,
      title: 't',
      snippet: null,
      assetId: null,
      tags: [],
    });
    const api = {
      search: async () => [
        hit('element', 'b1'),
        hit('project', null),
        hit('board', 'b2'),
        hit('element', 'b2'),
      ],
    } as unknown as InkadraApi;
    expect((await searchBoards(api, 'x')).map((o) => o.id)).toEqual(['b2', 'b1']);
  });
});
