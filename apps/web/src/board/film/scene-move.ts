// SPDX-License-Identifier: AGPL-3.0-only
import {
  addScene,
  applyLateEdits,
  type CardPlace,
  cardPrints,
  copyCards,
  copySceneCards,
  createElement,
  deleteElements,
  keyAtEnd,
  type LateEdit,
  listElements,
  placesBack,
  placesOf,
  planSceneMove,
  type RemovalWatch,
  removeSceneCards,
  type SceneMovePlan,
  unitUnchanged,
  watchRemoval,
  withChildren,
} from '@inkadra/canvas-core';
import { type Element, roots, UNSORTED } from '@inkadra/doc-schema';
import {
  type Board,
  type BoardReviews,
  blockTarget,
  type CommentCounts,
  ELEMENT_DATA_MOVE_MAX,
  type ElementDataMoved,
  type ElementReactions,
  type ShareLink,
  type ShareLinkPicks,
} from '@inkadra/shared';
import type * as Y from 'yjs';
import { api, RequestError } from '../../lib/api.ts';
import { BOARD_CARD_SIZE } from '../BoardCardPreview.tsx';
import { createBoard, refreshBoards } from '../boards.ts';
import { elementDataMoves } from './data-moves.ts';
import { loadBoardDays } from './production-days.ts';
import { writeToBoard } from './send-to-storyboard.ts';

/**
 * Scenes live in storyboards (decision 0140): moving the loose scenes of an ordinary board into
 * one, and a new scene made from the canvas menu.
 */

/** The storyboard the Move dialog chooses first: the one opened last, else the first. */
export function defaultStoryboard(
  storyboards: readonly Pick<Board, 'id'>[],
  last: string | null,
): string | null {
  return storyboards.find((b) => b.id === last)?.id ?? storyboards[0]?.id ?? null;
}

/**
 * The name of a new storyboard: the section heading right above the scenes (within 400 px, over
 * them sideways), else `fallback`.
 */
export function storyboardName(
  elements: readonly Element[],
  at: { x: number; y: number },
  fallback: string,
): string {
  const heading = elements
    .filter(
      (e): e is Extract<Element, { type: 'section' }> =>
        e.type === 'section' &&
        e.parent === null &&
        !!e.title.trim() &&
        e.y < at.y &&
        at.y - e.y <= 400 &&
        e.x <= at.x + 200 &&
        e.x + (e.w ?? 0) >= at.x,
    )
    .sort((a, b) => b.y - a.y)[0];
  return (heading?.title.trim() || fallback).slice(0, 200);
}

/**
 * The cards of a board the server keeps something about (decision 0140): comments, reactions,
 * review decisions and guest picks (`server`), and the frames and scenes shooting days point at
 * (`days`). Throws when any of it cannot be read: then nothing moves.
 */
export async function serverHolds(
  boardId: string,
  boards: readonly Board[] | null,
): Promise<Map<string, 'server' | 'days'>> {
  const [counts, reviews, reactions, links, days] = await Promise.all([
    api.get<CommentCounts>(`/boards/${boardId}/comment-counts`),
    api.get<BoardReviews>(`/boards/${boardId}/reviews`),
    api.get<ElementReactions>(`/boards/${boardId}/reactions`),
    api.get<{ items: ShareLink[] }>(`/boards/${boardId}/share-links`),
    loadBoardDays(boardId, boards),
  ]);
  const picks = await Promise.all(
    links.items.map((l) => api.get<ShareLinkPicks>(`/share-links/${l.id}/picks`)),
  );
  const held = new Map<string, 'server' | 'days'>();
  for (const day of days)
    for (const block of day.blocks) {
      const target = blockTarget(block, day.boardId);
      if (target?.boardId === boardId) held.set(target.id, 'days');
    }
  const ids = [
    ...counts.items.filter((c) => c.open + c.resolved > 0).map((c) => c.elementId),
    ...reviews.items.map((r) => r.elementId),
    ...reactions.items.filter((r) => r.reactions.length > 0).map((r) => r.elementId),
    ...picks.flatMap((p) => p.items.map((i) => i.elementId)),
  ];
  for (const id of ids) if (id && !held.has(id)) held.set(id, 'server');
  // Comments on the board itself: no card, but the board is not untouched.
  if (counts.items.some((c) => c.elementId === null && c.open + c.resolved > 0))
    held.set(BOARD_ITSELF, 'server');
  return held;
}

