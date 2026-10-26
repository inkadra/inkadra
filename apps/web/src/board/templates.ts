import {
  addFrame,
  addScene,
  DEFAULT_WIDTH,
  inflate,
  intersects,
  listElements,
  type Point,
  type Rect,
  type TemplateId,
} from '@inkadra/canvas-core';
import type * as Y from 'yjs';
import { LOCAL } from './store.ts';

/** Reserve the whole layout, including the four stacked swatches of the moodboard. */
export function templateRect(id: TemplateId, center: Point, occupied: Rect[]): Rect {
  const columns = id === 'moodboard' ? 4 : 3;
  const w = id === 'storyboard' ? DEFAULT_WIDTH.board : columns * (DEFAULT_WIDTH.column + 40) - 40;
  const rect = { x: center.x - w / 2, y: center.y - 60, w, h: id === 'moodboard' ? 1000 : 120 };
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
