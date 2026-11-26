// SPDX-License-Identifier: MPL-2.0
import { createBoardDoc, roots } from '@inkadra/doc-schema';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { listElements, updateElement } from './board.ts';
import { addFrame, addScene, addStroke } from './film.ts';
import { applyLateEdits, type LateEdit, watchRemoval } from './late-edits.ts';
import { copySceneCards, planSceneMove, removeSceneCards } from './scene-move.ts';

const opts = { userId: 'u1' };
const MOVE = Symbol('move');
const sync = (from: Y.Doc, to: Y.Doc) =>
  Y.applyUpdate(to, Y.encodeStateAsUpdate(from, Y.encodeStateVector(to)));

/** Two people on one board: `mine` moves the scenes, `theirs` edits them at the same time. */
function boards() {
  const mine = createBoardDoc('0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10');
  const scene = addScene(mine, { number: '1', title: 'Station' }, opts);
  const frame = addFrame(mine, scene.id, null, { action: 'Train arrives' }, opts);
  const theirs = new Y.Doc();
  sync(mine, theirs);
  return { mine, theirs, scene, frame };
}

describe('late edits of moved cards (decision 0140)', () => {
  it('reads what a colleague wrote into a card already removed, and carries it over', () => {
    const { mine, theirs, scene, frame } = boards();
    const target = createBoardDoc('0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a11');
    const plan = planSceneMove(mine, new Map());
    copySceneCards(mine, target, plan);
    const late: LateEdit[] = [];
    const orphans: string[] = [];
    const watch = watchRemoval(mine, plan.ids, MOVE, (edits, more) => {
      late.push(...edits);
      orphans.push(...more.map((o) => o.id));
    });
    removeSceneCards(mine, plan, MOVE);
    // Meanwhile, before seeing the removal: a new action, a stroke, a new frame in the scene.
    updateElement(theirs, frame.id, { action: 'Train leaves', x: 999 });
    addStroke(theirs, frame.id, {
      tool: 'pencil',
      color: '#EDEDED',
      width: 4,
      points: [0, 0, 9, 9],
    });
    const added = addFrame(theirs, scene.id, null, { action: 'Added meanwhile' }, opts);
    updateElement(theirs, scene.id, { title: 'Central station' });
    sync(theirs, mine);
    watch.stop();

    expect(late.find((e) => e.cardId === frame.id)?.fields).toEqual({ action: 'Train leaves' });
    expect(late.find((e) => e.cardId === frame.id)?.appended.strokes).toHaveLength(1);
    expect(late.find((e) => e.cardId === scene.id)?.fields).toEqual({ title: 'Central station' });
    expect(new Set(late.map((e) => e.topId))).toEqual(new Set([scene.id]));
    expect(orphans).toEqual([added.id]);

    expect(applyLateEdits(target, late)).toBe(0);
    const there = listElements(target);
    expect(there.find((e) => e.id === frame.id)).toMatchObject({ action: 'Train leaves' });
    expect((there.find((e) => e.id === frame.id) as { strokes?: unknown[] }).strokes).toHaveLength(
      1,
    );
    expect(there.find((e) => e.id === scene.id)).toMatchObject({ title: 'Central station' });
  });

  it('says nothing about its own removal or edits of cards that stay', () => {
    const { mine, theirs } = boards();
    const other = addScene(theirs, { number: '2', title: 'Diner' }, opts);
    const plan = planSceneMove(mine, new Map());
    let calls = 0;
    const watch = watchRemoval(mine, plan.ids, MOVE, () => {
      calls += 1;
    });
    removeSceneCards(mine, plan, MOVE);
    sync(theirs, mine);
    updateElement(theirs, other.id, { title: 'Diner at night' });
    sync(theirs, mine);
    watch.stop();
    expect(calls).toBe(0);
  });

  it('counts what cannot be carried over', () => {
    const target = createBoardDoc('0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a11');
    expect(
      applyLateEdits(target, [
        {
          cardId: 'missingcard01',
          topId: 'missingcard01',
          fields: { a: 1 },
          appended: {},
          lost: false,
        },
      ]),
    ).toBe(1);
    expect(roots(target).elements.size).toBe(0);
  });
});
