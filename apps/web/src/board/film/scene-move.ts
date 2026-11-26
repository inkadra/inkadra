// SPDX-License-Identifier: AGPL-3.0-only
import {
  addScene,
  copySceneCards,
  createElement,
  deleteElements,
  listElements,
  planSceneMove,
  removeSceneCards,
  type SceneMovePlan,
  sceneMoveOrigin,
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
import * as Y from 'yjs';
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
  return held;
}

/** Where scenes go: a storyboard of the project, or a new one with this name. */
export type SceneTarget = { id: string; title: string } | { title: string; new: true };

export interface SceneMoveResult {
  plan: SceneMovePlan;
  /** The storyboard they went to (null when none could move). */
  storyboard: { id: string; title: string } | null;
  /** The storyboard's card on the board, new or already there. */
  cardId: string | null;
  /** Puts everything back as it was; rejects when the copies can no longer go. */
  undo: () => Promise<void>;
}

/** Writes of a move on the board: their own undo, never a step of Ctrl+Z (two documents). */
const MOVE = Symbol('scene-move');
/** How long Undo of a move stays possible: well past the notice that offers it. */
const UNDO_KEEP_MS = 10 * 60_000;

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
  const nothing = { storyboard: null, cardId: null, undo: async () => {} };
  if (first.ids.length === 0) return { plan: first, ...nothing };
  const storyboard =
    'new' in target
      ? {
          id: (await createBoard(projectId, boardId, target.title, 'storyboard')).id,
          title: target.title,
        }
      : target;
  let plan = first;
  try {
    // Read again when writing: a colleague may have changed the board while we asked.
    plan = await writeToBoard(storyboard.id, (there) => {
      const now = planSceneMove(doc, held, only);
      if (now.ids.length === 0) throw new Error('Nothing left to move');
      copySceneCards(doc, there, now);
      return now;
    });
  } catch (error) {
    // A storyboard made for the move and left empty goes back to the trash.
    if ('new' in target) await api.delete(`/boards/${storyboard.id}`).catch(() => {});
    throw error;
  }

  const elements = listElements(doc);
  const origin = sceneMoveOrigin(elements, plan) ?? { x: 0, y: 0 };
  const at = spot ? spot(origin, new Set(plan.ids)) : origin;
  const existing = elements.find((e) => e.type === 'board' && e.boardId === storyboard.id);
  const history = new Y.UndoManager(roots(doc).elements, { trackedOrigins: new Set([MOVE]) });
  let cardId = existing?.id ?? null;
  let removed = false;
  doc.transact(() => {
    removed = removeSceneCards(doc, plan, MOVE);
    if (removed && !existing)
      cardId = createElement(
        doc,
        'board',
        at,
        { boardId: storyboard.id, ...BOARD_CARD_SIZE },
        { userId, origin: MOVE },
      ).id;
  }, MOVE);
  history.stopCapturing();
  if (!removed) {
    // The board refused to let them go (a plan's Set, decision 0062): take the copies back.
    history.destroy();
    await takeBack(storyboard.id, plan, 'new' in target);
    throw new Error('The board kept the scenes');
  }
  if ('new' in target) void refreshBoards(projectId);
  // The removed cards are kept for Undo while the notice can offer it, then let go.
  let live = true;
  const expire = setTimeout(() => {
    live = false;
    history.destroy();
  }, UNDO_KEEP_MS);
  return {
    plan,
    storyboard,
    cardId,
    undo: async () => {
      if (!live) throw new Error('Too late to undo');
      // Back on the board first, so nothing is ever only in the storyboard's trash.
      const there = await serverHolds(storyboard.id, boards);
      if (plan.ids.some((id) => there.has(id))) throw new Error('Held in the storyboard');
      live = false;
      clearTimeout(expire);
      history.undo();
      history.destroy();
      const { elements: back } = roots(doc);
      if (!plan.ids.every((id) => back.has(id))) throw new Error('Not back on the board');
      await takeBack(storyboard.id, plan, 'new' in target);
      if ('new' in target) void refreshBoards(projectId);
    },
  };
}

/** Removes the copies from the storyboard, or the whole storyboard when it was made for them. */
async function takeBack(storyboardId: string, plan: SceneMovePlan, made: boolean) {
  if (made) {
    await api.delete(`/boards/${storyboardId}`);
    return;
  }
  await writeToBoard(storyboardId, (there) => {
    deleteElements(there, plan.ids);
  });
}

/**
 * A new scene in a storyboard (decision 0140), numbered after its last one; resolves with its id
 * once the server has it.
 */
export function addSceneTo(storyboardId: string, userId: string): Promise<string> {
  return writeToBoard(storyboardId, (there) => addScene(there, {}, { userId }).id);
}
