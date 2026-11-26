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
} from '@inkadra/canvas-core';
import { type Element, roots, UNSORTED } from '@inkadra/doc-schema';
import {
  type Board,
  type BoardReviews,
  blockTarget,
  type CommentCounts,
  type ElementReactions,
  type ShareLink,
  type ShareLinkPicks,
} from '@inkadra/shared';
import type * as Y from 'yjs';
import { api } from '../../lib/api.ts';
import { BOARD_CARD_SIZE } from '../BoardCardPreview.tsx';
import { createBoard, refreshBoards } from '../boards.ts';
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
  /**
   * Brings the scenes back to the board, each one only while its copy in the storyboard is as
   * the move left it and holds nothing of the server's. Never deletes nor trashes a board.
   */
  undo: () => Promise<{ back: number; stayed: number; emptyStoryboard: string | null }>;
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
  constructor(readonly emptyStoryboard: string | null) {
    super('The scenes could not be moved');
  }
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
  const held = await serverHolds(boardId, boards);
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
      undo: async () => ({ back: 0, stayed: 0, emptyStoryboard: null }),
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
  try {
    // Read again when writing: a colleague may have changed the board while we asked.
    copied = await writeToBoard(storyboard.id, (there) => {
      const now = planSceneMove(doc, held, only);
      if (now.ids.length === 0) throw new Error('Nothing left to move');
      const board = cardPrints(doc, now.ids);
      const places = placesOf(doc, now.ids);
      copySceneCards(doc, there, now);
      return { plan: now, board, copies: cardPrints(there, now.ids), places };
    });
  } catch {
    // Never deleted nor trashed: a storyboard made for the move stays, for the person to judge.
    throw new SceneMoveError(made ? storyboard.title : null);
  }
  const { plan } = copied;

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

  // Copies of what stayed on the board leave the storyboard again, unless changed there.
  const back = stale.length ? await takeBack(storyboard.id, stale, copied.copies) : null;
  if (out.refused) throw new SceneMoveError(made && back?.empty ? storyboard.title : null);

  let undone = false;
  return {
    plan,
    moved: scenesIn(plan, going),
    changed: scenesIn(plan, stale),
    copiesKept: back?.kept ?? 0,
    storyboard: going.length ? storyboard : null,
    emptyStoryboard: going.length === 0 && made && back?.empty ? storyboard.title : null,
    cardId: going.length ? cardId : null,
    undo: async () => {
      if (undone) return { back: 0, stayed: 0, emptyStoryboard: null };
      undone = true;
      const [there, here] = await Promise.all([
        serverHolds(storyboard.id, boards),
        serverHolds(boardId, boards),
      ]);
      let returned: string[][] = [];
      let empty: string | null = null;
      let watching: RemovalWatch | null = null;
      await writeToBoard(
        storyboard.id,
        (sb) => {
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
          // On the board first; then off the storyboard, watched for a colleague's late change.
          doc.transact(() => {
            if (ids.length) copyCards(sb, doc, ids, (id) => places.get(id) as CardPlace, MOVE);
            const stays = going.length !== returned.length;
            if (newCard && cardId && !stays && !here.has(cardId))
              deleteElements(doc, [cardId], MOVE);
          }, MOVE);
          if (ids.length) {
            watching = watchRemoval(sb, ids, UNDO, (edits, orphans) =>
              late(
                edits,
                orphans,
                sb,
                async (write) => write(doc),
                (orphanIds) => deleteElements(sb, orphanIds, UNDO),
              ),
            );
            deleteElements(sb, ids, UNDO);
          }
          empty = emptyOf(made, storyboard.title, sb);
        },
        { ms: LATE_MS, end: () => (watching as RemovalWatch | null)?.stop() },
      );
      return {
        back: scenesIn(plan, returned),
        stayed: scenesIn(plan, going) - scenesIn(plan, returned),
        emptyStoryboard: empty,
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
): Promise<{ kept: number; empty: boolean }> {
  return writeToBoard(storyboardId, (there) => {
    const same = units.filter((unit) => unitUnchanged(there, unit, prints));
    if (same.length) deleteElements(there, same.flat());
    return { kept: units.length - same.length, empty: roots(there).elements.size === 0 };
  });
}

/**
 * A new scene in a storyboard (decision 0140), numbered after its last one; resolves with its id
 * once the server has it.
 */
export function addSceneTo(storyboardId: string, userId: string): Promise<string> {
  return writeToBoard(storyboardId, (there) => addScene(there, {}, { userId }).id);
}
