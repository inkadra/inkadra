import {
  frameLabels,
  type SceneElement,
  type SceneGroup,
  storyboardOf,
} from '@inkadra/canvas-core';
import { useMemo, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import type { BoardStore } from '../store.ts';

// Kept apart from StoryboardView so that cards and the other film views, which only need these,
// do not load the whole storyboard (its upload panel and the session) with them.

/**
 * Scenes and frames of the board, in order, from the live document. Without `omitted`, scenes
 * the script left out and their frames are not listed (decision 0082); labels stay the same.
 */
export function useStoryboard(store: BoardStore, { omitted = true } = {}) {
  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return useMemo(() => {
    const all = storyboardOf([...snap.byId.values()]);
    const groups = omitted ? all : inShotList(all);
    const frames = groups.flatMap((g) => g.frames);
    return { groups, frames, labels: frameLabels(all) };
  }, [snap, omitted]);
}

/** The scenes the shot list counts: without those the script left out (decision 0082). */
export function inShotList(groups: readonly SceneGroup[]): SceneGroup[] {
  return groups.filter((g) => !g.scene?.omitted);
}

/** What a scene is called in lists: its title, else its location, as imported scenes are. */
export function sceneName(scene: SceneElement): string {
  return scene.title.trim() || scene.location?.trim() || '';
}

/** INT. KITCHEN – NIGHT, from the scene fields. */
export function sluglineOf(scene: SceneElement, t: (key: string) => string): string {
  return [
    scene.setting && t(`film.scene.settings.${scene.setting}`),
    scene.location?.toUpperCase(),
    scene.time && `– ${t(`film.scene.times.${scene.time}`)}`,
  ]
    .filter(Boolean)
    .join(' ');
}

/** `sluglineOf` in the reader's language. */
export function useSlugline() {
  const { t } = useTranslation();
  return (scene: SceneElement) => sluglineOf(scene, t);
}