export { elementDataMoves, setElementDataMove } from './data-moves.ts';

/**
 * What keeps scenes on the board: the server's data (`serverHolds`), or nothing while the
 * server moves it along (decision 0140).
 */
export const moveHolds = (
  boardId: string,
  boards: readonly Board[] | null,
): Promise<Map<string, 'server' | 'days'>> =>
  elementDataMoves() ? Promise.resolve(new Map()) : serverHolds(boardId, boards);

/**
 * Moves what the server keeps about these cards (with their frames) to the other board, at most
 * `ELEMENT_DATA_MOVE_MAX` per call. A call moves only what is still on `from`, so asking again (or
 * back) is safe. A failure after the first call is never a refusal: part of it has moved.
 */
const moveData = async (from: string, to: string, ids: readonly string[]) => {
  const total: ElementDataMoved = {
    comments: 0,
    reactions: 0,
    reviews: 0,
    reviewEvents: 0,
    picks: 0,
    notifications: 0,
    shootingDays: 0,
    guestsOutOfReach: [],
  };
  for (let at = 0; at < ids.length; at += ELEMENT_DATA_MOVE_MAX) {
    const moved = await api
      .post<ElementDataMoved>(`/boards/${from}/element-data/move`, {
        toBoardId: to,
        elementIds: ids.slice(at, at + ELEMENT_DATA_MOVE_MAX),
      })
      .catch((error: unknown) => {
        throw at === 0 ? error : new Error('Partly moved', { cause: error });
      });
    for (const key of Object.keys(total) as (keyof ElementDataMoved)[])
      if (key !== 'guestsOutOfReach') total[key] += moved[key];
    total.guestsOutOfReach.push(...(moved.guestsOutOfReach ?? []));
  }
  return total;
};

/**
 * A refusal the server gave on purpose (4xx but 408): the data did not move, so there is
 * nothing to ask back. Anything else (no answer, 408, 5xx) may have moved it.
 */
const refused = (error: unknown) =>
  error instanceof RequestError &&
  error.status >= 400 &&
  error.status < 500 &&
  error.status !== 408;

/** Where comments are after asking them back failed: still `stayed` if refused, else unknown. */
const sideAfter = (error: unknown, stayed: 'here' | 'there'): SceneSplit['comments'] =>
  refused(error) ? stayed : 'unknown';

/** Two splits of one step in one: the comments are on both sides when they differ. */
const joinSplits = (a: SceneSplit | null, b: SceneSplit | null): SceneSplit | null =>
  !a
    ? b
    : !b
      ? a
      : {
          scenes: a.scenes + b.scenes,
          comments: a.comments === b.comments ? a.comments : 'unknown',
        };

/** How many comments, reviews, reactions, picks and shooting days a move took along. */
const dataCount = (moved: ElementDataMoved) =>
  moved.comments + moved.reactions + moved.reviews + moved.picks + moved.shootingDays;

/** The key of `serverHolds` for what is about the board itself, not one of its cards. */
export const BOARD_ITSELF = '#board';

/** Where scenes go: a storyboard of the project, or a new one with this name. */
export type SceneTarget = { id: string; title: string } | { title: string; new: true };

