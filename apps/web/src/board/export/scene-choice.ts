// SPDX-License-Identifier: AGPL-3.0-only
/** What the scene sheets print (decision 0083): kept light, the export dialog loads it at once. */
import type { SceneGroup } from '@inkadra/canvas-core';
import type { Element } from '@inkadra/doc-schema';
import type { ShootingDay } from '@inkadra/shared';
import { sceneIdsOf } from '../film/needed.ts';

type Scene = Extract<Element, { type: 'scene' }>;

export const DEPARTMENTS = ['everything', 'camera', 'lighting', 'costume', 'production'] as const;
export type Department = (typeof DEPARTMENTS)[number];
/** Every scene, the selected ones, or those of one shooting day (`day:<id>`). */
export type SceneChoice = 'all' | 'selection' | `day:${string}`;

/** Scenes named by a selection: the scenes themselves and the scenes of selected frames. */
export function selectedSceneIds(
  selection: ReadonlySet<string>,
  byId: ReadonlyMap<string, Element>,
): Set<string> {
  const ids = new Set<string>();
  for (const id of selection) {
    const el = byId.get(id);
    if (el?.type === 'scene') ids.add(el.id);
    const parent = el?.parent ? byId.get(el.parent) : undefined;
    if (parent?.type === 'scene') ids.add(parent.id);
  }
  return ids;
}

/** The storyboard without the scenes a later draft left out (decision 0082), nor their frames. */
export function withoutOmitted(groups: readonly SceneGroup[]): SceneGroup[] {
  return groups.filter((g) => !g.scene?.omitted);
}

/**
 * The scenes an export prints: all of them and a selection in storyboard order, a shooting day
 * in the order it shoots them. `groups` holds only the scenes the export may show.
 */
export function chosenScenes(
  groups: readonly SceneGroup[],
  choice: SceneChoice,
  selection: ReadonlySet<string>,
  days: readonly Pick<ShootingDay, 'id' | 'blocks'>[],
  byId: ReadonlyMap<string, Element>,
): Scene[] {
  const scenes = groups.flatMap((g) => (g.scene ? [g.scene] : []));
  if (choice === 'all') return scenes;
  if (choice === 'selection') {
    const ids = selectedSceneIds(selection, byId);
    return scenes.filter((s) => ids.has(s.id));
  }
  const day = days.find((d) => `day:${d.id}` === choice);
  if (!day) return [];
  return sceneIdsOf(day, byId).flatMap((id) => scenes.find((s) => s.id === id) ?? []);
}
