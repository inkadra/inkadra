// SPDX-License-Identifier: AGPL-3.0-only
import { updateTodoItem } from '@inkadra/canvas-core';
import { type Element, TODO_LISTS, type TodoList } from '@inkadra/doc-schema';
import type { ShootingDayInput } from '@inkadra/shared';
import type * as Y from 'yjs';

/**
 * One line of a shooting day's "Da portare": the same thing in the same kind of list, from
 * every scene the day shoots, merged into one row (decision 0058).
 */
export interface NeededRow {
  key: string;
  list: TodoList;
  text: string;
  /** How many to-do items the row merges: "Asciugamano ×2". */
  count: number;
  /** Scene numbers, in the order the day shoots them. */
  scenes: string[];
  /** Ticked only when every merged item is: the state lives on the items, never on the day. */
  done: boolean;
  /** Who brings it: the first assignee among the merged items. */
  assigneeId: string | undefined;
  items: Array<{ elementId: string; itemId: string }>;
}

/** The scenes a day shoots, by element id, in the order of its shot blocks. */
function sceneIdsOf(day: ShootingDayInput, byId: ReadonlyMap<string, Element>): string[] {
  const ids: string[] = [];
  for (const block of day.blocks) {
    const frame = block.shotId ? byId.get(block.shotId) : undefined;
    const scene = frame?.parent ? byId.get(frame.parent) : undefined;
    if (scene?.type === 'scene' && !ids.includes(scene.id)) ids.push(scene.id);
  }
  return ids;
}

/** Everything the scenes of the day need, grouped by kind of list, duplicates merged. */
export function neededForDay(day: ShootingDayInput, elements: Iterable<Element>): NeededRow[] {
  const byId = new Map([...elements].map((el) => [el.id, el]));
  const scenes = sceneIdsOf(day, byId);
  const rows = new Map<string, NeededRow>();
  for (const sceneId of scenes) {
    const scene = byId.get(sceneId);
    const number = scene?.type === 'scene' ? scene.number || '—' : '—';
    for (const el of byId.values()) {
      if (el.type !== 'todo' || !el.list || el.sceneId !== sceneId) continue;
      for (const item of el.items) {
        const text = item.text.trim();
        if (!text) continue;
        const key = `${el.list}\u0000${text.toLocaleLowerCase()}`;
        const row = rows.get(key) ?? {
          key,
          list: el.list,
          text,
          count: 0,
          scenes: [],
          done: true,
          assigneeId: undefined,
          items: [],
        };
        row.count += 1;
        if (!row.scenes.includes(number)) row.scenes.push(number);
        row.done &&= item.done;
        row.assigneeId ??= item.assigneeId;
        row.items.push({ elementId: el.id, itemId: item.id });
        rows.set(key, row);
      }
    }
  }
  return [...rows.values()].sort((a, b) => TODO_LISTS.indexOf(a.list) - TODO_LISTS.indexOf(b.list));
}

/** Ticks or assigns every item a row merges, on the cards themselves. */
export function updateNeededRow(
  doc: Y.Doc,
  row: NeededRow,
  patch: { done?: boolean; assigneeId?: string | null },
  origin?: unknown,
): void {
  doc.transact(() => {
    for (const { elementId, itemId } of row.items)
      updateTodoItem(doc, elementId, itemId, patch, origin);
  }, origin);
}
