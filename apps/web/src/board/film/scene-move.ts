// SPDX-License-Identifier: AGPL-3.0-only
import {
  addScene,
  type CardPlace,
  cardPrints,
  copyCards,
  copySceneCards,
  createElement,
  deleteElements,
  listElements,
  placesOf,
  planSceneMove,
  removeSceneCards,
  type SceneMovePlan,
  unitUnchanged,
} from '@inkadra/canvas-core';
import { type Element, roots } from '@inkadra/doc-schema';
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
  /** The storyboard's card on the board, new or already there. */
  cardId: string | null;
  /**
   * Brings the scenes back to the board, each one only while its copy in the storyboard is as
   * the move left it and holds nothing of the server's; resolves with how many stayed there.
   */
  undo: () => Promise<{ back: number; stayed: number }>;
}

/** Writes of a move on the board: their own undo, never a step of Ctrl+Z (two documents). */
const MOVE = Symbol('scene-move');

/** The scenes among the cards of some units. */
const scenesIn = (plan: SceneMovePlan, units: readonly string[][]) => {
  const ids = new Set(units.flat());
  return plan.scenes.filter((s) => ids.has(s.id)).length;
};

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
}): Promise<SceneMoveResult> {
  const { doc, projectId, boardId, userId, boards, target, only, spot } = opts;
  const held = await serverHolds(boardId, boards);
  const first = planSceneMove(doc, held, only);
  const nothing = {
    moved: 0,
    changed: 0,
    copiesKept: 0,
    storyboard: null,
    cardId: null,
    undo: async () => ({ back: 0, stayed: 0 }),
  };
  if (first.ids.length === 0) return { plan: first, ...nothing };
  const made = 'new' in target;
  const storyboard = made
    ? {
        id: (await createBoard(projectId, boardId, target.title, 'storyboard')).id,
        title: target.title,
      }
    : target;
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
  } catch (error) {
    // A storyboard made for the move goes to the trash (it can be restored from there).
    if (made) await api.delete(`/boards/${storyboard.id}`).catch(() => {});
    throw error;
  }
  const { plan } = copied;

  // On the board, in one transaction: the units still as copied go, the card takes their place.
  const out = {
    going: [] as string[][],
    stale: plan.units,
    refused: false,
    cardId: null as string | null,
    newCard: false,
  };
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
  const copiesKept = stale.length
    ? await takeBack(storyboard.id, stale, copied.copies, made && going.length === 0)
    : 0;
  if (made) void refreshBoards(projectId);
  if (out.refused) throw new Error('The board kept the scenes');

  let undone = false;
  return {
    plan,
    moved: scenesIn(plan, going),
    changed: scenesIn(plan, stale),
    copiesKept,
    storyboard: going.length ? storyboard : null,
    cardId: going.length ? cardId : null,
    undo: async () => {
      if (undone) return { back: 0, stayed: 0 };
      undone = true;
      const [there, here] = await Promise.all([
        serverHolds(storyboard.id, boards),
        serverHolds(boardId, boards),
      ]);
      let back: string[][] = [];
      let left = 0;
      await writeToBoard(storyboard.id, (sb) => {
        const board = roots(doc).elements;
        back = going.filter((unit) => {
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
        // On the board first, as they were; then off the storyboard.
        doc.transact(() => {
          for (const unit of back)
            copyCards(sb, doc, unit, (id) => copied.places.get(id) as CardPlace, MOVE);
          const stays = going.length !== back.length;
          if (newCard && cardId && !stays && !here.has(cardId)) deleteElements(doc, [cardId], MOVE);
        }, MOVE);
        if (back.length) deleteElements(sb, back.flat());
        left = roots(sb).elements.size;
      });
      // A storyboard made for the move and left untouched goes to the trash, never further.
      if (made && back.length === going.length && left === 0 && there.size === 0)
        await api.delete(`/boards/${storyboard.id}`).catch(() => {});
      if (made) void refreshBoards(projectId);
      return { back: scenesIn(plan, back), stayed: scenesIn(plan, going) - scenesIn(plan, back) };
    },
  };
}

/**
 * Removes copies from the storyboard, each unit only while it is as copied; with `trash`, a
 * storyboard made for the move and left empty goes to the trash. Resolves with how many copies
 * were changed there meanwhile and stay.
 */
async function takeBack(
  storyboardId: string,
  units: readonly string[][],
  prints: ReadonlyMap<string, string>,
  trash: boolean,
): Promise<number> {
  let kept = 0;
  let left = 1;
  await writeToBoard(storyboardId, (there) => {
    const same = units.filter((unit) => unitUnchanged(there, unit, prints));
    kept = units.length - same.length;
    if (same.length) deleteElements(there, same.flat());
    left = roots(there).elements.size;
  });
  if (trash && kept === 0 && left === 0)
    await api.delete(`/boards/${storyboardId}`).catch(() => {});
  return kept;
}

/**
 * A new scene in a storyboard (decision 0140), numbered after its last one; resolves with its id
 * once the server has it.
 */
export function addSceneTo(storyboardId: string, userId: string): Promise<string> {
  return writeToBoard(storyboardId, (there) => addScene(there, {}, { userId }).id);
}
