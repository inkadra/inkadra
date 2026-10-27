import {
  addFrame,
  addScene,
  applyTemplate,
  DEFAULT_WIDTH,
  inflate,
  intersects,
  listElements,
  type Point,
  type Rect,
  type TemplateId,
  type TemplateLabels,
} from '@inkadra/canvas-core';
import type * as Y from 'yjs';
import { LOCAL } from './store.ts';

/** Notes each setup layout stacks in its single column. */
const SETUP_NOTES: Partial<Record<TemplateId, number>> = { brief: 3, locations: 1, casting: 1 };

/** Reserve the whole layout, including the four stacked swatches of the moodboard. */
export function templateRect(id: TemplateId, center: Point, occupied: Rect[]): Rect {
  const columns = id === 'moodboard' ? 4 : id === 'production' ? 3 : 1;
  const w = id === 'storyboard' ? DEFAULT_WIDTH.board : columns * (DEFAULT_WIDTH.column + 40) - 40;
  const notes = SETUP_NOTES[id];
  // Column header plus a generous height per note, so later cards never overlap the notes.
  const h = id === 'moodboard' ? 1000 : notes ? 80 + notes * 120 : 120;
  const rect = { x: center.x - w / 2, y: center.y - 60, w, h };
  for (;;) {
    const collisions = occupied.filter((r) => intersects(inflate(r, 24), rect));
    if (collisions.length === 0) return rect;
    rect.y = Math.max(...collisions.map((r) => r.y + r.h + 24));
  }
}

/** Seed only after the new storyboard's document has synced, never over existing work. */
export function seedStoryboard(doc: Y.Doc, title: string, userId: string): boolean {
  if (listElements(doc).length > 0) return false;
  const opts = { userId, origin: LOCAL };
  doc.transact(() => {
    const scene = addScene(doc, { number: '1', title }, opts, { x: 0, y: 0 });
    for (let i = 0; i < 3; i++) addFrame(doc, scene.id, null, {}, opts);
  }, LOCAL);
  return true;
}

export function templateLabels(t: (key: string) => string): TemplateLabels {
  return {
    moodboard: {
      refs: t('templates.moodboard.refs'),
      light: t('templates.moodboard.light'),
      locations: t('templates.moodboard.locations'),
      palette: t('templates.moodboard.palette'),
    },
    storyboard: { scene: t('templates.storyboard.scene') },
    production: {
      todo: t('templates.production.todo'),
      doing: t('templates.production.doing'),
      done: t('templates.production.done'),
    },
    brief: {
      column: t('templates.brief.column'),
      logline: t('templates.brief.logline'),
      synopsis: t('templates.brief.synopsis'),
      tone: t('templates.brief.tone'),
    },
    locations: {
      column: t('templates.locations.column'),
      location: t('templates.locations.location'),
    },
    casting: {
      column: t('templates.casting.column'),
      role: t('templates.casting.role'),
    },
  };
}

/** Templates a new board can be opened with from Home (decision 0021's navigation request). */
export type StartTemplate = Exclude<TemplateId, 'storyboard'>;
export const isStartTemplate = (value: unknown): value is StartTemplate =>
  value === 'moodboard' || value === 'production';

/** Lay out a canvas template on a board that just synced empty, in one undo step. */
export function seedTemplate(
  doc: Y.Doc,
  id: StartTemplate,
  labels: TemplateLabels,
  userId: string,
): boolean {
  if (listElements(doc).length > 0) return false;
  doc.transact(
    () => applyTemplate(doc, id, { x: 80, y: 80 }, labels, { userId, origin: LOCAL }),
    LOCAL,
  );
  return true;
}
