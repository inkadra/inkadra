// SPDX-License-Identifier: AGPL-3.0-only
import {
  catalogueKind,
  groupOf,
  iconWatts,
  PLAN_CATEGORIES,
  PLAN_NOTE_TOOLS,
  type PlanCategory,
  type PlanNoteTool,
  type ProjectKitEntry,
} from '@inkadra/canvas-core';
import type { PlanIconKind } from '@inkadra/doc-schema';
import type { TFunction } from 'i18next';
import { wattsText } from './kit.ts';

/** What a library tile places: a set icon, or an annotation tool (arrow, text, measure, zone). */
export type LibraryItem = PlanIconKind | PlanNoteTool;
export type CategoryId = PlanCategory['id'] | 'notes';

const NOTE_TOOLS = new Set<string>(PLAN_NOTE_TOOLS);
export const isNoteTool = (item: LibraryItem): item is PlanNoteTool => NOTE_TOOLS.has(item);

/** The rail of the library: the six categories of the catalogue, then the annotation tools. */
export const LIBRARY_CATEGORIES: Array<{ id: CategoryId; items: readonly LibraryItem[] }> = [
  ...PLAN_CATEGORIES.map((c) => ({ id: c.id as CategoryId, items: c.kinds })),
  { id: 'notes', items: PLAN_NOTE_TOOLS },
];

export const fold = (s: string) =>
  s
    .toLocaleLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');

/** Where an item of the library sits: its group, "Modifiers on the light", "Notes". */
export function placeOf(t: TFunction, item: LibraryItem, category: CategoryId): string {
  if (isNoteTool(item)) return t(`board.plan.categories.${category}`);
  return t(`board.plan.groups.${groupOf(item).id}`);
}

/** A search result: the item and why it matched, to show under its name. */
export interface LibraryHit {
  item: LibraryItem;
  name: string;
  /** "Modifiers on the light", or the other names when a synonym matched. */
  detail: string;
  by: 'prefix' | 'name' | 'synonym' | 'category';
}

/**
 * The library searched by name, by the other names people use (synonyms) and by category and
 * group, in the language of the app, accents and case ignored (decision 0117). Names that start
 * with the query come first, the shorter first ("soft": Softbox, then Soft light), then names
 * that hold it, then synonyms, each in the order of the catalogue; a category or group matches
 * only when the query is its whole name ("lights"), so a word of it ("soft") finds no lights.
 */
export function searchLibrary(t: TFunction, query: string): LibraryHit[] {
  const q = fold(query.trim());
  if (!q) return [];
  const hits: LibraryHit[] = [];
  for (const c of LIBRARY_CATEGORIES)
    for (const item of c.items) {
      const name = t(`board.plan.icons.${item}`);
      const synonyms = t(`board.plan.synonyms.${item}`, { defaultValue: '' });
      const group = isNoteTool(item) ? '' : t(`board.plan.groups.${groupOf(item).id}`);
      const by: LibraryHit['by'] | null = fold(name).startsWith(q)
        ? 'prefix'
        : fold(name).includes(q)
          ? 'name'
          : fold(synonyms).includes(q)
            ? 'synonym'
            : [t(`board.plan.categories.${c.id}`), group].some((g) => g && fold(g) === q)
              ? 'category'
              : null;
      if (!by) continue;
      const detail =
        by === 'synonym'
          ? t('board.plan.lib.alsoCalled', { names: synonyms })
          : placeOf(t, item, c.id);
      hits.push({ item, name, detail, by });
    }
  const rank = { prefix: 0, name: 1, synonym: 2, category: 3 };
  return hits
    .map((h, i) => ({ h, i }))
    .sort(
      (a, b) =>
        rank[a.h.by] - rank[b.h.by] ||
        (a.h.by === 'prefix' ? a.h.name.length - b.h.name.length : 0) ||
        a.i - b.i,
    )
    .map(({ h }) => h);
}

/** "LED COB 300 W · Softbox, grid", "Super 35 · 32, 50, 85 mm": the line under a kit entry. */
export function projectKitDetail(entry: ProjectKitEntry, t: TFunction, sensor: string): string {
  const { icon } = entry;
  if (catalogueKind(icon.kind) === 'camera') {
    const lenses = entry.lenses.length ? `${entry.lenses.join(', ')} mm` : '';
    return [icon.make, sensor, lenses].filter(Boolean).join(' · ');
  }
  const watts = iconWatts(icon);
  return [
    [t(`board.plan.icons.${icon.kind}`), icon.power || (watts ? wattsText(watts) : '')]
      .filter(Boolean)
      .join(' '),
    icon.make,
    entry.modifiers.map((m) => t(`board.plan.icons.${m}`)).join(', '),
    icon.stand ? t(`board.plan.stands.${icon.stand}`) : '',
  ]
    .filter(Boolean)
    .join(' · ');
}
