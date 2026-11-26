// SPDX-License-Identifier: MPL-2.0
import { createBoardDoc, roots } from '@inkadra/doc-schema';
import { describe, expect, it } from 'vitest';
import { createElement, listElements, updateElement } from './board.ts';
import { addFrame, addScene, addStroke, storyboardOf } from './film.ts';
import {
  type CardPlace,
  cardPrints,
  copyCards,
  copySceneCards,
  placesOf,
  planSceneMove,
  removeSceneCards,
  sceneMoveOrigin,
  unitUnchanged,
} from './scene-move.ts';

const opts = { userId: 'u1' };
const boardId = '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10';
const storyboardId = '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a11';
const none = new Map<string, 'server' | 'days'>();

function board() {
  const doc = createBoardDoc(boardId);
  const one = addScene(doc, { number: '1', title: 'Station' }, opts, { x: 100, y: 50 });
  const two = addScene(doc, { number: '2', title: 'Diner' }, opts, { x: 400, y: 50 });
  const a = addFrame(doc, one.id, null, { action: 'Train arrives' }, opts);
  addFrame(doc, one.id, null, {}, opts);
  const b = addFrame(doc, two.id, null, {}, opts);
  return { doc, one, two, a, b };
}

describe('planSceneMove', () => {
  it('moves every scene with its frames, plans and lists when nothing holds them', () => {
    const { doc, one, two } = board();
    const list = createElement(doc, 'todo', { x: 0, y: 0 }, { items: [], sceneId: one.id }, opts);
    const plan = createElement(doc, 'plan', { x: 0, y: 0 }, { sceneIds: [two.id] }, opts);
    const note = createElement(doc, 'note', { x: 0, y: 0 }, {}, opts);
    const moving = planSceneMove(doc, none);
    expect(moving.scenes.map((s) => s.id)).toEqual([one.id, two.id]);
    expect(moving.frames).toBe(3);
    expect(new Set(moving.ids)).toEqual(new Set([one.id, two.id, list.id, plan.id]));
    expect(moving.ids).not.toContain(note.id);
    expect(moving.stay).toEqual([]);
  });

  it('keeps a scene whose frame has comments, and says why', () => {
    const { doc, one, two, a } = board();
    const moving = planSceneMove(doc, new Map([[a.id, 'server']]));
    expect(moving.scenes.map((s) => s.id)).toEqual([two.id]);
    expect(moving.stay).toEqual([
      { scene: expect.objectContaining({ id: one.id }), reason: 'server' },
    ]);
  });

  it('moves only the scenes asked for, keeping a plan shared with another one', () => {
    const { doc, one, two } = board();
    expect(planSceneMove(doc, none, new Set([two.id])).scenes.map((s) => s.id)).toEqual([two.id]);
    createElement(doc, 'plan', { x: 0, y: 0 }, { sceneIds: [one.id, two.id] }, opts);
    const only = planSceneMove(doc, none, new Set([two.id]));
    expect(only.scenes).toEqual([]);
    expect(only.stay).toEqual([
      { scene: expect.objectContaining({ id: two.id }), reason: 'links' },
    ]);
  });

  it('keeps a scene holding a card this build does not fully understand', () => {
    const { doc, one, a } = board();
    roots(doc).elements.get(a.id)?.set('futureField', 'from a newer schema');
    expect(planSceneMove(doc, none).stay).toEqual([
      { scene: expect.objectContaining({ id: one.id }), reason: 'foreign' },
    ]);
  });

  it('keeps together the scenes one plan links, and a scene tied by an arrow', () => {
    const { doc, one, two, b } = board();
    createElement(doc, 'plan', { x: 0, y: 0 }, { sceneIds: [one.id, two.id] }, opts);
    const free = planSceneMove(doc, none);
    expect(free.scenes).toHaveLength(2);
    // A shooting day on the second scene keeps the first too: their plan cannot be split.
    const held = planSceneMove(doc, new Map([[two.id, 'days']]));
    expect(held.scenes).toEqual([]);
    expect(held.stay.map((s) => s.reason)).toEqual(['days', 'days']);

    const other = board();
    const note = createElement(other.doc, 'note', { x: 0, y: 0 }, {}, opts);
    createElement(
      other.doc,
      'arrow',
      { x: 0, y: 0 },
      { from: { elementId: note.id, x: 0, y: 0 }, to: { elementId: other.b.id, x: 0, y: 0 } },
      opts,
    );
    void b;
    const tied = planSceneMove(other.doc, none);
    expect(tied.scenes.map((s) => s.id)).toEqual([other.one.id]);
    expect(tied.stay).toEqual([
      { scene: expect.objectContaining({ id: other.two.id }), reason: 'links' },
    ]);
  });
});

