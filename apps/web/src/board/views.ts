// SPDX-License-Identifier: AGPL-3.0-only
import {
  type Board,
  type BoardCount,
  type BoardKind,
  type BoardOptionalView,
  OPTIONAL_VIEWS,
  offered,
} from '@inkadra/shared';
import type { IconName } from '@inkadra/ui';
import { boardPath } from './boards.ts';

/** The ways of looking at a board; `?view=` holds every one but the default. */
export type BoardView =
  | 'storyboard'
  | 'shotlist'
  | 'schedule'
  | 'troupe'
  | 'review'
  | 'moodboard'
  | 'canvas';

export const VIEWS: Array<{ view: BoardView; icon: IconName }> = [
  { view: 'storyboard', icon: 'storyboard' },
  { view: 'shotlist', icon: 'shotlist' },
  { view: 'schedule', icon: 'calendar' },
  { view: 'troupe', icon: 'people' },
  { view: 'review', icon: 'people' },
  { view: 'moodboard', icon: 'image' },
  { view: 'canvas', icon: 'board' },
];

/** Reading order of the header, the sidebar and the phone picker. */
export const ALL_VIEWS: readonly BoardView[] = [
  'canvas',
  'storyboard',
  'shotlist',
  'schedule',
  'troupe',
  'review',
  'moodboard',
];

/** The views each kind always has; it opens on the first (decisions 0121 and 0123). */
const ALWAYS: Record<BoardKind, readonly BoardView[]> = {
  board: ['canvas'],
  moodboard: ['moodboard'],
  storyboard: ['storyboard'],
  production: ['schedule', 'troupe'],
};

/**
 * The views a storyboard has only while its project has no Production board (decision 0123):
 * then the Production board holds them. shortcut: the interim of 0121, until step 6 of 0123
 * moves every project and removes them from OPTIONAL_VIEWS.
 */
const INTERIM: readonly BoardOptionalView[] = ['schedule', 'troupe'];

export function isBoardView(value: string | null): value is BoardView {
  return ALL_VIEWS.includes(value as BoardView);
}

/** The icon a view is drawn with in the switcher and the sidebar. */
export function viewIcon(view: BoardView): IconName {
  return VIEWS.find((v) => v.view === view)?.icon ?? 'board';
}

/** The icon of a kind of board, in the sidebar, on its card and before its name. */
export function kindIcon(kind: BoardKind | undefined): IconName {
  return kind === 'storyboard'
    ? 'storyboard'
    : kind === 'moodboard'
      ? 'image'
      : kind === 'production'
        ? 'film'
        : 'board';
}

/** The view a board opens on when the address has no `?view=`. */
export function defaultView(kind: BoardKind | undefined): BoardView {
  return ALWAYS[kind ?? 'board'][0] ?? 'canvas';
}

type ViewsOf = Pick<Board, 'kind' | 'views'>;
/** The project has a Production board: its storyboards lose Schedule and Troupe (0123). */
type Production = boolean | undefined;
type CountsOf = Pick<BoardCount, 'referenceCount' | 'looseCount' | 'clientReview'> | undefined;

/**
 * The optional views that are on. Boards from before decision 0121 store none: a storyboard
 * keeps all of its views, an ordinary board its moodboard when it holds images, links or colours
 * and its review while a guest review link is live.
 */
export function viewsOn(
  board: ViewsOf,
  counts: CountsOf,
  production?: Production,
): BoardOptionalView[] {
  const allowed = OPTIONAL_VIEWS[board.kind].filter((v) => !production || !INTERIM.includes(v));
  if (board.views) return allowed.filter((v) => board.views?.includes(v));
  if (board.kind === 'board')
    return allowed.filter((v) =>
      v === 'moodboard' ? (counts?.referenceCount ?? 0) > 0 : !!counts?.clientReview,
    );
  return [...allowed];
}

/**
 * The optional views "Views of this board" offers to turn on or off: those of the modules that
 * are on (`off`, decision 0121), and any that is on already, so it can be turned off.
 */
export function offeredViews(
  board: ViewsOf,
  counts: CountsOf,
  off: readonly string[],
  production?: Production,
): BoardOptionalView[] {
  const on = viewsOn(board, counts, production);
  return OPTIONAL_VIEWS[board.kind].filter(
    (v) => (!production || !INTERIM.includes(v)) && (on.includes(v) || offered(off, 'views', v)),
  );
}

/** The views of a board, in reading order: the one of its kind, then those turned on. */
export function boardViews(board: ViewsOf, counts: CountsOf, production?: Production): BoardView[] {
  const on: readonly BoardView[] = viewsOn(board, counts, production);
  return ALL_VIEWS.filter((v) => ALWAYS[board.kind].includes(v) || on.includes(v));
}

/**
 * Whether a storyboard still opens its old canvas: it holds cards other than its scenes and
 * frames. A storyboard has no Board view, so that canvas shows only while there is something
 * on it; while the counts are unknown it stays reachable.
 */
export function hasOutsideCards(board: ViewsOf | undefined, counts: CountsOf): boolean {
  return board?.kind === 'storyboard' && (counts?.looseCount ?? 1) > 0;
}

/**
 * The view an address opens: the one it asks for when the board has it, otherwise the board's
 * first. While the board is unknown only a valid asked view is known.
 */
export function openView(
  asked: string | null,
  board: ViewsOf | undefined,
  counts: CountsOf,
  production?: Production,
): BoardView | null {
  if (!board) return isBoardView(asked) ? asked : null;
  if (asked === 'canvas' && hasOutsideCards(board, counts)) return 'canvas';
  const views = boardViews(board, counts, production);
  return isBoardView(asked) && views.includes(asked)
    ? asked
    : (views[0] ?? defaultView(board.kind));
}

/**
 * The views the header, the sidebar and the phone offer for the open board: its own, and the
 * canvas of a storyboard while its cards outside the storyboard are open. Nothing while the
 * board is unknown.
 */
export function headerViews(
  board: ViewsOf | undefined,
  counts: CountsOf,
  active: BoardView | null,
  production?: Production,
): BoardView[] {
  if (!board) return [];
  const views = boardViews(board, counts, production);
  return active === 'canvas' && board.kind === 'storyboard' ? [...views, 'canvas'] : views;
}

/** The name key of a view; on a storyboard the canvas holds only the cards outside it. */
export function viewLabelKey(view: BoardView, kind: BoardKind | undefined): string {
  return view === 'canvas' && kind === 'storyboard' ? 'board.outside.title' : `film.views.${view}`;
}

/** The address of a board's view, leaving out `?view=` when it is the board's default. */
export function viewHref(
  projectId: string,
  board: { id: string; kind: BoardKind | undefined },
  view: BoardView,
  rootBoardId: string | undefined,
): string {
  const path = boardPath(projectId, board.id, rootBoardId);
  return view === defaultView(board.kind) ? path : `${path}?view=${view}`;
}
