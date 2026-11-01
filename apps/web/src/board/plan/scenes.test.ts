// SPDX-License-Identifier: AGPL-3.0-only
import type { Element } from '@inkadra/doc-schema';
import { describe, expect, it } from 'vitest';
import { plansOfScene, scenesOfPlan } from './scenes.tsx';

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

  it('keeps the scenes of a plan that still exist, in its order', () => {
    const giorno = byId.get('planGiorno') as Extract<Element, { type: 'plan' }>;
    expect(scenesOfPlan(giorno, byId).map((s) => s.number)).toEqual(['5', '7']);
  });
});