export interface SceneMoveResult {
  /** What was planned; `moved` says what actually went. */
  plan: SceneMovePlan;
  /** The scenes that went to the storyboard. */
  moved: number;
  /**
   * Scenes someone changed on the board while they were copied: they stay on the board. Their
   * copies left the storyboard again, except `copiesKept` that were changed there meanwhile.
   */
  changed: number;
  copiesKept: number;
  /** The storyboard they went to (null when none could move). */
  storyboard: { id: string; title: string } | null;
  /** A storyboard made for the move that ended up empty: it stays, for the person to delete. */
  emptyStoryboard: string | null;
  /** The storyboard's card on the board, new or already there. */
  cardId: string | null;
  /** Comments, reviews, picks and shooting days that went with the scenes. */
  dataMoved: number;
  /** Scenes a failure left apart from their comments, and where those are. */
  split: SceneSplit | null;
  /**
   * Moved scenes with comments, decisions or picks of guests whose link does not reach the
   * storyboard: those guests no longer see them (decision 0141).
   */
  guestsUnreached: number;
  /**
   * Brings the scenes back to the board, each one only while its copy in the storyboard is as
   * the move left it and holds nothing of the server's. Never deletes nor trashes a board.
   */
  undo: () => Promise<{
    back: number;
    stayed: number;
    emptyStoryboard: string | null;
    /** Scenes both here and in the storyboard after a failure, and where the comments are. */
    split: SceneSplit | null;
  }>;
}

/** A colleague's change that arrived while scenes moved, and where it went (decision 0140). */
export interface LateNotice {
  /** Scenes (or their plans and lists) it touched. */
  scenes: number;
  /** Parts of it that could not follow the scenes. */
  lost: number;
}

/** A move that failed; a storyboard made for it stays, empty, for the person to delete. */
export class SceneMoveError extends Error {
  constructor(
    readonly emptyStoryboard: string | null,
    /** Scenes left apart from their comments by the failure, to say where (decision 0141). */
    readonly split: SceneSplit | null = null,
  ) {
    super('The scenes could not be moved');
  }
}

/**
 * Scenes a failure left in both places or apart from their comments, and where the comments
 * are: `here` with the board's copies, `there` with the storyboard's, `unknown` when the server
 * could not say (decision 0141). Never silent: the notice names it.
 */
export interface SceneSplit {
  scenes: number;
  comments: 'here' | 'there' | 'unknown';
}

/** Writes of a move on the board: their own undo, never a step of Ctrl+Z (two documents). */
const MOVE = Symbol('scene-move');
/** The removal in the storyboard when Undo brings scenes back. */
const UNDO = Symbol('scene-move-undo');
/**
 * How long a board is watched after scenes left it, for a colleague's change still on its way:
 * Yjs cannot hold an update in flight, so one that lands later is carried over, not refused.
 * shortcut: a fixed time, not the server's acknowledgement of the removal; a change slower than
 * this is lost as with any card deleted while someone edits it (decision 0140, known limit).
 */
const LATE_MS = 10_000;

/** The scenes among the cards of some units. */
const scenesIn = (plan: SceneMovePlan, units: readonly string[][]) => {
  const ids = new Set(units.flat());
  return plan.scenes.filter((s) => ids.has(s.id)).length;
};

/** The empty storyboard a move made, if it is empty. */
const emptyOf = (made: boolean, title: string, doc: Y.Doc) =>
  made && roots(doc).elements.size === 0 ? title : null;

/**
 * Moves the loose scenes of `doc` (the open board) into a storyboard: the copies first, confirmed
 * by the server, then the board loses them and gets the storyboard's card where they were.
 * Scenes that cannot move without leaving something behind stay (`plan.stay`).
 */