describe('copySceneCards and removeSceneCards', () => {
  it('moves the cards as stored, after the scenes of the storyboard, nothing lost', () => {
    const { doc, one, two, a } = board();
    addStroke(doc, a.id, { tool: 'pencil', color: '#EDEDED', width: 4, points: [0, 0, 10, 10] });
    const target = createBoardDoc(storyboardId);
    const before = addScene(target, { number: '12', title: 'Earlier' }, opts);
    const moving = planSceneMove(doc, none);
    const origin = sceneMoveOrigin(listElements(doc), moving);
    copySceneCards(doc, target, moving);
    const groups = storyboardOf(listElements(target));
    expect(groups.map((g) => g.scene?.id)).toEqual([before.id, one.id, two.id]);
    expect(groups[1]?.scene?.number).toBe('1');
    expect(groups[1]?.frames.map((f) => f.id)[0]).toBe(a.id);
    expect(groups[1]?.frames[0]?.strokes).toHaveLength(1);
    expect(groups[1]?.frames[0]?.createdBy).toBe('u1');
    expect(origin).toEqual({ x: 100, y: 50 });

    expect(removeSceneCards(doc, moving)).toBe(true);
    expect(listElements(doc).filter((e) => e.type === 'scene' || e.type === 'frame')).toEqual([]);
  });

  it('writes nothing when a card is already there', () => {
    const { doc } = board();
    const target = createBoardDoc(storyboardId);
    const moving = planSceneMove(doc, none);
    copySceneCards(doc, target, moving);
    const count = roots(target).elements.size;
    expect(() => copySceneCards(doc, target, moving)).toThrow();
    expect(roots(target).elements.size).toBe(count);
  });
});

describe('prints of a move (decision 0140)', () => {
  it('changes when a card or anything inside it changes, is added or goes', () => {
    const { doc, one, two, a } = board();
    const moving = planSceneMove(doc, none);
    expect(moving.units).toEqual([[one.id], [two.id]]);
    const prints = cardPrints(doc, moving.ids);
    expect(unitUnchanged(doc, [one.id], prints)).toBe(true);
    updateElement(doc, a.id, { action: 'Train leaves' });
    expect(unitUnchanged(doc, [one.id], prints)).toBe(false);
    expect(unitUnchanged(doc, [two.id], prints)).toBe(true);
    addFrame(doc, two.id, null, {}, opts);
    expect(unitUnchanged(doc, [two.id], prints)).toBe(false);
  });

  it('puts cards back where they were, with their children', () => {
    const { doc, one, a } = board();
    const target = createBoardDoc(storyboardId);
    const moving = planSceneMove(doc, none);
    const places = placesOf(doc, moving.ids);
    copySceneCards(doc, target, moving);
    removeSceneCards(doc, moving);
    copyCards(target, doc, [one.id], (id) => places.get(id) as CardPlace);
    const back = listElements(doc);
    expect(back.find((e) => e.id === one.id)).toMatchObject(places.get(one.id) ?? {});
    expect(back.find((e) => e.id === a.id)?.parent).toBe(one.id);
    expect(() => copyCards(target, doc, [one.id], (id) => places.get(id) as CardPlace)).toThrow();
  });
});
