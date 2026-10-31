import {
  frameLabels,
  type SceneElement,
  storyboardOf,
} from '@inkadra/canvas-core';
import { useMemo, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import type { BoardStore } from '../store.ts';

// Kept apart from StoryboardView so that cards and the other film views, which only need these,
// do not load the whole storyboard (its upload panel and the session) with them.

/** Scenes and frames of the board, in order, from the live document. */
export function useStoryboard(store: BoardStore) {
  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return useMemo(() => {
    const groups = storyboardOf([...snap.byId.values()]);
    const frames = groups.flatMap((g) => g.frames);
    return { groups, frames, labels: frameLabels(groups) };
  }, [snap]);
}

/** What a scene is called in lists: its title, else its location, as imported scenes are. */
export function sceneName(scene: SceneElement): string {
  return scene.title.trim() || scene.location?.trim() || '';
}

/** INT. KITCHEN – NIGHT, from the scene fields. */
export function useSlugline() {
  const { t } = useTranslation();
  return (scene: SceneElement) =>
    [
      scene.setting && t(`film.scene.settings.${scene.setting}`),
      scene.location?.toUpperCase(),
      scene.time && `– ${t(`film.scene.times.${scene.time}`)}`,
    ]
      .filter(Boolean)
      .join(' ');
}
