import { describe, expect, it } from 'vitest';
import { projectLanding } from './project-landing.ts';

const projects = [{ id: 'p1', rootBoardId: 'root1' }];
const shared = [
  { id: 'b2', projectId: 'p2' },
  { id: 'b3', projectId: 'p2' },
];

describe('projectLanding', () => {
  it('opens the root board for members', () => {
    expect(projectLanding('p1', projects, null)).toEqual({ kind: 'board', boardId: 'root1' });
  });

  it('sends people with access to some boards to the first one shared with them', () => {
    expect(projectLanding('p2', projects, null)).toEqual({ kind: 'loading' });
    expect(projectLanding('p2', projects, shared)).toEqual({ kind: 'shared', boardId: 'b2' });
  });

  it('answers not found when nothing in the project is shared with you', () => {
    expect(projectLanding('p3', projects, shared)).toEqual({ kind: 'notFound' });
    expect(projectLanding('p3', [], [])).toEqual({ kind: 'notFound' });
  });

  it('waits for the projects first', () => {
    expect(projectLanding('p1', null, shared)).toEqual({ kind: 'loading' });
  });
});
