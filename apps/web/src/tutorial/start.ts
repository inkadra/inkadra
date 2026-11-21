import type { Board, BoardCount, BoardKind } from '@inkadra/shared';
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
 * one would not give it (Review is turned on in a board, a canvas is every project's own).
 */
export function kindFor(view: BoardView | undefined): Exclude<BoardKind, 'board'> | null {
  if (view === 'storyboard' || view === 'shotlist') return 'storyboard';
  if (view === 'schedule' || view === 'troupe') return 'production';
  if (view === 'moodboard') return 'moodboard';
  return null;
}

/** The anchor that says a tour's screen is open: that of its first step that has one. */
export function screenOf(tour: Pick<Tour, 'steps'>): string | undefined {
  return tour.steps.find((step) => step.anchor)?.anchor ?? undefined;
}
