// SPDX-License-Identifier: AGPL-3.0-only
import { addScene, currentElements } from '@inkadra/canvas-core';
import { createBoardDoc, type Element } from '@inkadra/doc-schema';
import { describe, expect, it } from 'vitest';
import { BoardStore, LOCAL } from '../store.ts';
import { addScenePlan, lensMillimetres, plansOfScene, scenesOfPlan } from './scenes.tsx';

const base = { x: 0, y: 0, w: 100, z: 'a0', parent: null, createdBy: null };
const scene = (id: string, number: string) =>
  ({ ...base, id, type: 'scene', number, title: '', createdAt: 0 }) as Element;
const plan = (id: string, sceneIds: string[], createdAt: number) =>
  ({ ...base, id, type: 'plan', sceneIds, createdAt }) as Element;

describe('plans and scenes', () => {
  const elements = [
    scene('scene005', '5'),
    scene('scene007', '7'),
    plan('planSera', ['scene007'], 2),
    plan('planGiorno', ['scene005', 'scene007', 'deleted1'], 1),
  ];
  const byId = new Map(elements.map((e) => [e.id, e]));

  it('lists the plans of a scene, oldest first', () => {
    expect(plansOfScene(elements, 'scene007').map((p) => p.id)).toEqual(['planGiorno', 'planSera']);
    expect(plansOfScene(elements, 'scene005').map((p) => p.id)).toEqual(['planGiorno']);
  });

  it('makes a new set plan for a scene, linked to it like one made on the canvas', () => {
    const doc = createBoardDoc('0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10');
    const store = new BoardStore(doc);
    const five = addScene(doc, { number: '5' }, { userId: 'u1', origin: LOCAL });
    const id = addScenePlan(store, five, 'u1');
    const made = currentElements(doc).find((e) => e.id === id);
    expect(made).toMatchObject({ type: 'plan', sceneIds: [five.id], createdBy: 'u1' });
    expect(plansOfScene(currentElements(doc), five.id).map((p) => p.id)).toEqual([id]);
    // One step of undo takes it away.
    store.undo.undo();
    expect(currentElements(doc).some((e) => e.id === id)).toBe(false);
  });

  it('keeps the scenes of a plan that still exist, in its order', () => {
    const giorno = byId.get('planGiorno') as Extract<Element, { type: 'plan' }>;
    expect(scenesOfPlan(giorno, byId).map((s) => s.number)).toEqual(['5', '7']);
  });
});

it('reads the focal length of a frame, and nothing else', () => {
  expect(lensMillimetres('35mm')).toBe(35);
  expect(lensMillimetres(' 85 mm ')).toBe(85);
  expect(lensMillimetres('50')).toBe(50);
  expect(lensMillimetres('24-70mm')).toBeNull();
  expect(lensMillimetres('Cooke S4')).toBeNull();
  expect(lensMillimetres(undefined)).toBeNull();
});
