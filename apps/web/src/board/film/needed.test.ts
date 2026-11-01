import { addTodoItem, createElement, listElements, updateElement } from '@inkadra/canvas-core';
import { createBoardDoc } from '@inkadra/doc-schema';
import type { ShootingDayInput } from '@inkadra/shared';
import { describe, expect, it } from 'vitest';
import { neededForDay, updateNeededRow } from './needed.ts';
import { newScheduleBlock } from './schedule.ts';

const opts = { userId: null };

function board() {
  const doc = createBoardDoc('0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10');
  const scene = (number: string) =>
    createElement(doc, 'scene', { x: 0, y: 0 }, { number, title: '' }, opts).id;
  const frame = (parent: string) =>
    createElement(doc, 'frame', { x: 0, y: 0 }, { parent }, opts).id;
  const list = (sceneId: string, kind: 'wardrobe' | 'props' | undefined, texts: string[]) => {
    const id = createElement(doc, 'todo', { x: 0, y: 0 }, { items: [] }, opts).id;
    updateElement(doc, id, { list: kind, sceneId });
    for (const text of texts) addTodoItem(doc, id, text);
    return id;
  };
  return { doc, scene, frame, list };
}

const dayOf = (...shots: string[]): ShootingDayInput => ({
  date: '2026-11-17',
  callTime: '06:30',
  wrap: null,
  location: '',
  notes: '',
  blocks: [newScheduleBlock('setup'), ...shots.map((id) => newScheduleBlock('shot', id))],
});

describe('needed items of a shooting day', () => {
  it('rolls up the lists of the scenes the day shoots, by kind, merging duplicates', () => {
    const { doc, scene, frame, list } = board();
    const s3 = scene('3');
    const s5 = scene('5');
    const s8 = scene('8');
    list(s3, 'wardrobe', ['Giacca rossa', 'Asciugamano']);
    list(s5, 'wardrobe', [' asciugamano ']);
    list(s5, 'props', ['Thermos', 'Asciugamano']);
    list(s8, 'props', ['Mappa']);
    list(s3, undefined, ['Chiamare il rifugio']);
    const day = dayOf(frame(s5), frame(s3), frame(s5));
    const rows = neededForDay(day, listElements(doc));
    expect(rows.map((r) => [r.list, r.text, r.count, r.scenes])).toEqual([
      ['wardrobe', 'asciugamano', 2, ['5', '3']],
      ['wardrobe', 'Giacca rossa', 1, ['3']],
      ['props', 'Thermos', 1, ['5']],
      ['props', 'Asciugamano', 1, ['5']],
    ]);
  });

  it('ticks the items on the cards, so the board and every day share one state', () => {
    const { doc, scene, frame, list } = board();
    const s3 = scene('3');
    const s5 = scene('5');
    const a = list(s3, 'wardrobe', ['Asciugamano']);
    list(s5, 'wardrobe', ['Asciugamano']);
    const day = dayOf(frame(s3), frame(s5));
    const [row] = neededForDay(day, listElements(doc));
    expect(row?.done).toBe(false);
    updateNeededRow(doc, row!, { done: true, assigneeId: '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a11' });
    const card = listElements(doc).find((el) => el.id === a);
    expect(card?.type === 'todo' && card.items[0]).toMatchObject({
      done: true,
      assigneeId: '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a11',
    });
    // Another day shooting only scene 3 reads the same ticked item.
    expect(neededForDay(dayOf(frame(s3)), listElements(doc))[0]?.done).toBe(true);
  });
});
