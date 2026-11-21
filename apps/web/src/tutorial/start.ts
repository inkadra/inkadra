import { type Board, type BoardCount, type BoardKind, offered } from '@inkadra/shared';
import { treeOrder } from '../board/boards.ts';
import { type BoardView, boardViews } from '../board/views.ts';
import type { Tour } from './tours.ts';

/**
 * The board a tour with `start` plays on: the one on screen when it has the view, else the
 * first in the sidebar's order that has it; without a view, the one on screen, else the
 * project's own (the root comes first).
 */
export function startBoard(
  boards: readonly Board[],
  counts: ReadonlyMap<string, BoardCount>,
  view: BoardView | undefined,
  currentId: string | undefined,
): Board | undefined {
  const has = (b: Board) => !view || boardViews(b, counts.get(b.id)).includes(view);
  const current = boards.find((b) => b.id === currentId);
  if (current && has(current)) return current;
  return treeOrder(boards).find(has);
}

/**
 * The kind of board to offer to make when a project has none with the view; null when making
 * one would not give it (Review is turned on in a board, a canvas is every project's own), or
 * when its module is off for this person (`off`, decision 0121).
 */
export function kindFor(
  view: BoardView | undefined,
  off: readonly string[] = [],
): Exclude<BoardKind, 'board'> | null {
  const kind =
    view === 'storyboard' || view === 'shotlist'
      ? 'storyboard'
      : view === 'schedule' || view === 'troupe'
        ? 'production'
        : view === 'moodboard'
          ? 'moodboard'
          : null;
  return kind && offered(off, 'kinds', kind) ? kind : null;
}

/**
 * The anchors that say a tour's screen is open: those of its steps. Any one will do, since a
 * phone hides some (Review shows no list of frames below 768px).
 */
export function screenOf(tour: Pick<Tour, 'steps'>): string[] {
  return tour.steps.flatMap((step) => (step.anchor ? [step.anchor] : []));
}

/**
 * Whether the screen is open: one of its anchors is there, and none is still loading (inside
 * `aria-busy`, like the Schedule before its days arrive), so the steps are not fixed too early.
 */
export function screenOpen(anchors: string[], find: (anchor: string) => Element | null): boolean {
  const found = anchors.map(find).filter((el) => el !== null);
  return found.length > 0 && !found.some((el) => el.closest('[aria-busy="true"]'));
}