export async function moveScenes(opts: {
  doc: Y.Doc;
  projectId: string;
  boardId: string;
  userId: string;
  boards: readonly Board[] | null;
  target: SceneTarget;
  /** These scenes only (a screenplay import's); all of them when missing. */
  only?: ReadonlySet<string>;
  /** Where the card goes near `at`, clear of the cards that stay (those `leaving` go). */
  spot?: (at: { x: number; y: number }, leaving: ReadonlySet<string>) => { x: number; y: number };
  /** The size of a card on the board, for Undo to find room for it. */
  measure?: (card: Element) => { w: number; h: number };
  /** A colleague's change arrived while scenes moved, or came back, and followed them. */
  onLate?: (notice: LateNotice) => void;
}): Promise<SceneMoveResult> {
  const { doc, projectId, boardId, userId, boards, target, only, spot, onLate } = opts;
  const measure = opts.measure ?? ((card: Element) => ({ w: card.w ?? 240, h: card.h ?? 200 }));
  // One answer for the whole move and its Undo.
  const dataMoves = elementDataMoves();
  const held = await moveHolds(boardId, boards);
  const first = planSceneMove(doc, held, only);
  if (first.ids.length === 0)
    return {
      plan: first,
      moved: 0,
      changed: 0,
      copiesKept: 0,
      storyboard: null,
      emptyStoryboard: null,
      cardId: null,
      dataMoved: 0,
      split: null,
      guestsUnreached: 0,
      undo: async () => ({ back: 0, stayed: 0, emptyStoryboard: null, split: null }),
    };
  const made = 'new' in target;
  const storyboard = made
    ? {
        id: (await createBoard(projectId, boardId, target.title, 'storyboard')).id,
        title: target.title,
      }
    : target;
  if (made) void refreshBoards(projectId);
  // What the board had and what the storyboard got, as copied: nothing goes unless still so.
  let copied: {
    plan: SceneMovePlan;
    board: Map<string, string>;
    copies: Map<string, string>;
    places: Map<string, CardPlace>;
  };
  /** The copies as written, before the server confirmed them. */
  let written = null as { plan: SceneMovePlan; copies: Map<string, string> } | null;
  try {
    // Read again when writing: a colleague may have changed the board while we asked.
    copied = await writeToBoard(storyboard.id, (there) => {
      const now = planSceneMove(doc, held, only);
      if (now.ids.length === 0) throw new Error('Nothing left to move');
      const board = cardPrints(doc, now.ids);
      const places = placesOf(doc, now.ids);
      copySceneCards(doc, there, now);
      const copies = cardPrints(there, now.ids);
      written = { plan: now, copies };
      return { plan: now, board, copies, places };
    });
  } catch {
    // Never deleted nor trashed: a storyboard made for the move stays, for the person to judge.
    if (!written) throw new SceneMoveError(made ? storyboard.title : null);
    // Written but not confirmed: the copies may be in the storyboard. Taken back while still as
    // copied; if the storyboard cannot be read, say they may be there too (comments stay here).
    const { plan: tried, copies } = written;
    const taken = await takeBack(storyboard.id, tried.units, copies).catch(() => null);
    if (!taken) throw new SceneMoveError(null, { scenes: tried.scenes.length, comments: 'here' });
    throw new SceneMoveError(
      made && taken.empty ? storyboard.title : null,
      keptSplit(tried, taken.kept),
    );
  }
  const { plan } = copied;

  // The server's data follows the copies before anything leaves the board; when it cannot, the
  // board keeps the scenes and the copies leave the storyboard again (nothing is ever lost).
  const unitIds = plan.units.map((unit) => withChildren(doc, unit));
  const idsOf = (units: readonly string[][]) => [
    ...new Set([
      ...units.flatMap((unit) => unitIds[plan.units.indexOf(unit)] ?? []),
      ...withChildren(doc, units.flat()),
    ]),
  ];
  let dataMoved = 0;
  let guests = new Set<string>();
  if (dataMoves) {
    try {
      const moved = await moveData(boardId, storyboard.id, unitIds.flat());
      dataMoved = dataCount(moved);
      guests = new Set(moved.guestsOutOfReach ?? []);
    } catch (error) {
      // Refused on purpose: nothing moved. Otherwise a lost answer may have moved it all the
      // same: asked back first. Then the copies go; those that cannot stay, and it is said.
      const back =
        refused(error) ||
        (await moveData(storyboard.id, boardId, unitIds.flat()).then(
          () => true,
          () => false,
        ));
      if (!back)
        throw new SceneMoveError(null, { scenes: plan.scenes.length, comments: 'unknown' });
      const taken = await takeBack(storyboard.id, plan.units, copied.copies).catch(() => null);
      if (!taken) throw new SceneMoveError(null, { scenes: plan.scenes.length, comments: 'here' });
      throw new SceneMoveError(
        made && taken.empty ? storyboard.title : null,
        keptSplit(plan, taken.kept),
      );
    }
  }

  // A colleague's change that reaches the removed cards later follows them to the storyboard.
  const late = (
    edits: LateEdit[],
    orphans: Array<{ id: string; topId: string }>,
    from: Y.Doc,
    to: (write: (doc: Y.Doc) => number) => Promise<number>,
    removeFrom: (ids: string[]) => void,
  ) => {
    const scenes = new Set([...edits, ...orphans].map((e) => e.topId)).size;
    const ids = orphans.map((o) => o.id);
    const places = placesOf(from, ids);
    void to((there) => {
      const ok = ids.filter((id) => there !== from && !roots(there).elements.has(id));
      if (ok.length) copyCards(from, there, ok, (id) => places.get(id) as CardPlace, MOVE);
      return applyLateEdits(there, edits, MOVE) + (ids.length - ok.length);
    })
      .then((lost) => {
        if (ids.length) removeFrom(ids);
        onLate?.({ scenes, lost });
      })
      .catch(() => onLate?.({ scenes, lost: scenes }));
  };

  // On the board, in one transaction: the units still as copied go, the card takes their place.
  const out = {
    going: [] as string[][],
    stale: plan.units,
    refused: false,
    cardId: null as string | null,
    newCard: false,
  };
  const watch = watchRemoval(doc, plan.ids, MOVE, (edits, orphans) =>
    late(
      edits,
      orphans,
      doc,
      (write) => writeToBoard(storyboard.id, write),
      (ids) => deleteElements(doc, ids, MOVE),
    ),
  );
  setTimeout(watch.stop, LATE_MS);
  doc.transact(() => {
    const same = plan.units.filter((unit) => unitUnchanged(doc, unit, copied.board));
    if (same.length === 0) return;
    // The board refused to let them go (a plan's Set, decision 0062): nothing went.
    if (!removeSceneCards(doc, { ids: same.flat() }, MOVE)) {
      out.refused = true;
      return;
    }
    out.going = same;
    out.stale = plan.units.filter((unit) => !same.includes(unit));
    const existing = listElements(doc).find(
      (e) => e.type === 'board' && e.boardId === storyboard.id,
    );
    if (existing) {
      out.cardId = existing.id;
      return;
    }
    const places = same.flat().flatMap((id) => copied.places.get(id) ?? []);
    const origin = places.length
      ? { x: Math.min(...places.map((p) => p.x)), y: Math.min(...places.map((p) => p.y)) }
      : { x: 0, y: 0 };
    const at = spot ? spot(origin, new Set(same.flat())) : origin;
    out.cardId = createElement(
      doc,
      'board',
      at,
      { boardId: storyboard.id, ...BOARD_CARD_SIZE },
      { userId, origin: MOVE },
    ).id;
    out.newCard = true;
  }, MOVE);
  const { going, stale, cardId, newCard } = out;

  // What stayed on the board takes its data back; then its copies leave the storyboard again,
  // unless changed there. Data that cannot come back keeps its copies there, with it.
  let undone = false;
  /** Where the comments of `stale` are when they could not come back (null: they are here). */
  const dataApart =
    !dataMoves || !stale.length
      ? null
      : await moveData(storyboard.id, boardId, idsOf(stale)).then(
          (moved) => {
            dataMoved -= dataCount(moved);
            return null;
          },
          (error: unknown) => sideAfter(error, 'there'),
        );
  // Their comments could not come back: the scenes stay here, their comments with the copies
  // (or, after no answer, on either side).
  let split: SceneSplit | null = dataApart
    ? { scenes: scenesIn(plan, stale), comments: dataApart }
    : null;
  // Copies that cannot leave the storyboard stay there: a duplicate, the comments are here.
  const back = !stale.length
    ? null
    : dataApart
      ? { kept: [] as string[][], empty: false }
      : await takeBack(storyboard.id, stale, copied.copies).catch(() => {
          // Not a copy changed there: the storyboard could not be read, so they may be there too.
          split = { scenes: scenesIn(plan, stale), comments: 'here' };
          return { kept: [] as string[][], empty: false };
        });
  // A comment written on the board while the scenes moved follows them too (best effort).
  if (dataMoves && going.length)
    await moveData(boardId, storyboard.id, idsOf(going)).then(
      (moved) => {
        if (!undone) dataMoved += dataCount(moved);
      },
      () => {},
    );
  if (out.refused)
    throw new SceneMoveError(
      made && back?.empty ? storyboard.title : null,
      joinSplits(split, keptSplit(plan, back?.kept ?? [])),
    );

  return {
    plan,
    moved: scenesIn(plan, going),
    changed: scenesIn(plan, stale),
    copiesKept: scenesIn(plan, back?.kept ?? []),
    storyboard: going.length ? storyboard : null,
    emptyStoryboard: going.length === 0 && made && back?.empty ? storyboard.title : null,
    cardId: going.length ? cardId : null,
    dataMoved: Math.max(0, dataMoved),
    split,
    guestsUnreached: scenesIn(
      plan,
      going.filter((unit) =>
        (unitIds[plan.units.indexOf(unit)] ?? []).some((id) => guests.has(id)),
      ),
    ),
    undo: async () => {
      if (undone) return { back: 0, stayed: 0, emptyStoryboard: null, split: null };
      undone = true;
      const [there, here] = await Promise.all([
        dataMoves ? new Map<string, 'server' | 'days'>() : serverHolds(storyboard.id, boards),
        serverHolds(boardId, boards),
      ]);
      let returned: string[][] = [];
      /** The copies put back on the board, as put there (before the storyboard confirmed). */
      let brought: Map<string, string> | null = null;
      let split: SceneSplit | null = null;
      let empty: string | null = null;
      let watching: RemovalWatch | null = null;
      const linger = { ms: LATE_MS, end: () => (watching as RemovalWatch | null)?.stop() };
      /** The board's card goes when every scene came back, unless the server keeps something. */
      const dropCard = (all: boolean) => {
        if (newCard && cardId && all && !here.has(cardId)) deleteElements(doc, [cardId], MOVE);
      };
      /** Copies onto the board the units still as the move left them, where they were. */
      const bringBack = (sb: Y.Doc, withCard: boolean) => {
        const board = roots(doc).elements;
        returned = going.filter((unit) => {
          const inside = [...roots(sb).elements.entries()]
            .filter(([, m]) => unit.includes(m.get('parent') as string))
            .map(([id]) => id);
          return (
            unit.every((id) => !there.has(id)) &&
            inside.every((id) => !there.has(id)) &&
            unitUnchanged(sb, unit, copied.copies) &&
            [...unit, ...inside].every((id) => !board.has(id))
          );
        });
        // Where they were, unless something covers that place now: then all together nearby.
        const now = listElements(doc);
        const ids = returned.flat();
        const places = placesBack(
          listElements(sb)
            .filter((e) => ids.includes(e.id))
            .flatMap((e) => {
              const place = copied.places.get(e.id);
              return place ? [{ id: e.id, place, ...measure({ ...e, ...place }) }] : [];
            }),
          now
            .filter((e) => e.parent === null && e.type !== 'arrow' && e.id !== cardId)
            .map((e) => ({ x: e.x, y: e.y, ...measure(e) })),
          new Set([...now.map((e) => e.id), UNSORTED]),
          keyAtEnd(now, null),
        );
        doc.transact(() => {
          if (ids.length) copyCards(sb, doc, ids, (id) => places.get(id) as CardPlace, MOVE);
          if (withCard) dropCard(going.length === returned.length);
        }, MOVE);
        brought = cardPrints(doc, ids);
      };
      /** Off the storyboard, watched for a colleague's late change; false when refused. */
      const takeOff = (sb: Y.Doc, units: readonly string[][]) => {
        const ids = units.flat();
        let done = true;
        if (ids.length) {
          const watch = watchRemoval(sb, ids, UNDO, (edits, orphans) =>
            late(
              edits,
              orphans,
              sb,
              async (write) => write(doc),
              (orphanIds) => deleteElements(sb, orphanIds, UNDO),
            ),
          );
          done = deleteElements(sb, ids, UNDO).length === 0;
          if (done) watching = watch;
          else watch.stop();
        }
        empty = emptyOf(made, storyboard.title, sb);
        return done;
      };
      if (!dataMoves) {
        await writeToBoard(
          storyboard.id,
          (sb) => {
            bringBack(sb, true);
            takeOff(sb, returned);
          },
          linger,
        );
      } else {
        // On the board first, then the server's data comes back with them, then the copies
        // leave the storyboard: a failure on the way leaves the scenes in the storyboard. A copy
        // changed there meanwhile keeps the scene, and its data, in the storyboard. A board copy
        // goes again only while as it was put there: one a colleague changed stays, and the
        // notice says its comments are in the storyboard.
        const apart = (units: readonly string[][], comments: SceneSplit['comments']) => {
          if (units.length) split = joinSplits(split, { scenes: scenesIn(plan, units), comments });
        };
        /** The board copies go again while as put there; the others stay, said apart. */
        const dropCopies = (units: readonly string[][]) => {
          const put = brought as Map<string, string> | null;
          // A copy a colleague deleted on the board meanwhile is not here any more.
          const board = roots(doc).elements;
          const present = units.filter((unit) => unit.some((id) => board.has(id)));
          if (!present.length || !put) return;
          const ours = present.filter((unit) => unitUnchanged(doc, unit, put));
          const left = ours.length && deleteElements(doc, ours.flat(), MOVE).length > 0 ? ours : [];
          apart(
            present.filter((unit) => !ours.includes(unit) || left.includes(unit)),
            'there',
          );
        };
        /** Stops with what is said so far: the scenes stay in the storyboard. */
        const fail = (more: SceneSplit | null = null) =>
          new SceneMoveError(null, joinSplits(split, more));
        try {
          await writeToBoard(storyboard.id, (sb) => bringBack(sb, false));
        } catch {
          dropCopies(returned);
          throw fail();
        }
        const unchanged = (sb: Y.Doc) =>
          returned.filter((unit) => unitUnchanged(sb, unit, copied.copies));
        let ready = returned;
        if (returned.length) {
          // Checked again right before the data moves.
          try {
            ready = await writeToBoard(storyboard.id, unchanged);
          } catch {
            dropCopies(returned);
            throw fail();
          }
          dropCopies(returned.filter((unit) => !ready.includes(unit)));
        }
        /**
         * Sends the data of these units back to the storyboard, then their board copies go.
         * Resolves with null, or where the comments are when it failed.
         */
        const sendBack = (units: readonly string[][]) =>
          moveData(boardId, storyboard.id, idsOf(units)).then(
            () => {
              dropCopies(units);
              return null;
            },
            (error: unknown) => sideAfter(error, 'here'),
          );
        if (ready.length) {
          try {
            await moveData(storyboard.id, boardId, idsOf(ready));
          } catch (error) {
            // Refused on purpose: nothing moved, the copies go. Otherwise a lost answer may have
            // moved it all the same: asked back, then the copies go.
            if (refused(error)) {
              dropCopies(ready);
              throw fail();
            }
            if (!(await sendBack(ready))) throw fail();
            throw fail({ scenes: scenesIn(plan, ready), comments: 'unknown' });
          }
        }
        let late: string[][] = [];
        if (ready.length) {
          let gone: string[][] = [];
          try {
            await writeToBoard(
              storyboard.id,
              (sb) => {
                const same = unchanged(sb).filter((unit) => ready.includes(unit));
                // The storyboard may refuse to let them go (a plan's Set): then nothing went.
                gone = takeOff(sb, same) ? same : [];
                late = ready.filter((unit) => !gone.includes(unit));
              },
              linger,
            );
          } catch {
            // Not confirmed: what is still in the storyboard gets its data back there and its
            // board copy goes; what left it is back here. If the storyboard cannot be read, or
            // the data cannot go back, both copies stay, the comments with the board's: said.
            // Read from the storyboard as the server has it: whether it is empty, too.
            empty = null;
            const read = await writeToBoard(storyboard.id, (sb) => ({
              still: ready.filter((unit) => unit.some((id) => roots(sb).elements.has(id))),
              empty: emptyOf(made, storyboard.title, sb),
            })).catch(() => null);
            if (!read) throw fail({ scenes: scenesIn(plan, ready), comments: 'here' });
            const { still } = read;
            empty = read.empty;
            const side = still.length ? await sendBack(still) : null;
            if (side) throw fail({ scenes: scenesIn(plan, still), comments: side });
            gone = ready.filter((unit) => !still.includes(unit));
            late = [];
            if (!gone.length) throw fail();
            ready = gone;
          }
        }
        // Changed in the storyboard while its data came back, or refused there: the data goes
        // there again, then the copy leaves the board. Otherwise both copies stay, the comments
        // with the board's.
        returned = ready.filter((unit) => !late.includes(unit));
        const side = late.length ? await sendBack(late) : null;
        if (side) {
          apart(late, side);
          returned = ready;
        }
        // The storyboard's card leaves the board only once all its scenes are confirmed back,
        // and no copy of them stays on the board apart from its comments.
        doc.transact(() => dropCard(!split && returned.length === going.length), MOVE);
      }
      return {
        back: scenesIn(plan, returned),
        stayed: scenesIn(plan, going) - scenesIn(plan, returned),
        emptyStoryboard: empty,
        split,
      };
    },
  };
}

