// SPDX-License-Identifier: AGPL-3.0-only
import type { Board, BoardCount, BoardKind } from '@inkadra/shared';
import type { IconName } from '@inkadra/ui';
import { boardPath } from './boards.ts';

/** The ways of looking at a board; `?view=` holds every one but the default. */
export type BoardView = 'storyboard' | 'shotlist' | 'schedule' | 'review' | 'moodboard' | 'canvas';

export const VIEWS: Array<{ view: BoardView; icon: IconName }> = [
  { view: 'storyboard', icon: 'storyboard' },
  { view: 'shotlist', icon: 'shotlist' },
  { view: 'schedule', icon: 'calendar' },
  { view: 'review', icon: 'people' },
  { view: 'moodboard', icon: 'image' },
  { view: 'canvas', icon: 'board' },
];

/** The views that only a storyboard board holds: shots, scenes, shooting days and review. */
const FILM_VIEWS: readonly BoardView[] = ['storyboard', 'shotlist', 'schedule', 'review'];

/** Reading order of the switcher: the board first, then the film views. */
export const ALL_VIEWS: readonly BoardView[] = [
  'canvas',
  'storyboard',
  'shotlist',
  'schedule',
  'review',
  'moodboard',
];

export function isFilmView(view: BoardView | null): boolean {
  return view !== null && FILM_VIEWS.includes(view);
}

export function isBoardView(value: string | null): value is BoardView {
  return ALL_VIEWS.includes(value as BoardView);
}

/** The icon a view is drawn with in the switcher, the rail and the sidebar. */
export function viewIcon(view: BoardView): IconName {
  return VIEWS.find((v) => v.view === view)?.icon ?? 'board';
}

/** The view a board opens on when the address has no `?view=`. */
export function defaultView(kind: BoardKind | undefined): BoardView {
  return kind === 'storyboard' ? 'storyboard' : 'canvas';
}

/** Where the address bar already points, or the board default when it says nothing usable. */
export function askedView(asked: string | null, kind: BoardKind | undefined): BoardView {
  return isBoardView(asked) ? asked : defaultView(kind);
}

/** The project's storyboard, where the film views live; null when the project has none. */
export function storyboardOf(boards: readonly Board[] | null | undefined): string | null {
  return boards?.find((b) => b.kind === 'storyboard')?.id ?? null;
}

/**
 * Whether the project has a storyboard: a board of that kind, or any board that already holds
 * frames. The sidebar lists the film views only then. Unknown boards count as none.
 */
export function projectHasStoryboard(
  boards: readonly Board[] | null | undefined,
  counts: ReadonlyMap<string, Pick<BoardCount, 'frameCount'>>,
): boolean {
  if (storyboardOf(boards)) return true;
  return !!boards?.some((b) => (counts.get(b.id)?.frameCount ?? 0) > 0);
}

/**
 * The board with a live client review link, in the order of the boards: where Review opens for a
 * project without a storyboard. Null when there is none, and while the boards are unknown.
 */
export function clientReviewBoard(
  boards: readonly Board[] | null | undefined,
  counts: ReadonlyMap<string, Pick<BoardCount, 'clientReview'>>,
): string | null {
  return boards?.find((b) => counts.get(b.id)?.clientReview)?.id ?? null;
}

/**
 * What the header offers: canvas and the film views on a storyboard, or while a film view is
 * open so there is a way back. An ordinary board offers its own two views, canvas and
 * moodboard; nothing while its kind is still loading. A storyboard has no moodboard tab: its
 * pictures live in the frames, and references get a board of their own. An address that asks
 * for the moodboard still shows its tab, so the open view always has one.
 */
export function headerViews(kind: BoardKind | undefined, active: BoardView): BoardView[] {
  const film = kind === 'storyboard' || FILM_VIEWS.includes(active);
  if (!film) return kind ? ['canvas', 'moodboard'] : [];
  return pickerViews(kind, active);
}

/** The phone's view picker: every view, but no moodboard on a storyboard, as in the header. */
export function pickerViews(kind: BoardKind | undefined, active: BoardView | null): BoardView[] {
  return ALL_VIEWS.filter(
    (v) => v !== 'moodboard' || kind !== 'storyboard' || active === 'moodboard',
  );
}

/**
 * Where each view opens. Film views belong to the project's storyboard, so choosing one from
 * an ordinary board opens that board; without a storyboard they open on the project's root
 * board, so the sidebar and rail always lead to the same place, except Review, which opens the
 * board with a live client review link (`reviewBoardId`) when there is one. `boardId: null`
 * means the board that is already open.
 */
export function viewDestination(
  view: BoardView,
  current: {
    boardId: string | undefined;
    kind: BoardKind | undefined;
    rootBoardId: string | undefined;
  },
  storyboardId: string | null,
  reviewBoardId: string | null = null,
): { boardId: string | null; view: BoardView; kind?: BoardKind } {
  const film = FILM_VIEWS.includes(view);
  if (!film || current.kind === 'storyboard') return { boardId: null, view };
  const target = storyboardId ?? (view === 'review' ? reviewBoardId : null) ?? current.rootBoardId;
  if (!target || target === current.boardId) return { boardId: null, view };
  return { boardId: target, view, kind: storyboardId ? 'storyboard' : 'board' };
}

/** The address of a destination, leaving out `?view=` when it is the target board's default. */
export function viewHref(
  projectId: string,
  destination: { boardId: string | null; view: BoardView; kind?: BoardKind },
  current: { boardId: string; rootBoardId: string | undefined; kind: BoardKind | undefined },
): string {
  const board = destination.boardId ?? current.boardId;
  const kind = destination.boardId ? (destination.kind ?? 'storyboard') : current.kind;
  const path = boardPath(projectId, board, current.rootBoardId);
  return destination.view === defaultView(kind) ? path : `${path}?view=${destination.view}`;
}
