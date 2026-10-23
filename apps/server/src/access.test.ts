import { describe, expect, it } from 'vitest';
import { effectiveRole, effectiveRoles } from './access.ts';

// root > pre > mood, root > pre > story, root > post
const boards = [
  { id: 'root', parentBoardId: null },
  { id: 'pre', parentBoardId: 'root' },
  { id: 'mood', parentBoardId: 'pre' },
  { id: 'story', parentBoardId: 'pre' },
  { id: 'post', parentBoardId: 'root' },
];

describe('effective role', () => {
  it('inherits the project role without grants', () => {
    expect(effectiveRole(['mood', 'pre', 'root'], new Map(), 'editor')).toEqual({
      role: 'editor',
      grantBoardId: null,
    });
  });

  it('lets the nearest grant win, lower or higher', () => {
    const grants = new Map([
      ['pre', 'commenter' as const],
      ['story', 'owner' as const],
    ]);
    expect(effectiveRole(['mood', 'pre', 'root'], grants, 'editor')).toEqual({
      role: 'commenter',
      grantBoardId: 'pre',
    });
    expect(effectiveRole(['story', 'pre', 'root'], grants, 'editor').role).toBe('owner');
    expect(effectiveRole(['post', 'root'], grants, 'editor').role).toBe('editor');
  });

  it('gives people with grants only the granted subtree', () => {
    const roles = effectiveRoles(boards, new Map([['pre', 'viewer' as const]]), null);
    expect(Object.fromEntries([...roles].map(([id, e]) => [id, e.role]))).toEqual({
      root: null,
      pre: 'viewer',
      mood: 'viewer',
      story: 'viewer',
      post: null,
    });
  });

  it('agrees with effectiveRole on every board', () => {
    const grants = new Map([
      ['pre', 'commenter' as const],
      ['story', 'editor' as const],
    ]);
    const parent = new Map(boards.map((b) => [b.id, b.parentBoardId]));
    const chain = (id: string) => {
      const out: string[] = [];
      for (let at: string | null | undefined = id; at; at = parent.get(at)) out.push(at);
      return out;
    };
    const all = effectiveRoles(boards, grants, 'viewer');
    for (const b of boards)
      expect(all.get(b.id)).toEqual(effectiveRole(chain(b.id), grants, 'viewer'));
  });
});