/**
 * Removes copies from the storyboard, each unit only while it is as copied. Resolves with how
 * many copies were changed there meanwhile and stay, and whether the storyboard is empty now.
 */
async function takeBack(
  storyboardId: string,
  units: readonly string[][],
  prints: ReadonlyMap<string, string>,
): Promise<{ kept: string[][]; empty: boolean }> {
  return writeToBoard(storyboardId, (there) => {
    const elements = roots(there).elements;
    // Only what is there: a copy never written is not a copy kept.
    const present = units.filter((unit) => unit.some((id) => elements.has(id)));
    const same = present.filter((unit) => unitUnchanged(there, unit, prints));
    // The storyboard may refuse to let them go (a plan's Set, 0062): then nothing went.
    const refusedAll = same.length > 0 && deleteElements(there, same.flat()).length > 0;
    const kept = present.filter((unit) => refusedAll || !same.includes(unit));
    return { kept, empty: elements.size === 0 };
  });
}

/** Copies kept in the storyboard while the scenes stay here, with their comments. */
const keptSplit = (plan: SceneMovePlan, kept: readonly string[][]): SceneSplit | null =>
  kept.length ? { scenes: scenesIn(plan, kept), comments: 'here' } : null;

/**
 * A new scene in a storyboard (decision 0140), numbered after its last one; resolves with its id
 * once the server has it.
 */
export function addSceneTo(storyboardId: string, userId: string): Promise<string> {
  return writeToBoard(storyboardId, (there) => addScene(there, {}, { userId }).id);
}
